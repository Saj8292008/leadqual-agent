const { test } = require("node:test");
const assert = require("node:assert/strict");
const { looksLikeDataDump } = require("../src/services/maintenanceTriage");

test("flags the exact garbled output observed from qwen2.5:3b", () => {
  const observed =
    " plumbing issue in Unit 2B, property: 456 Oak Ave, address: 456 Oak Ave, address_type: property, priority: routine";
  assert.equal(looksLikeDataDump(observed), true);
});

test("does not flag clean prose", () => {
  assert.equal(
    looksLikeDataDump("Electrical issue: garage door opener not working at 456 Oak Ave, Unit 2B."),
    false
  );
});

test("does not flag prose with a single incidental colon", () => {
  assert.equal(looksLikeDataDump("Please note: the tenant will be home after 5pm."), false);
});

test("flags a non-string value defensively", () => {
  assert.equal(looksLikeDataDump(undefined), true);
  assert.equal(looksLikeDataDump(null), true);
});
