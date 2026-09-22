const { AgentMailClient } = require("agentmail");

const client = process.env.AGENTMAIL_API_KEY
  ? new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY })
  : null;

// Sends a reply in an existing thread when we have one (in_reply_to keeps
// the lead's inbox view as a single conversation), otherwise starts fresh.
async function sendEmail({ to, subject, text, inReplyTo }) {
  if (!client) {
    console.log(`[email:dry-run] -> ${to} | ${subject}\n${text}`);
    // null, not a fixed placeholder string — messages.message_id has a
    // unique index (for real webhook dedup), and SQLite unique indexes
    // ignore NULLs, so this can't collide across multiple dry-run sends.
    return { messageId: null };
  }
  return client.inboxes.messages.send(process.env.AGENTMAIL_INBOX_ID, {
    to,
    subject,
    text,
    inReplyTo: inReplyTo || undefined,
  });
}

module.exports = { sendEmail };
