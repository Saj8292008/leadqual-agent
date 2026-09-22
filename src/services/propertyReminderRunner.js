// Run daily to send rent reminders, flag overdue rent, and remind on
// upcoming lease renewals. `npm run property-reminders`
require("dotenv").config();
const { sendRentReminders, sendRentOverdueAlerts, sendLeaseRenewalReminders } = require("./propertyReminders");

async function main() {
  const rentReminders = await sendRentReminders();
  const overdueAlerts = await sendRentOverdueAlerts();
  const leaseAlerts = await sendLeaseRenewalReminders();
  console.log(
    `[property-reminders] ${rentReminders} rent reminder(s), ${overdueAlerts} overdue alert(s), ${leaseAlerts} lease renewal alert(s)`
  );
}

if (require.main === module) {
  main().then(() => process.exit(0));
}

module.exports = { main };
