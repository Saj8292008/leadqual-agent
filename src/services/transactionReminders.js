const { transactionStatements } = require("../db/transactions");
const email = require("./email");
const slack = require("./slack");

const REMINDER_WINDOW_DAYS = process.env.MILESTONE_REMINDER_DAYS || 3;

const MILESTONE_LABELS = {
  inspection: "Inspection contingency",
  financing: "Financing contingency",
  appraisal: "Appraisal contingency",
  closing: "Closing",
};

function daysUntil(dueDate) {
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date(new Date().toDateString());
  return Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

// Emails whoever's relevant (buyer for financing/inspection/appraisal, both
// for closing) as a deadline approaches, once per day, until it's marked
// complete. Then separately alerts Slack for anything that blew past its
// due date without being marked done — that's a human-attention problem,
// not something to keep silently re-emailing about.
async function sendReminders() {
  const due = transactionStatements.milestonesNeedingReminder.all(REMINDER_WINDOW_DAYS);
  for (const milestone of due) {
    const daysLeft = daysUntil(milestone.due_date);
    const label = MILESTONE_LABELS[milestone.name] || milestone.name;
    const urgency =
      daysLeft === 0
        ? "is due today"
        : daysLeft > 0
        ? `is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
        : `was due ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
    const subject = `${label} deadline ${urgency} — ${milestone.address}`;
    const body = `Reminder: the ${label.toLowerCase()} deadline for ${milestone.address} ${urgency} (${milestone.due_date}).`;

    if (milestone.buyer_email) {
      await email.sendEmail({ to: milestone.buyer_email, subject, text: body });
    }

    transactionStatements.markReminderSent.run(milestone.id);
  }
  return due.length;
}

async function alertOverdue() {
  const overdue = transactionStatements.milestonesOverdue.all();
  for (const milestone of overdue) {
    const label = MILESTONE_LABELS[milestone.name] || milestone.name;
    await slack.notifyHandoff({
      lead: { name: milestone.address, email: "", source: "transaction-coordination" },
      reason: `${label} deadline missed (was due ${milestone.due_date}) — needs a human to chase this down.`,
    });
    transactionStatements.markMissedAlertSent.run(milestone.id);
  }
  return overdue.length;
}

module.exports = { sendReminders, alertOverdue, daysUntil };
