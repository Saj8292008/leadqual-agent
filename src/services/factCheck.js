// Local models occasionally invent unsupported claims in generated listing
// copy (tested: "just minutes from downtown" when no location context was
// given). We can't cheaply verify arbitrary facts, but the categories that
// actually create legal/reputational risk for a real estate listing are
// narrow — proximity/location claims and school claims — so flag those
// specifically unless the raw facts given to the model already mention them.
const RISK_PATTERNS = [
  { label: "proximity claim", pattern: /\b(minutes?|steps?|walking distance|blocks?) (from|to|away)\b/i },
  { label: "proximity claim", pattern: /\b(close to|near|nearby|just off)\b/i },
  { label: "school claim", pattern: /\b(school district|top[- ]rated schools?|excellent schools?|award[- ]winning schools?)\b/i },
  { label: "unverifiable superlative", pattern: /\b(best in the area|#1|number one|highest rated)\b/i },
];

function checkContent(content, listing) {
  const factsText = [listing.address, listing.features].filter(Boolean).join(" ").toLowerCase();
  const flags = [];

  for (const [field, text] of Object.entries(content)) {
    if (typeof text !== "string") continue;
    for (const { label, pattern } of RISK_PATTERNS) {
      const match = text.match(pattern);
      if (match && !factsText.includes(match[0].toLowerCase())) {
        flags.push({ field, label, matched: match[0] });
      }
    }
  }

  return flags;
}

module.exports = { checkContent };
