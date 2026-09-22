const { callTool } = require("./llm");

const SYSTEM_PROMPT = `You triage maintenance requests for a property manager. Given a tenant's raw
description of an issue, classify it and draft a short message to send to a vendor for dispatch.

Rules:
- category must be one of: plumbing, electrical, hvac, appliance, structural, pest, other.
- urgency: "emergency" only for things like active flooding, no heat in freezing weather, gas
  smell, no power, sewage backup, or anything posing immediate safety/property risk. "urgent" for
  things that need attention within a day or two (no hot water, broken lock, major leak that's
  currently contained, water actively pooling or spreading). Everything else is "routine".
- The vendor_message must only restate facts from the tenant's description plus the property
  address and unit given to you — never invent access instructions, appliance brands/models, or
  root causes you weren't told. If access instructions aren't provided, tell the vendor to
  coordinate directly with the tenant.
- vendor_message must read like something a person would actually type to a vendor: one or two
  plain sentences. NOT a list of "label: value" pairs, NOT a data dump, no field names in the
  text at all.

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
        description: "One or two plain sentences to a vendor — not a list of key:value pairs.",
      },
    },
    required: ["category", "urgency", "vendor_message"],
  },
};

const QUALITY_RETRIES = 2;

// Local models sometimes answer with a "label: value, label: value" data
// dump instead of prose, even though that's still a schema-valid string.
// Three or more colon-led labels is a strong signal of that failure mode.
function looksLikeDataDump(text) {
  if (typeof text !== "string") return true;
  const labelMatches = text.match(/\b[a-z_]+\s*:/gi) || [];
  return labelMatches.length >= 3;
}

function fallbackMessage({ description, address, unit, urgency, category }) {
  return `${urgency.charAt(0).toUpperCase() + urgency.slice(1)} ${category} issue reported at ${address}${
    unit ? ` Unit ${unit}` : ""
  }: ${description}. Please coordinate access directly with the tenant.`;
}

async function triage({ description, address, unit }) {
  const context = `Property: ${address}${unit ? `, Unit ${unit}` : ""}\nTenant-reported issue: ${description}`;

  let result;
  for (let attempt = 1; attempt <= QUALITY_RETRIES; attempt++) {
    result = await callTool({ system: SYSTEM_PROMPT, user: context, tool: TOOL });
    if (!looksLikeDataDump(result.vendor_message)) return result;
  }

  // Model classified it fine but can't write clean prose for the vendor
  // message after retries — never send garbage, use a plain deterministic
  // message built from the same facts instead.
  return { ...result, vendor_message: fallbackMessage({ description, address, unit, ...result }) };
}

module.exports = { triage, looksLikeDataDump };
