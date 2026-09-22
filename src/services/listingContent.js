const { callTool } = require("./llm");

const SYSTEM_PROMPT = `You are a real estate marketing copywriter. Given raw listing facts, produce
the full marketing package for a new listing going to market. Never invent facts not given to you
(no fabricated square footage, schools, amenities, or price history) — work only from what's provided.
Respond ONLY by calling the generate_listing_content tool.`;

const TOOL = {
  name: "generate_listing_content",
  description: "Produce the marketing copy package for a real estate listing.",
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "MLS-style listing description, 100-150 words, no markdown.",
      },
      social_instagram: {
        type: "string",
        description: "Instagram caption, punchy, under 150 words, 3-5 relevant hashtags at the end.",
      },
      social_facebook: {
        type: "string",
        description: "Facebook post, slightly longer and more conversational than Instagram, no hashtags.",
      },
      email_subject: {
        type: "string",
        description: "Subject line for a 'new listing' email blast to the agent's buyer list.",
      },
      email_body: {
        type: "string",
        description: "Short email body (plain text, under 200 words) driving to a showing request.",
      },
    },
    required: ["description", "social_instagram", "social_facebook", "email_subject", "email_body"],
  },
};

async function generate(listing) {
  const facts = [
    `Address: ${listing.address}`,
    listing.price && `Price: ${listing.price}`,
    listing.beds && `Beds: ${listing.beds}`,
    listing.baths && `Baths: ${listing.baths}`,
    listing.sqft && `Square feet: ${listing.sqft}`,
    listing.features && `Notable features: ${listing.features}`,
  ]
    .filter(Boolean)
    .join("\n");

  return callTool({
    system: SYSTEM_PROMPT,
    user: `Listing facts:\n${facts}`,
    tool: TOOL,
  });
}

module.exports = { generate };
