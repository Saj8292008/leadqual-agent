const { test } = require("node:test");
const assert = require("node:assert/strict");
const { candidateSlots } = require("../src/services/calendar");

test("candidateSlots only returns weekday business hours", () => {
  const from = new Date("2026-09-21T00:00:00Z"); // Monday
  const to = new Date("2026-09-28T00:00:00Z"); // following Monday
  const slots = candidateSlots(from, to);

  assert.ok(slots.length > 0);
  for (const slot of slots) {
    const d = new Date(slot.start);
    assert.notEqual(d.getDay(), 0, "no Sunday slots");
    assert.notEqual(d.getDay(), 6, "no Saturday slots");
    assert.ok(d.getHours() >= 9 && d.getHours() < 17, "within business hours");
  }
});

test("candidateSlots caps at 6 slots", () => {
  const from = new Date("2026-09-21T00:00:00Z");
  const to = new Date("2026-10-05T00:00:00Z");
  const slots = candidateSlots(from, to);
  assert.equal(slots.length, 6);
});
