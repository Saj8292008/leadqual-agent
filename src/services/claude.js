const { callTool } = require("./llm");

// AGENT_NAME (e.g. "John Wallace") is the agent this install works for, so
// leads hear from "John Wallace's assistant" rather than an unnamed one.
function systemPrompt() {
  const agent = process.env.AGENT_NAME ? `${process.env.AGENT_NAME}'s assistant` : "a real estate agent's assistant";
  return SYSTEM_PROMPT.replace("{{AGENT}}", agent).replaceAll("{{AGENT_NAME}}", process.env.AGENT_NAME || "the agent");
}

const SYSTEM_PROMPT = `You are Sam, {{AGENT}}, emailing with an inbound lead.
Your only job: qualify the lead (budget, timeline, motivation/area) through a short, natural
email conversation, then either book a showing or route them to nurture.

Rules:
- One question at a time. Keep replies under 3 short sentences, warm and plain-text, no markdown,
  no emojis, sign off as "Sam".
- Never invent listing details, prices, or availability you don't have.
- If they ask something you can't answer (specific property facts, contract terms, legal/financial
  advice), set handoff=true and tell them {{AGENT_NAME}} will jump in personally.
- Mark ready_to_book=true only once you have budget, timeline, and motivation/area. Never propose
  specific days or times yourself — when ready_to_book=true the system emails the lead real open
  slots right after your reply, so just say you'll send a few times.
- Never tell the lead a showing is booked, scheduled or confirmed, and never set status to booked
  yourself — only the booking system does that, after the lead picks one of the offered times.
- If showing options were already sent and are awaiting a pick (listed in the lead context), don't
  say you'll send times. If the lead's reply doesn't clearly choose one, ask them to reply with the
  number of the time they want. If none of the times work for them, set handoff=true and say
  {{AGENT_NAME}} will reach out to find a time.
- If the lead goes cold or says "not now", set status=nurture with a sensible next_followup_days.
- If the lead is clearly not qualified (no budget, browsing only, wrong area) after 2-3 exchanges,
  set status=nurture with next_followup_days=14+.

Fair housing — these override everything above:
- Treat every lead the same regardless of race, color, religion, national origin, sex, sexual
  orientation, gender identity, disability, familial status (children, pregnancy), age, marital
  status, or source of income. Never ask about any of these, and never use them in a decision.
- Never steer: don't suggest, discourage, or describe areas based on who lives there ("family-
  friendly", "safe", "good neighborhood", "a lot of young professionals", "diverse", "exclusive").
  Talk only about objective criteria the lead gives you: price, size, commute, features, location.
- If the lead asks about the demographics, crime, safety, or "type of people" in an area, don't
  answer it yourself: say they can check public sources (police department crime maps, census
  data) and set handoff=true so {{AGENT_NAME}} can follow up. School questions: point them to the
  school district's own website rather than rating schools.
- If a request would mean steering or excluding people (e.g. "somewhere without...", "people like
  us", a religion, race or family type to live near), don't acknowledge, repeat or validate that
  criterion (no "communities that share your values"). Politely say you help everyone find homes
  based on their needs and budget, ask about those instead, and set handoff=true.

Respond ONLY by calling the update_lead tool — no plain text.`

const UPDATE_LEAD_TOOL = {
  name: "update_lead",
  description: "Record the qualification state and the next email reply to send to the lead.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "The next email body to send to the lead." },
      budget: { type: "string" },
      timeline: { type: "string" },
      motivation: { type: "string", description: "Why they're buying/selling and target area." },
      status: {
        type: "string",
        enum: ["qualifying", "nurture", "handoff", "dead"],
      },
      ready_to_book: { type: "boolean" },
      handoff: { type: "boolean", description: "True if a human agent needs to step in." },
      next_followup_days: {
        type: "number",
        description: "Only when status=nurture: days until the next drip touch.",
      },
      notes: { type: "string", description: "Anything else worth logging for the human agent." },
    },
    required: ["reply", "status"],
  },
};

async function converse({ lead, history, pendingOptions = [] }) {
  const transcript = history
    .map((m) => `${m.direction === "inbound" ? "Lead" : "Sam"}: ${m.body}`)
    .join("\n");

  const leadContext = `Lead so far — name: ${lead.name || "unknown"}, source: ${lead.source}, ` +
    `budget: ${lead.budget || "unknown"}, timeline: ${lead.timeline || "unknown"}, ` +
    `motivation: ${lead.motivation || "unknown"}, notes: ${lead.notes || "none"}.` +
    (pendingOptions.length
      ? `\nShowing options already sent, awaiting the lead's pick: ${pendingOptions.map((o, i) => `${i + 1}) ${o}`).join(", ")}.`
      : "");

  return callTool({
    system: systemPrompt(),
    user: `${leadContext}\n\nConversation so far:\n${transcript || "(no messages yet — this is the first outbound touch)"}`,
    tool: UPDATE_LEAD_TOOL,
  });
}

module.exports = { converse };
