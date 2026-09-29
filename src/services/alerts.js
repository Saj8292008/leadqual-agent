const email = require("./email");

// Tells the human agent something needs them. Goes to HANDOFF_ALERT_EMAIL
// (sent from the AgentMail inbox) and/or a Slack Incoming Webhook at
// HANDOFF_SLACK_WEBHOOK_URL — whichever are configured. Neither set = log only.
async function notifyHandoff({ lead, reason }) {
  const who = lead.name || lead.email;
  const why = reason || "no reason given";
  const details = `Source: ${lead.source} | Budget: ${lead.budget || "?"} | Timeline: ${lead.timeline || "?"}`;

  const alertEmail = process.env.HANDOFF_ALERT_EMAIL;
  const slackUrl = process.env.HANDOFF_SLACK_WEBHOOK_URL;

  if (!alertEmail && !slackUrl) {
    console.log(`[alert:dry-run] ${who} needs a human — ${why}\n${details}`);
    return;
  }

  // Deliver to every configured channel; one failing mustn't block the other.
  const deliveries = [];
  if (alertEmail) {
    deliveries.push(
      email.sendEmail({
        to: alertEmail,
        subject: `Needs you: ${who}`,
        text: `${who} needs a human — ${why}\n\n${details}` + (lead.email ? `\nReply to them at: ${lead.email}` : ""),
      })
    );
  }
  if (slackUrl) {
    const text = `:wave: *${who}* needs a human — ${why}\n${details}` +
      (lead.email ? `\n<mailto:${lead.email}|${lead.email}>` : "");
    deliveries.push(
      fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`slack webhook post failed: ${res.status} ${await res.text()}`);
      })
    );
  }

  const results = await Promise.allSettled(deliveries);
  for (const r of results) {
    if (r.status === "rejected") console.error(`[alert] delivery failed for ${who}:`, r.reason);
  }
}

module.exports = { notifyHandoff };
