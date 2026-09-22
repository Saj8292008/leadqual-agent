const { propertyStatements } = require("../db/propertyManagement");
const email = require("./email");
const slack = require("./slack");

// Emergencies dispatch immediately since waiting for a human to review costs
// real time/damage; everything else waits for a human to hit dispatch via
// the admin API. Either way, no vendor on file for the category always needs
// a human — we're not guessing who to call for a plumbing job.
async function dispatch(requestId) {
  const request = propertyStatements.getMaintenanceRequest.get(requestId);
  if (!request) throw new Error("maintenance request not found");
  if (request.status !== "triaged") throw new Error(`cannot dispatch a request with status ${request.status}`);

  const vendors = propertyStatements.vendorsForCategory.all(request.category);
  if (!vendors.length) {
    await slack.notifyHandoff({
      lead: { name: `Maintenance request #${request.id}`, email: "", source: "property-management" },
      reason: `No vendor on file for category "${request.category}" — needs a human to find and contact one directly. Urgency: ${request.urgency}.`,
    });
    return { dispatched: false, reason: "no_vendor_on_file" };
  }

  const vendor = vendors[0];
  await email.sendEmail({
    to: vendor.email,
    subject: `Maintenance dispatch — ${request.category} (${request.urgency})`,
    text: request.vendor_message,
  });
  propertyStatements.markDispatched.run({ id: request.id });
  return { dispatched: true, vendor };
}

module.exports = { dispatch };
