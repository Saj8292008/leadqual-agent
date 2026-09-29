const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Isolated DB for this test file (node --test runs each file in its own process).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));

const { statements } = require("../src/db");
const claude = require("../src/services/claude");
const alerts = require("../src/services/alerts");
const { runTurn } = require("../src/services/conversationEngine");

test("a failed model call hands the lead to a human instead of silently dropping them", async () => {
  // Regression: observed end-to-end — every provider attempt timed out, the
  // lead stayed 'qualifying' with no reply, no retry, and no human alerted.
  const info = statements.insertLead.run({
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

  const lead = statements.getLead.get(leadId);
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

  for (const [label, run] of [
    ["offering slots", (id) => offerShowingSlots(id)],
    ["confirming a pick", (id) => confirmBooking(id, 1)],
  ]) {
    const info = statements.insertLead.run({ source: "zillow", name: `Cal ${label}`, email: `cal-${label.replace(/ /g, "-")}@example.com`, notes: null });
    const leadId = info.lastInsertRowid;
    const originalAvail = calendar.getAvailability;
    const originalNotify = alerts.notifyHandoff;
    const sent = [];
    calendar.getAvailability = async () => {
      throw new Error("invalid_grant");
    };
    alerts.notifyHandoff = async (args) => sent.push(args);
    try {
      await assert.rejects(run(leadId), /invalid_grant/);
    } finally {
      calendar.getAvailability = originalAvail;
      alerts.notifyHandoff = originalNotify;
    }
    assert.equal(statements.getLead.get(leadId).status, "handoff", label);
    assert.equal(sent.length, 1, label);
    assert.match(sent[0].reason, /Calendar unavailable.*invalid_grant/, label);
  }
});
