const { test } = require("node:test");
const assert = require("node:assert/strict");
const { currentPeriod, dueDateForPeriod, applicableLeaseMilestone } = require("../src/services/propertyReminders");

test("currentPeriod returns YYYY-MM for the given date", () => {
  assert.equal(currentPeriod(new Date("2026-09-15T12:00:00")), "2026-09");
  assert.equal(currentPeriod(new Date("2026-01-01T12:00:00")), "2026-01");
});

test("dueDateForPeriod builds the date for a normal day", () => {
  assert.equal(dueDateForPeriod("2026-09", 15), "2026-09-15");
});

test("dueDateForPeriod clamps to the last day of a short month", () => {
  // rent_due_day 31 requested for February — clamp to Feb's actual last day
  assert.equal(dueDateForPeriod("2026-02", 31), "2026-02-28");
});

test("dueDateForPeriod handles a leap-year February", () => {
  assert.equal(dueDateForPeriod("2028-02", 30), "2028-02-29");
});

test("applicableLeaseMilestone picks the tightest milestone, not the loosest", () => {
  // Regression: originally matched 90 first (since [90,60,30] and 23<=90 is
  // true), so it never converged on the correct 30-day milestone.
  assert.equal(applicableLeaseMilestone(23, null), 30);
});

test("applicableLeaseMilestone is idempotent once alerted for a milestone", () => {
  assert.equal(applicableLeaseMilestone(23, 30), null);
  assert.equal(applicableLeaseMilestone(20, 30), null);
});

test("applicableLeaseMilestone fires again as the deadline gets tighter", () => {
  assert.equal(applicableLeaseMilestone(85, null), 90);
  assert.equal(applicableLeaseMilestone(55, 90), 60);
  assert.equal(applicableLeaseMilestone(25, 60), 30);
  assert.equal(applicableLeaseMilestone(24, 30), null);
});

test("applicableLeaseMilestone returns null outside all milestones", () => {
  assert.equal(applicableLeaseMilestone(120, null), null);
});
