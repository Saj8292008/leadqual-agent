const express = require("express");
const { inBackground } = require("../lib/background");
const { isValidWebhookSecret } = require("../middleware/webhookAuth");
const { propertyStatements } = require("../db/propertyManagement");
const { triage } = require("../services/maintenanceTriage");
const { dispatch } = require("../services/vendorDispatch");
const { requireAdminAuth } = require("../middleware/adminAuth");
const alerts = require("../services/alerts");

const router = express.Router();

function checkWebhookSecret(req, res) {
  if (!isValidWebhookSecret(req)) {
    res.status(401).json({ error: "bad secret" });
    return false;
  }
  return true;
}

// --- Properties & tenants -------------------------------------------------

router.post("/webhooks/property", async (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { address, landlord_name, landlord_email } = req.body;
  if (!address) return res.status(400).json({ error: "address is required" });

  const info = await propertyStatements.insertProperty.run({
    address, landlord_name: landlord_name || null, landlord_email: landlord_email || null,
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post("/webhooks/tenant", async (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { property_id, unit, name, email: tenantEmail, phone, lease_start, lease_end, rent_amount, rent_due_day } = req.body;
  if (!property_id) return res.status(400).json({ error: "property_id is required" });
  if (!name || !tenantEmail) return res.status(400).json({ error: "name and email are required" });

  const property = await propertyStatements.getProperty.get(property_id);
  if (!property) return res.status(404).json({ error: "property not found" });

  const info = await propertyStatements.insertTenant.run({
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

router.get("/properties", requireAdminAuth, async (req, res) => {
  res.json(await propertyStatements.listProperties.all());
});

router.get("/properties/:id", requireAdminAuth, async (req, res) => {
  const property = await propertyStatements.getProperty.get(req.params.id);
  if (!property) return res.status(404).json({ error: "not found" });
  res.json(property);
});

router.get("/tenants", requireAdminAuth, async (req, res) => {
  res.json(await propertyStatements.listTenants.all());
});

router.get("/tenants/:id", requireAdminAuth, async (req, res) => {
  const tenant = await propertyStatements.getTenant.get(req.params.id);
  if (!tenant) return res.status(404).json({ error: "not found" });
  res.json(tenant);
});

// --- Rent ------------------------------------------------------------------

// Point a payment processor's webhook here, or call manually.
router.post("/webhooks/rent-payment", async (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { tenant_id, period } = req.body;
  if (!tenant_id || !period) return res.status(400).json({ error: "tenant_id and period ('YYYY-MM') are required" });
  await propertyStatements.recordRentPayment.run({ tenant_id, period });
  res.json({ ok: true });
});

// --- Maintenance -------------------------------------------------------

router.post("/webhooks/maintenance", async (req, res) => {
  if (!checkWebhookSecret(req, res)) return;
  const { tenant_id, description } = req.body;
  if (!tenant_id || !description) return res.status(400).json({ error: "tenant_id and description are required" });

  const tenant = await propertyStatements.getTenant.get(tenant_id);
  if (!tenant) return res.status(404).json({ error: "tenant not found" });

  const info = await propertyStatements.insertMaintenanceRequest.run({
    tenant_id, property_id: tenant.property_id, description,
  });
  res.status(201).json({ id: info.lastInsertRowid });

  inBackground(
    triageAndMaybeDispatch(info.lastInsertRowid).catch((err) => handleTriageFailure(info.lastInsertRowid, err))
  );
});

async function triageAndMaybeDispatch(requestId) {
  const request = await propertyStatements.getMaintenanceRequest.get(requestId);
  const tenant = await propertyStatements.getTenant.get(request.tenant_id);
  const property = await propertyStatements.getProperty.get(request.property_id);

  const result = await triage({ description: request.description, address: property.address, unit: tenant.unit });
  await propertyStatements.saveTriage.run({ id: requestId, ...result });

  if (result.urgency === "emergency") {
    await dispatch(requestId).catch((err) =>
      console.error(`[maintenance ${requestId}] auto-dispatch failed:`, err)
    );
  }
}

async function handleTriageFailure(requestId, err) {
  console.error(`[maintenance ${requestId}] triage failed:`, err);
  await propertyStatements.markTriageFailed.run({ id: requestId });
  await alerts.notifyHandoff({
    lead: { name: `Maintenance request #${requestId}`, email: "", source: "property-management" },
    reason: `Triage failed: ${err.message}. Needs a human to classify and dispatch manually.`,
  });
}

router.get("/maintenance-requests", requireAdminAuth, async (req, res) => {
  res.json(await propertyStatements.listMaintenanceRequests.all());
});

router.get("/maintenance-requests/:id", requireAdminAuth, async (req, res) => {
  const request = await propertyStatements.getMaintenanceRequest.get(req.params.id);
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

router.post("/maintenance-requests/:id/resolve", requireAdminAuth, async (req, res) => {
  const request = await propertyStatements.getMaintenanceRequest.get(req.params.id);
  if (!request) return res.status(404).json({ error: "not found" });
  await propertyStatements.markResolved.run({ id: request.id });
  res.json(await propertyStatements.getMaintenanceRequest.get(request.id));
});

// --- Vendors -----------------------------------------------------------

router.post("/vendors", requireAdminAuth, async (req, res) => {
  const { category, name, email: vendorEmail } = req.body;
  if (!category || !name || !vendorEmail) {
    return res.status(400).json({ error: "category, name, and email are required" });
  }
  const info = await propertyStatements.insertVendor.run({ category, name, email: vendorEmail });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get("/vendors", requireAdminAuth, async (req, res) => {
  res.json(await propertyStatements.listVendors.all());
});

module.exports = router;
