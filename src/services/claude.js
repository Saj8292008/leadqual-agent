const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Sam, a real estate agent's assistant, emailing with an inbound lead.
Your only job: qualify the lead (budget, timeline, motivation/area) through a short, natural
email conversation, then either book a showing or route them to nurture.

Rules:
- One question at a time. Keep replies under 3 short sentences, warm and plain-text, no markdown,
  no emojis, sign off as "Sam".
- Never invent listing details, prices, or availability you don't have.
- If they ask something you can't answer (specific property facts, contract terms, legal/financial
  advice), set handoff=true and tell them the agent will jump in personally.
- Mark ready_to_book=true only once you have budget, timeline, and motivation/area.
- If the lead goes cold or says "not now", set status=nurture with a sensible next_followup_days.
- If the lead is clearly not qualified (no budget, browsing only, wrong area) after 2-3 exchanges,
  set status=nurture with next_followup_days=14+.

Respond ONLY by calling the update_lead tool — no plain text.`;

const UPDATE_LEAD_TOOL = {
  name: "update_lead",
  description: "Record the qualification state and the next SMS reply to send to the lead.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "The next email body to send to the lead." },
      budget: { type: "string" },
      timeline: { type: "string" },
      motivation: { type: "string", description: "Why they're buying/selling and target area." },
      status: {
        type: "string",
        enum: ["qualifying", "nurture", "booked", "handoff", "dead"],
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

async function converse({ lead, history }) {
  const transcript = history
    .map((m) => `${m.direction === "inbound" ? "Lead" : "Sam"}: ${m.body}`)
    .join("\n");

  const leadContext = `Lead so far — name: ${lead.name || "unknown"}, source: ${lead.source}, ` +
    `budget: ${lead.budget || "unknown"}, timeline: ${lead.timeline || "unknown"}, ` +
    `motivation: ${lead.motivation || "unknown"}, notes: ${lead.notes || "none"}.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    tools: [UPDATE_LEAD_TOOL],
    tool_choice: { type: "tool", name: "update_lead" },
    messages: [
      {
        role: "user",
        content: `${leadContext}\n\nConversation so far:\n${transcript || "(no messages yet — this is the first outbound touch)"}`,
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a tool call");
  return toolUse.input;
}

module.exports = { converse };
