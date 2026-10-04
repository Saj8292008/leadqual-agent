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

const { isOptOut } = require("../src/services/conversationEngine");
const { main: runDrip } = require("../src/services/dripRunner");

test("opt-out detection catches stop requests but not normal replies", () => {
  for (const t of ["STOP", "Unsubscribe.", "please stop emailing me", "Remove me from your list", "don't contact me again", "I want to opt out", "no more emails please"]) {
    assert.equal(isOptOut(t), true, t);
  }
  for (const t of ["not interested right now", "Can we stop by the house Saturday?", "1 works for me", "Stop by anytime after 5", "We stopped looking in Decatur"]) {
    assert.equal(isOptOut(t), false, t);
  }
});

for (const status of ["qualifying", "booked", "handoff"]) {
  test(`a ${status} lead who asks to stop is never emailed again — replies, drips, anything`, async () => {
    const lead = await leadWithStatus(status);
    await inbound(lead, "Please stop emailing me.");
    const after = await statements.getLead.get(lead.id);
    assert.ok(after.opted_out_at, "opt-out recorded");
    assert.equal(after.status, "dead");
    assert.equal(modelCalls, 0, "AI not consulted");
    assert.equal(sentEmails.length, 0, "no email to the lead, not even a confirmation");
    assert.equal(sentAlerts.length, 1);
    assert.match(sentAlerts[0].reason, /asked not to be contacted.*stopped emailing them permanently/);

    // Anything later stays silent: a follow-up reply, a direct AI turn, a due drip.
    await inbound(lead, "Actually what's the HOA fee?");
    await runTurn(lead.id);
    await statements.updateLead.run({ ...after, status: "nurture", next_followup_at: "2000-01-01T00:00:00Z" });
    await runDrip();
    assert.equal(sentEmails.length, 0);
    assert.equal(modelCalls, 0);
    assert.equal(sentAlerts.length, 1, "agent alerted once, not on every later message");
  });
}

const { fairHousingConcern } = require("../src/services/conversationEngine");

test("fair housing safety net catches protected-class criteria but not ordinary needs", () => {
  assert.equal(fairHousingConcern("We are a Christian family and want to be around people like us."), "religion");
  assert.equal(fairHousingConcern("an area without a lot of Section 8 renters"), "excluding groups");
  assert.equal(fairHousingConcern("We want a white neighborhood"), "race or ethnicity");
  assert.equal(fairHousingConcern("Is the area diverse?"), "demographics");
  for (const t of ["We have two young kids and need 3 bedrooms", "Mount Zion area please", "Is it near a church? I drive to work", "We need a big yard for our dog"]) {
    assert.equal(fairHousingConcern(t), null, t);
  }
});

test("a fair-housing-sensitive message gets a fixed neutral reply and goes to the agent, without asking the AI", async () => {
  // Observed with the real model: despite prompt rules it replied "I understand
  // you're looking for a community that aligns with your values".
  process.env.AGENT_NAME = "John Wallace";
  const lead = await leadWithStatus("qualifying");
  await inbound(lead, "We are a Christian family and want to be around people like us.");
  assert.equal(modelCalls, 0);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].text, /help everyone find a home based on what they need.*John Wallace will reach out/s);
  assert.doesNotMatch(sentEmails[0].text, /christian|values|people like/i);
  assert.equal((await statements.getLead.get(lead.id)).status, "handoff");
  assert.match(sentAlerts[0].reason, /Fair housing.*religion/);
  delete process.env.AGENT_NAME;
});
