const { test } = require("node:test");
const assert = require("node:assert/strict");

test("notifyHandoff dry-runs to console when no webhook URL is set", async () => {
  delete process.env.HANDOFF_SLACK_WEBHOOK_URL;
  const { notifyHandoff } = require("../src/services/slack");

  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    await notifyHandoff({
      lead: { name: "Jordan Lee", email: "jordan@example.com", source: "website" },
      reason: "asked about contract terms",
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.match(logs[0], /Jordan Lee/);
  assert.match(logs[0], /asked about contract terms/);
});
