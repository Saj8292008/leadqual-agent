const { test } = require("node:test");
const assert = require("node:assert/strict");
const email = require("../src/services/email");
const alerts = require("../src/services/alerts");

const lead = { name: "Jordan Lee", email: "jordan@example.com", source: "zillow", budget: "$450k", timeline: "Nov" };

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return fn().finally(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

test("logs instead of sending when no alert destination is configured", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    await withEnv({ HANDOFF_ALERT_EMAIL: undefined, HANDOFF_SLACK_WEBHOOK_URL: undefined }, () =>
      alerts.notifyHandoff({ lead, reason: "asked about contract terms" })
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Jordan Lee/);
  assert.match(logs[0], /asked about contract terms/);
});

test("emails the handoff alert to HANDOFF_ALERT_EMAIL with the lead's details", async () => {
  const sent = [];
  const original = email.sendEmail;
  email.sendEmail = async (args) => sent.push(args);
  try {
    await withEnv({ HANDOFF_ALERT_EMAIL: "agent@example.com", HANDOFF_SLACK_WEBHOOK_URL: undefined }, () =>
      alerts.notifyHandoff({ lead, reason: "asked about HOA fees" })
    );
  } finally {
    email.sendEmail = original;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "agent@example.com");
  assert.match(sent[0].subject, /Jordan Lee/);
  assert.match(sent[0].text, /asked about HOA fees/);
  assert.match(sent[0].text, /\$450k/);
  assert.match(sent[0].text, /jordan@example\.com/);
});

test("a failed alert delivery is logged, not thrown into the caller", async () => {
  const original = email.sendEmail;
  email.sendEmail = async () => {
    throw new Error("agentmail down");
  };
  try {
    await withEnv({ HANDOFF_ALERT_EMAIL: "agent@example.com", HANDOFF_SLACK_WEBHOOK_URL: undefined }, () =>
      alerts.notifyHandoff({ lead, reason: "x" })
    );
  } finally {
    email.sendEmail = original;
  }
});
