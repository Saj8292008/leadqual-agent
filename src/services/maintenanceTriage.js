const { callTool } = require("./llm");

const SYSTEM_PROMPT = `You triage maintenance requests for a property manager. Given a tenant's raw
description of an issue, classify it and draft a short message to send to a vendor for dispatch.

Rules:
- category must be one of: plumbing, electrical, hvac, appliance, structural, pest, other.
- urgency: "emergency" only for things like active flooding, no heat in freezing weather, gas
  smell, no power, sewage backup, or anything posing immediate safety/property risk. "urgent" for
  things that need attention within a day or two (no hot water, broken lock, major leak that's
  currently contained). Everything else is "routine".
- The vendor_message must only restate facts from the tenant's description plus the property
  address and unit given to you — never invent access instructions, appliance brands/models, or
  root causes you weren't told. If access instructions aren't provided, tell the vendor to
  coordinate directly with the tenant.

Respond ONLY by calling the triage_request tool.`;

const TOOL = {
  name: "triage_request",
  description: "Classify a maintenance request and draft the vendor dispatch message.",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["plumbing", "electrical", "hvac", "appliance", "structural", "pest", "other"],
      },
      urgency: { type: "string", enum: ["emergency", "urgent", "routine"] },
      vendor_message: {
        type: "string",
        description: "Short message to a vendor describing the issue, address/unit, and urgency.",
      },
    },
    required: ["category", "urgency", "vendor_message"],
  },
};

async function triage({ description, address, unit }) {
  const context = `Property: ${address}${unit ? `, Unit ${unit}` : ""}\nTenant-reported issue: ${description}`;
  return callTool({ system: SYSTEM_PROMPT, user: context, tool: TOOL });
}

module.exports = { triage };
