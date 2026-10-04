const { statements } = require("../db");
const claude = require("./claude");
const email = require("./email");
const calendar = require("./calendar");
const alerts = require("./alerts");
const { formatForAgent } = require("../lib/time");

function subjectFor(lead) {
  return `Re: your home search${lead.name ? " — " + lead.name : ""}`;
}

// Every email to a lead goes through here. A lead who opted out is never
// emailed again, whichever code path (reply, drip, booking) tries to.
async function sendToLead(lead, { subject, text, inReplyTo }) {
  const current = await statements.getLead.get(lead.id);
  if (current.opted_out_at) {
    console.log(`[email] lead ${lead.id} opted out — not sending "${subject}"`);
    return null;
  }
  const sent = await email.sendEmail({ to: current.email, subject, text, inReplyTo });
  await recordMessage(lead.id, "outbound", text, { subject, messageId: sent.messageId });
  return sent;
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

// Fair housing safety net. When a lead's message brings up a protected
// characteristic as a search criterion, or asks to exclude groups, the model
// sometimes echoed it back ("a community that aligns with your values" —
// observed with the real model despite the prompt rules). These messages
// get a fixed, neutral reply and go to the agent; the model isn't asked.
// Deliberately narrow: "we have two kids, need 3 bedrooms" is normal and
// still goes to the AI.
const FAIR_HOUSING_PATTERNS = [
  ["religion", /\b(christian|muslim|islamic|jewish|catholic|hindu|buddhist|sikh|mormon|church[- ]going|mosque|synagogue|temple)\b/i],
  ["race or ethnicity", /\b(black|white|hispanic|latino|latina|asian|african[- ]american|caucasian|indian|arab|ethnic|ethnicity|racial|race)\s+(neighborhood|area|community|people|families|folks|residents|population)\b/i],
  ["people like us", /\bpeople like (us|me)\b|\b(our|my) kind of people\b/i],
  ["excluding groups", /\b(without|no|fewer|not (a lot|many|too many)|away from)\b[^.?!]{0,30}\b(section\s*8|renters|immigrants|foreigners|minorities|low[- ]income|projects|government housing)\b/i],
  ["demographics", /\b(demographics?|diverse|diversity|integrated)\b/i],
];

function fairHousingConcern(text) {
  for (const [category, pattern] of FAIR_HOUSING_PATTERNS) {
    if (pattern.test(String(text || ""))) return category;
  }
  return null;
}

function fairHousingReply() {
  const agent = process.env.AGENT_NAME || "the agent";
  return `Thanks for reaching out! I help everyone find a home based on what they need, like budget, size, commute and features. ${agent} will reach out to you personally to help with your search.\n\nSam`;
}

// Runs one turn of the qualification conversation for a lead: loads history,
// asks Claude what to say/decide next, persists state, and sends the email.
async function runTurn(leadId) {
  const lead = await statements.getLead.get(leadId);
  if (lead.opted_out_at) return null;
  const history = await statements.historyForLead.all(leadId);

  const lastInbound = history.filter((m) => m.direction === "inbound").pop();
  const concern = fairHousingConcern(lastInbound ? lastInbound.body : lead.notes);
  if (concern) {
    await sendToLead(lead, { subject: subjectFor(lead), text: fairHousingReply(), inReplyTo: await lastInboundMessageId(leadId) });
    await handOff(
      leadId,
      `Fair housing: the lead's message raised ${concern} as a search criterion, so your assistant sent a neutral ` +
        `reply and stopped. Please follow up personally and keep the search to needs, budget and location.`
    );
    return { status: "handoff", handoff: true, fair_housing: concern };
  }

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
    await sendToLead(lead, {
      subject: subjectFor(lead),
      text: decision.reply,
      inReplyTo: await lastInboundMessageId(leadId),
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

// Requests to stop. Checked before anything else on every reply and never
// left to the AI's judgement: once a lead asks, nothing goes to them again
// (CAN-SPAM). Matches the whole reply being "stop"/"unsubscribe", or an
// explicit stop/remove-me phrase anywhere in it.
const OPT_OUT_WHOLE = /^\s*(stop|unsubscribe|opt[\s-]?out|remove me|stop all|cancel|quit|end)\s*[.!]*\s*$/i;
const OPT_OUT_PHRASE = new RegExp(
  [
    "\\bunsubscribe\\b",
    "\\bopt(?:ing)?[\\s-]?out\\b",
    "\\bstop (?:emailing|contacting|messaging|sending|writing|reaching out)\\b",
    "\\b(?:remove|take) me off\\b",
    "\\bremove me from\\b",
    "\\b(?:do not|don'?t|never) (?:email|contact|message|write to|reach out to) me\\b",
    "\\bno (?:more|further) (?:emails|messages|contact)\\b",
    "\\bleave me alone\\b",
  ].join("|"),
  "i"
);

function isOptOut(text) {
  const t = String(text || "");
  return OPT_OUT_WHOLE.test(t) || OPT_OUT_PHRASE.test(t);
}

async function optOut(leadId, text) {
  await statements.markOptedOut.run({ id: leadId });
  const lead = await statements.getLead.get(leadId);
  await alerts.notifyHandoff({
    lead,
    reason: `This lead asked not to be contacted ("${String(text).slice(0, 200)}"). Your assistant has stopped ` +
      `emailing them permanently. Please don't add them back to automated follow-ups.`,
  });
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
  await sendToLead(lead, { subject: subjectFor(lead), text: body, inReplyTo: await lastInboundMessageId(leadId) });
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
    await sendToLead(lead, { subject, text: body, inReplyTo: await lastInboundMessageId(leadId) });
    return null;
  }

  const event = await calendarCall(leadId, () => calendar.bookShowing({ lead, slot }));
  await statements.updateLead.run({ ...lead, status: "booked", next_followup_at: null });
  await statements.setOfferedSlots.run({ id: leadId, offered_slots: null });

  const body = `You're all set — showing confirmed for ${describeSlot(slot, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. See you then!\n\n— Sam`;
  await sendToLead(lead, { subject, text: body, inReplyTo: await lastInboundMessageId(leadId) });
  return event;
}

module.exports = {
  runTurn,
  isHumanOwned,
  forwardToAgent,
  isOptOut,
  optOut,
  fairHousingConcern,
  offerShowingSlots,
  confirmBooking,
  subjectFor,
  nextFollowupTimestamp,
};
