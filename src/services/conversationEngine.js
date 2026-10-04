const { statements } = require("../db");
const claude = require("./claude");
const email = require("./email");
const calendar = require("./calendar");
const alerts = require("./alerts");
const { formatForAgent } = require("../lib/time");

function subjectFor(lead) {
  return `Re: your home search${lead.name ? " — " + lead.name : ""}`;
}

async function recordMessage(leadId, direction, body, { subject, messageId } = {}) {
  await statements.insertMessage.run({
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

// Moves a lead to a human: status 'handoff', no more drips, and an alert.
async function handOff(leadId, reason) {
  const lead = await statements.getLead.get(leadId);
  await statements.updateLead.run({ ...lead, status: "handoff", next_followup_at: null });
  alerts
    .notifyHandoff({ lead: await statements.getLead.get(leadId), reason })
    .catch((alertErr) => console.error(`[handoff] alert failed for lead ${leadId}:`, alertErr));
}

// Runs one turn of the qualification conversation for a lead: loads history,
// asks Claude what to say/decide next, persists state, and sends the email.
async function runTurn(leadId) {
  const lead = await statements.getLead.get(leadId);
  const history = await statements.historyForLead.all(leadId);

  let decision;
  try {
    const pendingOptions = (lead.offered_slots ? JSON.parse(lead.offered_slots) : []).map((slot) =>
      describeSlot(slot, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    );
    decision = await claude.converse({ lead, history, pendingOptions });
  } catch (err) {
    // If the model can't produce a reply (provider down, timeouts, bad
    // output after retries), the lead would otherwise sit unanswered with
    // nothing ever retrying it — observed end-to-end with a lead who was
    // pre-approved and asking for a showing. Hand them to a human instead.
    await handOff(lead.id, `AI couldn't generate a reply (${err.message}) — please respond manually`);
    throw err;
  }

  // Only confirmBooking marks a lead booked — that's when a calendar event
  // actually exists. Observed live: the model replied "I've booked you" and
  // set booked with nothing on the calendar.
  // A handoff flag means the agent now owns the lead — record it as the
  // status, or the lead's next reply would go back to the AI (observed: the
  // model often sets handoff=true while leaving status "qualifying").
  const status = decision.handoff ? "handoff" : decision.status === "booked" ? "qualifying" : decision.status;

  const updated = {
    id: lead.id,
    status,
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
  await statements.updateLead.run(updated);

  if (decision.reply) {
    const subject = subjectFor(lead);
    const sent = await email.sendEmail({
      to: lead.email,
      subject,
      text: decision.reply,
      inReplyTo: await lastInboundMessageId(leadId),
    });
    await recordMessage(lead.id, "outbound", decision.reply, {
      subject,
      messageId: sent.messageId,
    });
  }

  // Don't resend the same options if they're already waiting on a pick, and
  // don't start booking a lead that was just handed to the agent.
  if (decision.ready_to_book && !decision.handoff && !lead.offered_slots) {
    await offerShowingSlots(lead.id);
  }

  if (decision.handoff) {
    const freshLead = await statements.getLead.get(lead.id);
    alerts.notifyHandoff({ lead: freshLead, reason: decision.notes }).catch((err) =>
      console.error(`[handoff] alert failed for lead ${lead.id}:`, err)
    );
  }

  return decision;
}

// Statuses where a person, not the AI, owns the conversation: the agent was
// handed the lead, a showing is booked (reschedules, questions about the
// visit), or the lead had gone dead and is writing back.
const HUMAN_OWNED_STATUSES = ["handoff", "booked", "dead"];

function isHumanOwned(lead) {
  return HUMAN_OWNED_STATUSES.includes(lead.status);
}

// A lead the agent owns wrote in. The AI stays quiet — replying would talk
// over the agent — and the agent gets the message instead.
async function forwardToAgent(leadId, text) {
  const lead = await statements.getLead.get(leadId);
  const why = {
    handoff: "You're handling this lead",
    booked: "This lead has a showing booked (they may want to reschedule or ask about it)",
    dead: "This lead had gone quiet and just wrote back",
  }[lead.status];
  await alerts.notifyHandoff({
    lead,
    reason: `${why}, so your assistant did not reply. They wrote: "${String(text).slice(0, 600)}" — please reply to them directly.`,
  });
}

async function lastInboundMessageId(leadId) {
  const history = await statements.historyForLead.all(leadId);
  const lastInbound = history.filter((m) => m.direction === "inbound").pop();
  return lastInbound ? lastInbound.message_id : null;
}

// A calendar failure (agent revoked access, Google token expired) after the
// lead was just told "I'll send some times" must reach a human, not vanish.
async function calendarCall(leadId, fn) {
  try {
    return await fn();
  } catch (err) {
    await handOff(
      leadId,
      `Calendar unavailable (${err.message}) — lead is ready to book a showing; schedule it manually and check the calendar connection`
    );
    throw err;
  }
}

function describeSlot(slot, options) {
  return formatForAgent(slot.start, options);
}

async function offerShowingSlots(leadId) {
  const lead = await statements.getLead.get(leadId);
  const slots = (await calendarCall(leadId, () => calendar.getAvailability({ days: 5 }))).slice(0, 3);
  if (!slots.length) return;

  // Remember exactly what was offered: availability can shift before the
  // lead replies, and "2" must book the second time they were shown.
  await statements.setOfferedSlots.run({ id: leadId, offered_slots: JSON.stringify(slots) });

  const formatted = slots
    .map((s, i) => `${i + 1}) ${describeSlot(s, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`)
    .join("\n");

  const body = `Great, I can get you in for a showing. A few options:\n${formatted}\nReply with the number that works best.\n\n— Sam`;
  const subject = subjectFor(lead);
  const sent = await email.sendEmail({
    to: lead.email,
    subject,
    text: body,
    inReplyTo: await lastInboundMessageId(leadId),
  });
  await recordMessage(lead.id, "outbound", body, { subject, messageId: sent.messageId });
}

// Called when the lead replies with a slot number after offerShowingSlots.
async function confirmBooking(leadId, slotIndex) {
  const lead = await statements.getLead.get(leadId);
  const offered = lead.offered_slots ? JSON.parse(lead.offered_slots) : [];
  const slot = offered[slotIndex - 1];
  const subject = subjectFor(lead);

  if (slot && new Date(slot.start) <= new Date()) {
    // Picked a time that has already passed (e.g. replied a day late) —
    // send fresh options rather than booking the past.
    await statements.setOfferedSlots.run({ id: leadId, offered_slots: null });
    await offerShowingSlots(leadId);
    return null;
  }

  if (!slot) {
    const body = `That number didn't match — can you reply with ${offered.map((_, i) => i + 1).join(", ") || "1, 2, or 3"}?`;
    const sent = await email.sendEmail({ to: lead.email, subject, text: body, inReplyTo: await lastInboundMessageId(leadId) });
    await recordMessage(lead.id, "outbound", body, { subject, messageId: sent.messageId });
    return null;
  }

  const event = await calendarCall(leadId, () => calendar.bookShowing({ lead, slot }));
  await statements.updateLead.run({ ...lead, status: "booked", next_followup_at: null });
  await statements.setOfferedSlots.run({ id: leadId, offered_slots: null });

  const body = `You're all set — showing confirmed for ${describeSlot(slot, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. See you then!\n\n— Sam`;
  const sent = await email.sendEmail({ to: lead.email, subject, text: body, inReplyTo: await lastInboundMessageId(leadId) });
  await recordMessage(lead.id, "outbound", body, { subject, messageId: sent.messageId });
  return event;
}

module.exports = {
  runTurn,
  isHumanOwned,
  forwardToAgent,
  offerShowingSlots,
  confirmBooking,
  subjectFor,
  nextFollowupTimestamp,
};
