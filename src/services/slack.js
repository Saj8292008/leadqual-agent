// Posts to a Slack Incoming Webhook. Create one at
// https://api.slack.com/apps -> your app -> Incoming Webhooks, then set
// HANDOFF_SLACK_WEBHOOK_URL in .env.
async function notifyHandoff({ lead, reason }) {
  const url = process.env.HANDOFF_SLACK_WEBHOOK_URL;
  const text = `:wave: *${lead.name || lead.email}* needs a human — ${reason || "no reason given"}\n` +
    `Source: ${lead.source} | Budget: ${lead.budget || "?"} | Timeline: ${lead.timeline || "?"}\n` +
    `<mailto:${lead.email}|${lead.email}>`;

  if (!url) {
    console.log(`[slack:dry-run] ${text}`);
    return;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    console.error(`[slack] webhook post failed: ${res.status} ${await res.text()}`);
  }
}

module.exports = { notifyHandoff };
