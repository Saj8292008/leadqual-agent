const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isValidWebhookSecret } = require("../src/middleware/webhookAuth");

const req = (secret) => ({ headers: secret === undefined ? {} : { "x-webhook-secret": secret } });

test("rejects everything when LEAD_WEBHOOK_SECRET is not configured", () => {
  // Regression: with the env var unset, a request with no header matched
  // (undefined === undefined) and was accepted.
  delete process.env.LEAD_WEBHOOK_SECRET;
  assert.equal(isValidWebhookSecret(req(undefined)), false);
  assert.equal(isValidWebhookSecret(req("")), false);
});

test("accepts only the configured secret", () => {
  process.env.LEAD_WEBHOOK_SECRET = "s3cret";
  assert.equal(isValidWebhookSecret(req("s3cret")), true);
  assert.equal(isValidWebhookSecret(req("wrong")), false);
  assert.equal(isValidWebhookSecret(req(undefined)), false);
  delete process.env.LEAD_WEBHOOK_SECRET;
});
