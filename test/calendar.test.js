const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Loads the DB — isolate it (node --test runs files in parallel).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
const { candidateSlots } = require("../src/services/calendar");
const { zonedParts } = require("../src/lib/time");

process.env.AGENT_TIMEZONE = "America/Chicago";

test("candidateSlots only returns weekday business hours in the agent's timezone", () => {
  const from = new Date("2026-09-21T00:00:00Z"); // Sunday evening in Chicago
  const to = new Date("2026-09-28T00:00:00Z");
  const slots = candidateSlots(from, to, Infinity);

  assert.ok(slots.length > 0);
  for (const slot of slots) {
    const { weekday, hour } = zonedParts(new Date(slot.start));
    assert.notEqual(weekday, "Sun", "no Sunday slots");
    assert.notEqual(weekday, "Sat", "no Saturday slots");
    assert.ok(hour >= 9 && hour < 17, `within business hours, got ${hour}`);
  }
});

test("the first slot is 9am Central even when the server runs on UTC", () => {
  // Regression: slots were picked by the server's clock — on a UTC host
  // (Vercel) that meant offering leads 4am-noon Central.
  const slots = candidateSlots(new Date("2026-09-21T00:00:00Z"), new Date("2026-09-22T00:00:00Z"));
  assert.equal(slots[0].start, "2026-09-21T14:00:00.000Z"); // 9:00 CDT
});

test("candidateSlots starts at the next full hour, never one already underway", () => {
  const slots = candidateSlots(new Date("2026-09-21T15:20:00Z"), new Date("2026-09-22T00:00:00Z"));
  assert.equal(slots[0].start, "2026-09-21T16:00:00.000Z");
});

test("candidateSlots caps at the limit (6 by default)", () => {
  const from = new Date("2026-09-21T00:00:00Z");
  const to = new Date("2026-10-05T00:00:00Z");
  assert.equal(candidateSlots(from, to).length, 6);
  assert.equal(candidateSlots(from, to, 2).length, 2);
});
