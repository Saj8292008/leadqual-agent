const { test } = require("node:test");
const assert = require("node:assert/strict");
const { daysUntil, localDate } = require("../src/lib/time");

// The agent's local calendar date `days` from now (same basis as daysUntil).
function isoDaysFromNow(days) {
  return localDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

test("daysUntil returns 0 for today", () => {
  assert.equal(daysUntil(isoDaysFromNow(0)), 0);
});

test("daysUntil returns a positive count for a future date", () => {
  assert.equal(daysUntil(isoDaysFromNow(5)), 5);
});

test("daysUntil returns a negative count for a past date", () => {
  assert.equal(daysUntil(isoDaysFromNow(-2)), -2);
});

test("daysUntil counts in the agent's timezone, not the server's (UTC on Vercel)", () => {
  process.env.AGENT_TIMEZONE = "America/Chicago";
  // 9pm Central on Sep 28 is already Sep 29 in UTC. A deadline of Sep 28
  // is still due today for the agent, not one day overdue.
  const evening = new Date("2026-09-29T02:00:00Z");
  assert.equal(localDate(evening), "2026-09-28");
  assert.equal(daysUntil("2026-09-28", evening), 0);
  assert.equal(daysUntil("2026-09-29", evening), 1);
});
