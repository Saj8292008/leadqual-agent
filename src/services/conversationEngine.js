const { statements } = require("../db");
const claude = require("./claude");
const email = require("./email");
const calendar = require("./calendar");
const slack = require("./slack");

function subjectFor(lead) {
  return `Re: your home search${lead.name ? " — " + lead.name : ""}`;
}

function recordMessage(leadId, direction, body, { subject, messageId } = {}) {
  statements.insertMessage.run({
    lead_id: leadId,
    direction,
    channel: "email",
    subject: subject || null,
    body,
    message_id: messageId || null,
  });
}

function nextFollowupTimestamp(days) {
  if (!days) return null;
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

// Runs one turn of the qualification conversation for a lead: loads history,
// asks Claude what to say/decide next, persists state, and sends the email.
async function runTurn(leadId) {
  const lead = statements.getLead.get(leadId);
  const history = statements.historyForLead.all(leadId);

  let decision;
  try {
    decision = await claude.converse({ lead, history });
  } catch (err) {
    // If the model can't produce a reply (provider down, timeouts, bad
    // output after retries), the lead would otherwise sit unanswered with
    // nothing ever retrying it — observed end-to-end with a lead who was
    // pre-approved and asking for a showing. Hand them to a human instead.
    statements.updateLead.run({ ...lead, status: "handoff", next_followup_at: null });
    slack
      .notifyHandoff({
        lead: statements.getLead.get(lead.id),
        reason: `AI couldn't generate a reply (${err.message}) — please respond manually`,
      })
      .catch((slackErr) => console.error(`[handoff] slack alert failed for lead ${lead.id}:`, slackErr));
    throw err;
  }

  const updated = {
    id: lead.id,
    status: decision.status,
    budget: decision.budget ?? lead.budget,
    timeline: decision.timeline ?? lead.timeline,
    motivation: decision.motivation ?? lead.motivation,
    notes: decision.notes ?? lead.notes,
    thread_id: lead.thread_id,
    next_followup_at:
      decision.status === "nurture"
        ? nextFollowupTimestamp(decision.next_followup_days || 3)
        : null,
  };
  statements.updateLead.run(updated);

  if (decision.reply) {
    const subject = subjectFor(lead);
    const sent = await email.sendEmail({
      to: lead.email,
      subject,
      text: decision.reply,
      inReplyTo: lastInboundMessageId(leadId),
    });
    recordMessage(lead.id, "outbound", decision.reply, {
      subject,
      messageId: sent.messageId,
    });
  }

  if (decision.ready_to_book) {
    await offerShowingSlots(lead.id);
  }

  if (decision.handoff) {
    const freshLead = statements.getLead.get(lead.id);
    slack.notifyHandoff({ lead: freshLead, reason: decision.notes }).catch((err) =>
      console.error(`[handoff] slack alert failed for lead ${lead.id}:`, err)
    );
  }

  return decision;
}

function lastInboundMessageId(leadId) {
  const history = statements.historyForLead.all(leadId);
  const lastInbound = history.filter((m) => m.direction === "inbound").pop();
  return lastInbound ? lastInbound.message_id : null;
}

async function offerShowingSlots(leadId) {
  const lead = statements.getLead.get(leadId);
  const slots = await calendar.getAvailability({ days: 5 });
  if (!slots.length) return;

  const formatted = slots
    .slice(0, 3)
    .map((s, i) => `${i + 1}) ${new Date(s.start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`)
    .join("\n");

  const body = `Great, I can get you in for a showing. A few options:\n${formatted}\nReply with the number that works best.\n\n— Sam`;
  const subject = subjectFor(lead);
  const sent = await email.sendEmail({
    to: lead.email,
    subject,
    text: body,
    inReplyTo: lastInboundMessageId(leadId),
  });
  recordMessage(lead.id, "outbound", body, { subject, messageId: sent.messageId });
}

// Called when the lead replies with a slot number after offerShowingSlots.
async function confirmBooking(leadId, slotIndex) {
  const lead = statements.getLead.get(leadId);
  const slots = await calendar.getAvailability({ days: 5 });
  const slot = slots[slotIndex - 1];
  const subject = subjectFor(lead);

  if (!slot) {
    const body = "That number didn't match — can you reply with 1, 2, or 3?";
    const sent = await email.sendEmail({ to: lead.email, subject, text: body, inReplyTo: lastInboundMessageId(leadId) });
    recordMessage(lead.id, "outbound", body, { subject, messageId: sent.messageId });
    return null;
  }

  const event = await calendar.bookShowing({ lead, slot });
  statements.updateLead.run({ ...lead, status: "booked", next_followup_at: null });

  const body = `You're all set — showing confirmed for ${new Date(slot.start).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}. See you then!\n\n— Sam`;
  const sent = await email.sendEmail({ to: lead.email, subject, text: body, inReplyTo: lastInboundMessageId(leadId) });
  recordMessage(lead.id, "outbound", body, { subject, messageId: sent.messageId });
  return event;
}

module.exports = {
  runTurn,
  offerShowingSlots,
  confirmBooking,
  subjectFor,
  nextFollowupTimestamp,
};
