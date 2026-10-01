const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Isolated DB for this test file (node --test runs each file in its own process).
process.env.AGENT_TIMEZONE = "America/Chicago";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));

const { statements } = require("../src/db");
const claude = require("../src/services/claude");
const alerts = require("../src/services/alerts");
const { runTurn } = require("../src/services/conversationEngine");

test("a failed model call hands the lead to a human instead of silently dropping them", async () => {
  // Regression: observed end-to-end — every provider attempt timed out, the
  // lead stayed 'qualifying' with no reply, no retry, and no human alerted.
  const info = await statements.insertLead.run({
    source: "zillow",
    name: "Jordan Lee",
    email: "jordan@example.com",
    notes: null,
  });
  const leadId = info.lastInsertRowid;

  const originalConverse = claude.converse;
  const originalNotify = alerts.notifyHandoff;
  const sent = [];
  claude.converse = async () => {
    throw new Error("z-ai/glm-5.3 request timed out after 45000ms");
  };
  alerts.notifyHandoff = async (args) => sent.push(args);

  try {
    await assert.rejects(runTurn(leadId), /timed out/);
  } finally {
    claude.converse = originalConverse;
    alerts.notifyHandoff = originalNotify;
  }

  const lead = await statements.getLead.get(leadId);
  assert.equal(lead.status, "handoff");
  assert.equal(lead.next_followup_at, null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].lead.id, leadId);
  assert.match(sent[0].reason, /couldn't generate a reply.*timed out/);
});

test("a calendar failure while booking hands the lead to a human", async () => {
  // A disconnected/expired Google Calendar must not leave a ready-to-book
  // lead waiting on slots that never arrive.
  const calendar = require("../src/services/calendar");
  const { offerShowingSlots, confirmBooking } = require("../src/services/conversationEngine");
  const slot = { start: "2099-07-07T15:00:00.000Z", end: "2099-07-07T16:00:00.000Z" };

  for (const [label, failingCall, run] of [
    ["offering slots", "getAvailability", (id) => offerShowingSlots(id)],
    ["confirming a pick", "bookShowing", async (id) => {
      await statements.setOfferedSlots.run({ id, offered_slots: JSON.stringify([slot]) });
      return confirmBooking(id, 1);
    }],
  ]) {
    const info = await statements.insertLead.run({ source: "zillow", name: `Cal ${label}`, email: `cal-${label.replace(/ /g, "-")}@example.com`, notes: null });
    const leadId = info.lastInsertRowid;
    const originalCall = calendar[failingCall];
    const originalNotify = alerts.notifyHandoff;
    const sent = [];
    calendar[failingCall] = async () => {
      throw new Error("invalid_grant");
    };
    alerts.notifyHandoff = async (args) => sent.push(args);
    try {
      await assert.rejects(run(leadId), /invalid_grant/);
    } finally {
      calendar[failingCall] = originalCall;
      alerts.notifyHandoff = originalNotify;
    }
    assert.equal((await statements.getLead.get(leadId)).status, "handoff", label);
    assert.equal(sent.length, 1, label);
    assert.match(sent[0].reason, /Calendar unavailable.*invalid_grant/, label);
  }
});

test("a numeric reply books exactly the time the lead was shown, even if availability changed since", async () => {
  // Regression: confirmBooking re-fetched availability and took slots[n-1];
  // once an hour passed or the agent's calendar changed, the list shifted
  // and the lead was booked into a different time than the one they picked.
  const calendar = require("../src/services/calendar");
  const email = require("../src/services/email");
  const { offerShowingSlots, confirmBooking } = require("../src/services/conversationEngine");

  const info = await statements.insertLead.run({ source: "zillow", name: "Pick Test", email: "pick@example.com", notes: null });
  const leadId = info.lastInsertRowid;
  const slotAt = (iso) => ({ start: iso, end: new Date(new Date(iso).getTime() + 3600000).toISOString() });
  const offered = [slotAt("2099-07-07T14:00:00.000Z"), slotAt("2099-07-07T15:00:00.000Z"), slotAt("2099-07-07T16:00:00.000Z")];

  const originals = { avail: calendar.getAvailability, book: calendar.bookShowing, send: email.sendEmail };
  const booked = [];
  const emails = [];
  email.sendEmail = async (args) => (emails.push(args), { messageId: null });
  calendar.bookShowing = async ({ slot }) => (booked.push(slot), { id: "evt" });
  try {
    calendar.getAvailability = async () => offered;
    await offerShowingSlots(leadId);
    // Time passes: the 9am slot is gone, so a fresh lookup would shift by one.
    calendar.getAvailability = async () => offered.slice(1);
    await confirmBooking(leadId, 2);
  } finally {
    calendar.getAvailability = originals.avail;
    calendar.bookShowing = originals.book;
    email.sendEmail = originals.send;
  }

  assert.deepEqual(booked, [offered[1]]);
  assert.equal((await statements.getLead.get(leadId)).status, "booked");
  // Shown to the lead in the agent's timezone (10:00 AM Central), not the server's UTC.
  assert.match(emails[0].text, /2\) .*10:00/);
  assert.match(emails[1].text, /10:00/);
});

test("the AI can't mark a lead booked — only an actual calendar booking does", async () => {
  // Regression: observed live — the model replied "I've booked you for
  // Thursday" and set status=booked, with nothing on the calendar.
  const email = require("../src/services/email");
  const info = await statements.insertLead.run({ source: "zillow", name: "No Fake Booking", email: "nofake@example.com", notes: null });
  const leadId = info.lastInsertRowid;
  const originals = { converse: claude.converse, send: email.sendEmail };
  claude.converse = async () => ({ reply: "Thanks!", status: "booked" });
  email.sendEmail = async () => ({ messageId: null });
  try {
    await runTurn(leadId);
  } finally {
    claude.converse = originals.converse;
    email.sendEmail = originals.send;
  }
  assert.equal((await statements.getLead.get(leadId)).status, "qualifying");
});

test("picking an option whose time has already passed sends fresh options instead of booking the past", async () => {
  const calendar = require("../src/services/calendar");
  const email = require("../src/services/email");
  const { confirmBooking } = require("../src/services/conversationEngine");
  const info = await statements.insertLead.run({ source: "zillow", name: "Late Pick", email: "late@example.com", notes: null });
  const leadId = info.lastInsertRowid;
  const past = { start: "2020-01-01T15:00:00.000Z", end: "2020-01-01T16:00:00.000Z" };
  const future = { start: "2099-01-05T15:00:00.000Z", end: "2099-01-05T16:00:00.000Z" };
  await statements.setOfferedSlots.run({ id: leadId, offered_slots: JSON.stringify([past]) });

  const originals = { avail: calendar.getAvailability, book: calendar.bookShowing, send: email.sendEmail };
  const booked = [];
  const sent = [];
  calendar.getAvailability = async () => [future];
  calendar.bookShowing = async ({ slot }) => (booked.push(slot), { id: "evt" });
  email.sendEmail = async (args) => (sent.push(args), { messageId: null });
  try {
    await confirmBooking(leadId, 1);
  } finally {
    calendar.getAvailability = originals.avail;
    calendar.bookShowing = originals.book;
    email.sendEmail = originals.send;
  }
  assert.equal(booked.length, 0);
  assert.match(sent[0].text, /A few options/);
  assert.deepEqual(JSON.parse((await statements.getLead.get(leadId)).offered_slots), [future]);
});
