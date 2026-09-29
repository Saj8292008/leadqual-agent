const express = require("express");
const { inBackground } = require("../lib/background");
const { statements } = require("../db");
const { runTurn, confirmBooking } = require("../services/conversationEngine");
const { isValidAgentMailSignature } = require("../middleware/webhookAuth");

const router = express.Router();

// Real mail clients send "From: Display Name <addr@example.com>", not a
// bare address — pull just the address out, or fall back to the raw value
// if it's already bare.
function extractEmailAddress(from) {
  if (typeof from !== "string") return from;
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}

// AgentMail webhook — register with:
//   POST https://api.agentmail.to/v0/webhooks
//   { "url": "<this>/webhooks/email", "event_types": ["message.received"], "inbox_ids": [AGENTMAIL_INBOX_ID] }
// and put the returned whsec_ secret in AGENTMAIL_WEBHOOK_SECRET.
router.post("/webhooks/email", async (req, res) => {
  if (!(await isValidAgentMailSignature(req))) {
    return res.status(401).json({ error: "bad signature" });
  }
  res.status(200).json({ ok: true }); // ack immediately, work happens in the background
  inBackground(
    handleInbound(req.body).catch((err) => console.error("[email] inbound processing failed:", err))
  );
});

async function handleInbound(evt) {
  if (evt.event_type !== "message.received") return;

  const msg = evt.message;
  const from = extractEmailAddress(msg.from);
  const body = (msg.text || "").trim();

  const lead = await statements.findLeadByEmail.get(from);
  if (!lead) {
    console.log(`[email] inbound from unknown sender ${from}: ${msg.subject}`);
    return;
  }

  if (msg.message_id && (await statements.messageByMessageId.get(msg.message_id))) {
    console.log(`[email] duplicate delivery of ${msg.message_id}, skipping (already processed)`);
    return;
  }

  await statements.insertMessage.run({
    lead_id: lead.id,
    direction: "inbound",
    channel: "email",
    subject: msg.subject || null,
    body,
    message_id: msg.message_id || null,
  });

  if (msg.thread_id && msg.thread_id !== lead.thread_id) {
    await statements.updateLead.run({ ...lead, thread_id: msg.thread_id });
  }

  // If we just offered numbered showing slots, treat a bare digit reply as a pick.
  const lastOutbound = (await statements.historyForLead.all(lead.id))
    .filter((m) => m.direction === "outbound")
    .pop();
  const awaitingSlotPick = lastOutbound && /Reply with the number/i.test(lastOutbound.body);

  if (awaitingSlotPick && /^\s*\d+\s*$/.test(body)) {
    await confirmBooking(lead.id, parseInt(body, 10));
    return;
  }

  await runTurn(lead.id);
}

module.exports = router;
module.exports.extractEmailAddress = extractEmailAddress;
