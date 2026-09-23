const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Isolated DB for this test file (node --test runs each file in its own process).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));

const { statements } = require("../src/db");
const claude = require("../src/services/claude");
const slack = require("../src/services/slack");
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
  const originalNotify = slack.notifyHandoff;
  const alerts = [];
  claude.converse = async () => {
    throw new Error("z-ai/glm-5.3 request timed out after 45000ms");
  };
  slack.notifyHandoff = async (args) => alerts.push(args);

  try {
    await assert.rejects(runTurn(leadId), /timed out/);
  } finally {
    claude.converse = originalConverse;
    slack.notifyHandoff = originalNotify;
  }

  const lead = statements.getLead.get(leadId);
  assert.equal(lead.status, "handoff");
  assert.equal(lead.next_followup_at, null);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].lead.id, leadId);
  assert.match(alerts[0].reason, /couldn't generate a reply.*timed out/);
});
