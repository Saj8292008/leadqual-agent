const express = require("express");
const { isValidWebhookSecret } = require("../middleware/webhookAuth");
const { propertyStatements } = require("../db/propertyManagement");
const { triage } = require("../services/maintenanceTriage");
const { dispatch } = require("../services/vendorDispatch");
const { requireAdminAuth } = require("../middleware/adminAuth");
const slack = require("../services/slack");

const router = express.Router();

function checkWebhookSecret(req, res) {
  if (!isValidWebhookSecret(req)) {
    res.status(401).json({ error: "bad secret" });
    return false;
  }
  return true;
}

// --- Properties & tenants -------------------------------------------------

router.post("/webhooks/property", (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { address, landlord_name, landlord_email } = req.body;
  if (!address) return res.status(400).json({ error: "address is required" });

  const info = propertyStatements.insertProperty.run({
    address, landlord_name: landlord_name || null, landlord_email: landlord_email || null,
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post("/webhooks/tenant", (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { property_id, unit, name, email: tenantEmail, phone, lease_start, lease_end, rent_amount, rent_due_day } = req.body;
  if (!property_id) return res.status(400).json({ error: "property_id is required" });
  if (!name || !tenantEmail) return res.status(400).json({ error: "name and email are required" });

  const property = propertyStatements.getProperty.get(property_id);
  if (!property) return res.status(404).json({ error: "property not found" });

  const info = propertyStatements.insertTenant.run({
    property_id,
    unit: unit || null,
    name,
    email: tenantEmail,
    phone: phone || null,
    lease_start: lease_start || null,
    lease_end: lease_end || null,
    rent_amount: rent_amount || null,
    rent_due_day: rent_due_day || 1,
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get("/properties", requireAdminAuth, (req, res) => {
  res.json(propertyStatements.listProperties.all());
});

router.get("/properties/:id", requireAdminAuth, (req, res) => {
  const property = propertyStatements.getProperty.get(req.params.id);
  if (!property) return res.status(404).json({ error: "not found" });
  res.json(property);
});

router.get("/tenants", requireAdminAuth, (req, res) => {
  res.json(propertyStatements.listTenants.all());
});

router.get("/tenants/:id", requireAdminAuth, (req, res) => {
  const tenant = propertyStatements.getTenant.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: "not found" });
  res.json(tenant);
});

// --- Rent ------------------------------------------------------------------

// Point a payment processor's webhook here, or call manually.
router.post("/webhooks/rent-payment", (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { tenant_id, period } = req.body;
  if (!tenant_id || !period) return res.status(400).json({ error: "tenant_id and period ('YYYY-MM') are required" });
  propertyStatements.recordRentPayment.run({ tenant_id, period });
  res.json({ ok: true });
});

// --- Maintenance -------------------------------------------------------

router.post("/webhooks/maintenance", async (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { tenant_id, description } = req.body;
  if (!tenant_id || !description) return res.status(400).json({ error: "tenant_id and description are required" });

  const tenant = propertyStatements.getTenant.get(tenant_id);
  if (!tenant) return res.status(404).json({ error: "tenant not found" });

  const info = propertyStatements.insertMaintenanceRequest.run({
    tenant_id, property_id: tenant.property_id, description,
  });
  res.status(201).json({ id: info.lastInsertRowid });

  triageAndMaybeDispatch(info.lastInsertRowid).catch((err) =>
    handleTriageFailure(info.lastInsertRowid, err)
  );
});

async function triageAndMaybeDispatch(requestId) {
  const request = propertyStatements.getMaintenanceRequest.get(requestId);
  const tenant = propertyStatements.getTenant.get(request.tenant_id);
  const property = propertyStatements.getProperty.get(request.property_id);

  const result = await triage({ description: request.description, address: property.address, unit: tenant.unit });
  propertyStatements.saveTriage.run({ id: requestId, ...result });

  if (result.urgency === "emergency") {
    await dispatch(requestId).catch((err) =>
      console.error(`[maintenance ${requestId}] auto-dispatch failed:`, err)
    );
  }
}

async function handleTriageFailure(requestId, err) {
  console.error(`[maintenance ${requestId}] triage failed:`, err);
  propertyStatements.markTriageFailed.run({ id: requestId });
  await slack.notifyHandoff({
    lead: { name: `Maintenance request #${requestId}`, email: "", source: "property-management" },
    reason: `Triage failed: ${err.message}. Needs a human to classify and dispatch manually.`,
  });
}

router.get("/maintenance-requests", requireAdminAuth, (req, res) => {
  res.json(propertyStatements.listMaintenanceRequests.all());
});

router.get("/maintenance-requests/:id", requireAdminAuth, (req, res) => {
  const request = propertyStatements.getMaintenanceRequest.get(req.params.id);
  if (!request) return res.status(404).json({ error: "not found" });
  res.json(request);
});

// Manual dispatch for anything not auto-dispatched (i.e. not an emergency).
router.post("/maintenance-requests/:id/dispatch", requireAdminAuth, async (req, res) => {
  try {
    const result = await dispatch(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/maintenance-requests/:id/resolve", requireAdminAuth, (req, res) => {
  const request = propertyStatements.getMaintenanceRequest.get(req.params.id);
  if (!request) return res.status(404).json({ error: "not found" });
  propertyStatements.markResolved.run({ id: request.id });
  res.json(propertyStatements.getMaintenanceRequest.get(request.id));
});

// --- Vendors -----------------------------------------------------------

router.post("/vendors", requireAdminAuth, (req, res) => {
  const { category, name, email: vendorEmail } = req.body;
  if (!category || !name || !vendorEmail) {
    return res.status(400).json({ error: "category, name, and email are required" });
  }
  const info = propertyStatements.insertVendor.run({ category, name, email: vendorEmail });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get("/vendors", requireAdminAuth, (req, res) => {
  res.json(propertyStatements.listVendors.all());
});

module.exports = router;
