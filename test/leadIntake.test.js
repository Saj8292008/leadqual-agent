const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
const llm = require("../src/services/llm");
const alerts = require("../src/services/alerts");
const { statements } = require("../src/db");
const { handleLeadAlert, isAllowedSender } = require("../src/services/leadIntake");

let sentAlerts;
beforeEach(() => {
  process.env.LEAD_INTAKE_ALLOWED_SENDERS = "alerts@jwallace.realtor, @leads.examplecrm.com";
  sentAlerts = [];
  alerts.notifyHandoff = async (args) => sentAlerts.push(args);
});

function modelReturns(result) {
  llm.callTool = async () => result;
}

test("allowlist matches exact addresses and @domain entries, case-insensitively", () => {
  assert.equal(isAllowedSender("Alerts@JWallace.realtor"), true);
  assert.equal(isAllowedSender("noreply@leads.examplecrm.com"), true);
  assert.equal(isAllowedSender("someone@gmail.com"), false);
  assert.equal(isAllowedSender("evil@notleads.examplecrm.com.attacker.io"), false);
  process.env.LEAD_INTAKE_ALLOWED_SENDERS = "";
  assert.equal(isAllowedSender("alerts@jwallace.realtor"), false, "nothing allowed when unset");
});

test("a website lead alert from an allowed sender creates a lead", async () => {
  modelReturns({ is_lead: true, name: "Maria Lopez", email: "maria@example.com", phone: "404-555-0101", source: "Website", inquiry: "Wants to see 12 Peachtree Ln" });
  const result = await handleLeadAlert({ sender: "alerts@jwallace.realtor", subject: "New lead!", text: "..." });
  assert.equal(result.action, "created");
  const lead = await statements.getLead.get(result.leadId);
  assert.equal(lead.email, "maria@example.com");
  assert.equal(lead.source, "website");
  assert.match(lead.notes, /12 Peachtree Ln.*Phone: 404-555-0101/);
  assert.equal(sentAlerts.length, 0);
});

test("an alert from an unknown sender is flagged to the agent, never auto-contacted", async () => {
  // Anyone can email the intake inbox; an automatic reply would go to
  // whatever address the email names.
  modelReturns({ is_lead: true, name: "Spoof", email: "victim@example.com" });
  const result = await handleLeadAlert({ sender: "random@gmail.com", subject: "New lead", text: "..." });
  assert.equal(result.action, "flagged_unknown_sender");
  assert.equal(await statements.findLeadByEmail.get("victim@example.com"), undefined);
  assert.equal(sentAlerts.length, 1);
  assert.match(sentAlerts[0].reason, /unrecognized sender \(random@gmail\.com\).*did NOT contact/);
});

test("a lead with only a phone number goes to the agent to call", async () => {
  modelReturns({ is_lead: true, name: "Phone Only", phone: "404-555-0199", source: "facebook", inquiry: "Call me about selling" });
  const result = await handleLeadAlert({ sender: "noreply@leads.examplecrm.com", subject: "FB lead", text: "..." });
  assert.equal(result.action, "flagged_no_email");
  assert.match(sentAlerts[0].reason, /no email address.*call.*404-555-0199/);
});

test("non-lead emails (newsletters, receipts) are ignored", async () => {
  modelReturns({ is_lead: false });
  const result = await handleLeadAlert({ sender: "alerts@jwallace.realtor", subject: "Your monthly site report", text: "..." });
  assert.equal(result.action, "ignored");
  assert.equal(sentAlerts.length, 0);
});

test("a repeat alert for an existing lead doesn't start a second conversation", async () => {
  modelReturns({ is_lead: true, name: "Maria Lopez", email: "MARIA@example.com" });
  const result = await handleLeadAlert({ sender: "alerts@jwallace.realtor", subject: "New lead!", text: "..." });
  assert.equal(result.action, "duplicate");
});
