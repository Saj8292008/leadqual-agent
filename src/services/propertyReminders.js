const { propertyStatements } = require("../db/propertyManagement");
const { daysUntil, zonedParts } = require("../lib/time");
const email = require("./email");
const alerts = require("./alerts");

const RENT_REMINDER_DAYS = Number(process.env.RENT_REMINDER_DAYS || 3);
const RENT_OVERDUE_GRACE_DAYS = Number(process.env.RENT_OVERDUE_GRACE_DAYS || 3);
// Ascending — smallest (most urgent) first, so we find the tightest
// applicable milestone rather than the loosest one.
const LEASE_RENEWAL_MILESTONES = [30, 60, 90];

// Rent period ('YYYY-MM') as of `date` in the agent's timezone.
function currentPeriod(date = new Date()) {
  const { year, month } = zonedParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dueDateForPeriod(period, dueDay) {
  const [year, month] = period.split("-").map(Number);
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, lastDayOfMonth);
  return `${period}-${String(day).padStart(2, "0")}`;
}

// The tightest lease-renewal milestone daysLeft currently qualifies for,
// or null if none is due yet or we've already alerted for it (or a
// tighter one). Milestones must be checked smallest-first — checking
// largest-first would match on 90 before the correct/tighter 30 and
// never re-fire as the deadline gets closer.
function applicableLeaseMilestone(daysLeft, lastReminderDays) {
  const milestone = LEASE_RENEWAL_MILESTONES.find((m) => daysLeft <= m);
  if (milestone == null) return null;
  if (lastReminderDays != null && lastReminderDays <= milestone) return null;
  return milestone;
}

// Reminds the tenant a few days before rent is due, once, unless they've
// already paid for the period.
async function sendRentReminders() {
  const period = currentPeriod();
  const tenants = await propertyStatements.activeTenantsWithProperty.all();
  let sent = 0;

  for (const tenant of tenants) {
    if (await propertyStatements.hasPaid.get(tenant.id, period)) continue;
    if (await propertyStatements.rentReminderAlreadySent.get(tenant.id, period, "upcoming")) continue;

    const dueDate = dueDateForPeriod(period, tenant.rent_due_day);
    const daysLeft = daysUntil(dueDate);
    if (daysLeft < 0 || daysLeft > RENT_REMINDER_DAYS) continue;

    const urgency = daysLeft === 0 ? "is due today" : `is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    await email.sendEmail({
      to: tenant.email,
      subject: `Rent reminder — ${tenant.rent_amount || "your rent"} ${urgency}`,
      text: `Hi ${tenant.name}, just a reminder that rent ${urgency} (${dueDate}) for ${tenant.address}${tenant.unit ? ` Unit ${tenant.unit}` : ""}.`,
    });
    await propertyStatements.markRentReminderSent.run({ tenant_id: tenant.id, period, kind: "upcoming" });
    sent++;
  }
  return sent;
}

// Alerts the landlord once a tenant's rent has gone past the grace period
// unpaid — a collections problem, not something to keep silently re-checking.
async function sendRentOverdueAlerts() {
  const period = currentPeriod();
  const tenants = await propertyStatements.activeTenantsWithProperty.all();
  let alerted = 0;

  for (const tenant of tenants) {
    if (await propertyStatements.hasPaid.get(tenant.id, period)) continue;
    if (await propertyStatements.rentReminderAlreadySent.get(tenant.id, period, "overdue")) continue;

    const dueDate = dueDateForPeriod(period, tenant.rent_due_day);
    const daysLate = -daysUntil(dueDate);
    if (daysLate < RENT_OVERDUE_GRACE_DAYS) continue;

    await alerts.notifyHandoff({
      lead: { name: `${tenant.name} — ${tenant.address}`, email: tenant.email, source: "property-management" },
      reason: `Rent for ${period} is ${daysLate} day(s) overdue and unpaid (due ${dueDate}).`,
    });
    await propertyStatements.markRentReminderSent.run({ tenant_id: tenant.id, period, kind: "overdue" });
    alerted++;
  }
  return alerted;
}

// Alerts the landlord/PM at 90/60/30 days out from lease end so they have
// time to start the renewal conversation — this is their to-do, not the
// tenant's, so it goes to the agent's alerts rather than an email to the tenant.
async function sendLeaseRenewalReminders() {
  const tenants = await propertyStatements.activeTenantsWithProperty.all();
  let alerted = 0;

  for (const tenant of tenants) {
    if (!tenant.lease_end) continue;
    const daysLeft = daysUntil(tenant.lease_end);
    const applicableMilestone = applicableLeaseMilestone(daysLeft, tenant.last_lease_reminder_days);
    if (applicableMilestone == null) continue;

    await alerts.notifyHandoff({
      lead: { name: `${tenant.name} — ${tenant.address}`, email: tenant.email, source: "property-management" },
      reason: `Lease ends ${tenant.lease_end} (in ${daysLeft} days) — time to start the renewal conversation.`,
    });
    await propertyStatements.markLeaseReminderSent.run({ id: tenant.id, days: applicableMilestone });
    alerted++;
  }
  return alerted;
}

module.exports = {
  sendRentReminders,
  sendRentOverdueAlerts,
  sendLeaseRenewalReminders,
  currentPeriod,
  dueDateForPeriod,
  applicableLeaseMilestone,
};
