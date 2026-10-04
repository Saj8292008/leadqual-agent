const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
const { statements } = require("../src/db");
const claude = require("../src/services/claude");
const email = require("../src/services/email");
const alerts = require("../src/services/alerts");
const { runTurn } = require("../src/services/conversationEngine");
const { handleInbound } = require("../src/routes/email");

let modelCalls, sentEmails, sentAlerts;
beforeEach(() => {
  modelCalls = 0;
  sentEmails = [];
  sentAlerts = [];
  claude.converse = async () => (modelCalls++, { reply: "Sure thing!", status: "qualifying" });
  email.sendEmail = async (args) => (sentEmails.push(args), { messageId: null });
  alerts.notifyHandoff = async (args) => sentAlerts.push(args);
});

let n = 0;
async function leadWithStatus(status) {
  n++;
  const { lastInsertRowid: id } = await statements.insertLead.run({ source: "website", name: `Lead ${n}`, email: `lead${n}@example.com`, notes: null });
  const lead = await statements.getLead.get(id);
  await statements.updateLead.run({ ...lead, status });
  return statements.getLead.get(id);
}

function inbound(lead, text) {
  return handleInbound({
    event_type: "message.received",
    message: { from: lead.email, subject: "Re: your home search", text, extracted_text: text, message_id: `m-${Math.random()}` },
  });
}

for (const status of ["handoff", "booked", "dead"]) {
  test(`a reply from a ${status} lead goes to the agent, and the AI stays quiet`, async () => {
    // Regression: every inbound reply ran the AI regardless of status, so
    // after a handoff Sam talked over the agent, and a booked lead asking to
    // reschedule could be offered fresh times.
    const lead = await leadWithStatus(status);
    await inbound(lead, "Can we move it to Thursday at 2pm instead?");
    assert.equal(modelCalls, 0, "AI not consulted");
    assert.equal(sentEmails.length, 0, "nothing emailed to the lead");
    assert.equal(sentAlerts.length, 1);
    assert.match(sentAlerts[0].reason, /did not reply.*Thursday at 2pm.*reply to them directly/);
    assert.equal((await statements.getLead.get(lead.id)).status, status, "status unchanged");
  });
}

test("leads still being qualified or nurtured keep getting AI replies", async () => {
  for (const status of ["qualifying", "nurture", "new"]) {
    const lead = await leadWithStatus(status);
    await inbound(lead, "Hi, still interested!");
  }
  assert.equal(modelCalls, 3);
  assert.equal(sentAlerts.length, 0);
});

test("when the AI flags a handoff, the lead is marked handoff so later replies go to the agent", async () => {
  // The model often sets handoff=true but leaves status "qualifying".
  const lead = await leadWithStatus("qualifying");
  claude.converse = async () => ({
    reply: "Great question — John will reach out personally.",
    status: "qualifying",
    handoff: true,
    ready_to_book: true,
    notes: "Asked about HOA fees",
  });
  await runTurn(lead.id);
  assert.equal((await statements.getLead.get(lead.id)).status, "handoff");
  assert.equal(sentEmails.length, 1, "only the handoff reply — no showing options sent to a handed-off lead");

  await inbound(lead, "Thanks! Also, is there a pool?");
  assert.equal(sentEmails.length, 1, "AI didn't reply again");
  assert.match(sentAlerts.at(-1).reason, /is there a pool/);
});
