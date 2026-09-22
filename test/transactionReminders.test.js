const { test } = require("node:test");
const assert = require("node:assert/strict");
const { daysUntil } = require("../src/services/transactionReminders");

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
