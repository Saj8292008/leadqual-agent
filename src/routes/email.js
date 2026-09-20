const express = require("express");
const { statements } = require("../db");
const { runTurn, confirmBooking } = require("../services/conversationEngine");

const router = express.Router();

// AgentMail webhook — register with:
//   POST https://api.agentmail.to/v0/webhooks
//   { "url": "<this>/webhooks/email", "event_types": ["message.received"], "inbox_ids": [AGENTMAIL_INBOX_ID] }
router.post("/webhooks/email", async (req, res) => {
  res.status(200).json({ ok: true }); // ack immediately, work happens async

  const evt = req.body;
  if (evt.event_type !== "message.received") return;

  const msg = evt.message;
  const from = msg.from;
  const body = (msg.text || "").trim();

  const lead = statements.findLeadByEmail.get(from);
  if (!lead) {
    console.log(`[email] inbound from unknown sender ${from}: ${msg.subject}`);
    return;
  }

  if (msg.message_id && statements.messageByMessageId.get(msg.message_id)) {
    console.log(`[email] duplicate delivery of ${msg.message_id}, skipping (already processed)`);
    return;
  }

  statements.insertMessage.run({
    lead_id: lead.id,
    direction: "inbound",
    channel: "email",
    subject: msg.subject || null,
    body,
    message_id: msg.message_id || null,
  });

  if (msg.thread_id && msg.thread_id !== lead.thread_id) {
    statements.updateLead.run({ ...lead, thread_id: msg.thread_id });
  }

  // If we just offered numbered showing slots, treat a bare digit reply as a pick.
  const lastOutbound = statements.historyForLead
    .all(lead.id)
    .filter((m) => m.direction === "outbound")
    .pop();
  const awaitingSlotPick = lastOutbound && /Reply with the number/i.test(lastOutbound.body);

  if (awaitingSlotPick && /^\s*\d+\s*$/.test(body)) {
    confirmBooking(lead.id, parseInt(body, 10)).catch((err) =>
      console.error(`[lead ${lead.id}] booking confirm failed:`, err)
    );
    return;
  }

  runTurn(lead.id).catch((err) => console.error(`[lead ${lead.id}] turn failed:`, err));
});

module.exports = router;
