const { AgentMailClient } = require("agentmail");

const client = process.env.AGENTMAIL_API_KEY
  ? new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY })
  : null;

// Sends a reply in an existing thread when we have one (in_reply_to keeps
// the lead's inbox view as a single conversation), otherwise starts fresh.
async function sendEmail({ to, subject, text, inReplyTo }) {
  if (!client) {
    console.log(`[email:dry-run] -> ${to} | ${subject}\n${text}`);
    return { messageId: "dry-run" };
  }
  return client.inboxes.messages.send(process.env.AGENTMAIL_INBOX_ID, {
    to,
    subject,
    text,
    inReplyTo: inReplyTo || undefined,
  });
}

module.exports = { sendEmail };
