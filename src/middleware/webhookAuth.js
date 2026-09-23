// Shared-secret check for inbound intake webhooks. Fails closed: if
// LEAD_WEBHOOK_SECRET isn't configured, a request with no header would
// otherwise match (undefined === undefined) and anyone could post leads.
function isValidWebhookSecret(req) {
  const expected = process.env.LEAD_WEBHOOK_SECRET;
  return Boolean(expected) && req.headers["x-webhook-secret"] === expected;
}

module.exports = { isValidWebhookSecret };
