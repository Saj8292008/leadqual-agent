// Run daily (Vercel Cron via /cron/*, or cron locally) to send upcoming-deadline reminders
// and alert the agent about anything overdue. `npm run transaction-reminders`
require("dotenv").config();
const { sendReminders, alertOverdue } = require("./transactionReminders");

async function main() {
  const remindersSent = await sendReminders();
  const overdueAlerts = await alertOverdue();
  console.log(`[transaction-reminders] sent ${remindersSent} reminder(s), ${overdueAlerts} overdue alert(s)`);
}

if (require.main === module) {
  main().then(() => process.exit(0));
}

module.exports = { main };
