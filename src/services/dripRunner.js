// Run on a schedule (cron, Railway cron, etc.) to nudge leads sitting in
// nurture whose next_followup_at has passed. `npm run drip`
require("dotenv").config();
const { statements } = require("../db");
const { runTurn } = require("./conversationEngine");

async function main() {
  const due = statements.leadsDueForDrip.all();
  console.log(`[drip] ${due.length} lead(s) due for follow-up`);
  for (const lead of due) {
    try {
      await runTurn(lead.id);
    } catch (err) {
      console.error(`[drip] lead ${lead.id} failed:`, err);
    }
  }
}

if (require.main === module) {
  main().then(() => process.exit(0));
}

module.exports = { main };
