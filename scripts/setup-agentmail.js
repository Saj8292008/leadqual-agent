// One-time setup: creates the inbox and registers the inbound webhook.
// Usage: AGENTMAIL_API_KEY=... node scripts/setup-agentmail.js https://your-public-url.com
require("dotenv").config();
const { AgentMailClient } = require("agentmail");

async function main() {
  const publicUrl = process.argv[2];
  if (!publicUrl) {
    console.error("Usage: node scripts/setup-agentmail.js https://your-public-url.com");
    process.exit(1);
  }
  if (!process.env.AGENTMAIL_API_KEY) {
    console.error("Set AGENTMAIL_API_KEY in .env first.");
    process.exit(1);
  }

  const client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });

  const inbox = await client.inboxes.create({ clientId: "leadqual-agent-v1" });
  console.log(`Inbox created: ${inbox.inboxId}  (${inbox.inbox || inbox.address || ""})`);
  console.log(`Add to .env: AGENTMAIL_INBOX_ID=${inbox.inboxId}`);

  const webhook = await client.webhooks.create({
    url: `${publicUrl.replace(/\/$/, "")}/webhooks/email`,
    eventTypes: ["message.received"],
    inboxIds: [inbox.inboxId],
  });
  console.log(`Webhook registered: ${webhook.webhookId} -> ${publicUrl}/webhooks/email`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
