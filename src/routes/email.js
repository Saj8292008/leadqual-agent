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
// Just what the lead wrote this time. Mail clients quote the whole earlier
// thread under a reply ("On Wed ... wrote: > ..."), so the raw text of a
// bare "2" picking a showing slot is "2" plus the quoted offer email —
// which never matches as a slot pick. AgentMail's extracted_text strips
// the quoted history; fall back to the raw text if it's absent.
function replyText(msg) {
  const extracted = (msg.extracted_text || "").trim();
  return extracted || (msg.text || "").trim();
}

// The slot number a reply picks, or null. Real replies aren't a bare digit
// (observed live: "1 works for me."), so accept any reply naming exactly one
// of the offered numbers — but not "2 or 3" (ambiguous) or "10am" (a time,
// not an option), which go to the AI / a human instead.
function slotPick(text, optionCount) {
  const numbers = new Set((text.match(/(?<![\d:$])\b\d+\b(?!\s*(?:am|pm|:\d|k\b|%))/gi) || []).map(Number));
  const options = [...numbers].filter((n) => n >= 1 && n <= optionCount);
  return options.length === 1 && numbers.size === 1 ? options[0] : null;
}

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
  const body = replyText(msg);

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

  // If we just offered numbered showing slots, a reply naming one of them is a pick.
  const fresh = await statements.getLead.get(lead.id);
  const offered = fresh.offered_slots ? JSON.parse(fresh.offered_slots) : [];
  const lastOutbound = (await statements.historyForLead.all(lead.id))
    .filter((m) => m.direction === "outbound")
    .pop();
  const awaitingSlotPick = offered.length && lastOutbound && /Reply with the number/i.test(lastOutbound.body);
  const pick = awaitingSlotPick ? slotPick(body, offered.length) : null;

  if (pick) {
    await confirmBooking(lead.id, pick);
    return;
  }

  await runTurn(lead.id);
}

module.exports = router;
module.exports.extractEmailAddress = extractEmailAddress;
module.exports.replyText = replyText;
module.exports.slotPick = slotPick;
