const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Webhook } = require("svix");
const { isValidAgentMailSignature } = require("../src/middleware/webhookAuth");

const SECRET = "whsec_" + Buffer.from("test-signing-secret-32-bytes-long!").toString("base64");
const OTHER_SECRET = "whsec_" + Buffer.from("some-other-secret-32-bytes-long!!").toString("base64");

// Builds a request the way AgentMail (via Svix) delivers it.
function signedReq(body, { secret = SECRET, sentAt = new Date(), tamper } = {}) {
  const id = "msg_test123";
  const signature = new Webhook(secret).sign(id, sentAt, body);
  return {
    rawBody: Buffer.from(tamper ?? body),
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(sentAt.getTime() / 1000)),
      "svix-signature": signature,
    },
  };
}

const body = JSON.stringify({
  event_type: "message.received",
  message: { from: "jordan@example.com", text: "2", message_id: "m1" },
});

test("accepts a genuinely signed AgentMail delivery", async () => {
  process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
  assert.equal(await isValidAgentMailSignature(signedReq(body)), true);
});

test("rejects a forged reply with no signature (anyone could book a showing as the lead)", async () => {
  process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
  assert.equal(await isValidAgentMailSignature({ rawBody: Buffer.from(body), headers: {} }), false);
});

test("rejects a body altered after signing", async () => {
  process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
  assert.equal(await isValidAgentMailSignature(signedReq(body, { tamper: body.replace('"2"', '"3"') })), false);
});

test("rejects a signature made with a different secret", async () => {
  process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
  assert.equal(await isValidAgentMailSignature(signedReq(body, { secret: OTHER_SECRET })), false);
});

test("rejects a replayed delivery older than the tolerance window", async () => {
  process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  assert.equal(await isValidAgentMailSignature(signedReq(body, { sentAt: anHourAgo })), false);
});

test("rejects everything when AGENTMAIL_WEBHOOK_SECRET is not configured", async () => {
  delete process.env.AGENTMAIL_WEBHOOK_SECRET;
  assert.equal(await isValidAgentMailSignature(signedReq(body)), false);
});
