const llm = require("./llm");
const { statements } = require("../db");
const alerts = require("./alerts");

// Turns "new lead" notification emails — from the agent's website platform,
// Zillow, Realtor.com, a Facebook-leads CRM, anything that emails the agent
// when someone inquires — into leads, so a source only needs to BCC or
// forward its alerts to the assistant's inbox.

const EXTRACT_SYSTEM = `You read a single email and decide whether it is a notification about a new
real estate lead (someone who filled in a contact form, requested info on a listing, or responded
to an ad). If it is, extract the lead's own details — not the sender's, not the agent's. The lead's
email is usually in the body, not the From line. Never invent details that aren't in the email.
Respond ONLY by calling the record_lead tool.`;

const RECORD_LEAD_TOOL = {
  name: "record_lead",
  description: "Record whether this email is a new-lead notification, and the lead's details if so.",
  input_schema: {
    type: "object",
    properties: {
      is_lead: { type: "boolean", description: "True only if this email notifies of a new lead/inquiry." },
      name: { type: "string" },
      email: { type: "string", description: "The lead's own email address, if present." },
      phone: { type: "string" },
      source: { type: "string", description: "Where the lead came from, e.g. website, facebook, zillow." },
      inquiry: { type: "string", description: "What they asked about or said, in a sentence or two." },
    },
    required: ["is_lead"],
  },
};

// LEAD_INTAKE_ALLOWED_SENDERS: comma-separated addresses or "@domain" entries
// whose lead alerts may be acted on automatically. Anyone can email the
// intake inbox, and an automatic reply goes to whatever address the email
// names — so unknown senders are flagged to the agent, never auto-contacted.
function isAllowedSender(address) {
  const allowed = (process.env.LEAD_INTAKE_ALLOWED_SENDERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const addr = String(address || "").toLowerCase();
  return allowed.some((entry) => (entry.startsWith("@") ? addr.endsWith(entry) : addr === entry));
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function describe(lead) {
  return [lead.name, lead.email, lead.phone].filter(Boolean).join(" · ") || "no contact details";
}

async function handleLeadAlert({ sender, subject, text }) {
  const lead = await llm.callTool({
    system: EXTRACT_SYSTEM,
    user: `From: ${sender}\nSubject: ${subject || ""}\n\n${(text || "").slice(0, 8000)}`,
    tool: RECORD_LEAD_TOOL,
  });

  if (!lead.is_lead) {
    console.log(`[intake] not a lead notification, ignoring: "${subject}" from ${sender}`);
    return { action: "ignored" };
  }

  const source = (lead.source || "website").toLowerCase();
  const notes = [lead.inquiry, lead.phone && `Phone: ${lead.phone}`].filter(Boolean).join(" — ") || null;
  const asAlertLead = { name: lead.name || lead.email || "New lead", email: lead.email || "", source };

  if (!isAllowedSender(sender)) {
    await alerts.notifyHandoff({
      lead: asAlertLead,
      reason: `Possible new lead from an unrecognized sender (${sender}), so the assistant did NOT contact them — ` +
        `please follow up yourself. Lead: ${describe(lead)}. If ${sender} is one of your lead sources, ` +
        `reply to let us know and future leads from it will be handled automatically.`,
    });
    return { action: "flagged_unknown_sender" };
  }

  const email = (lead.email || "").trim();
  if (!EMAIL_RE.test(email)) {
    await alerts.notifyHandoff({
      lead: asAlertLead,
      reason: `New ${source} lead with no email address, so the assistant can't reach them — please call. ${describe(lead)}${lead.inquiry ? `. They said: ${lead.inquiry}` : ""}`,
    });
    return { action: "flagged_no_email" };
  }

  if (await statements.findLeadByEmail.get(email)) {
    console.log(`[intake] ${email} is already a lead, not starting a second conversation`);
    return { action: "duplicate" };
  }

  const info = await statements.insertLead.run({ source, name: lead.name || null, email, notes });
  return { action: "created", leadId: info.lastInsertRowid };
}

module.exports = { handleLeadAlert, isAllowedSender };
