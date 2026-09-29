const { Webhook } = require("svix");

// Shared-secret check for inbound intake webhooks. Fails closed: if
// LEAD_WEBHOOK_SECRET isn't configured, a request with no header would
// otherwise match (undefined === undefined) and anyone could post leads.
function isValidWebhookSecret(req) {
  const expected = process.env.LEAD_WEBHOOK_SECRET;
  return Boolean(expected) && req.headers["x-webhook-secret"] === expected;
}

// AgentMail delivers webhooks through Svix, signed with the endpoint's whsec_
// secret. Without this check anyone who knows a lead's address could post a
// fake reply — including a bare "2" that books a showing. Fails closed when
// the secret isn't configured, same as the intake webhooks.
function isValidAgentMailSignature(req) {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret || !req.rawBody) return false;
  try {
    new Webhook(secret).verify(req.rawBody.toString("utf8"), {
      "svix-id": req.headers["svix-id"],
      "svix-timestamp": req.headers["svix-timestamp"],
      "svix-signature": req.headers["svix-signature"],
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { isValidWebhookSecret, isValidAgentMailSignature };
