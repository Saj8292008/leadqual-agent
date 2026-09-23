const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractEmailAddress } = require("../src/routes/email");

test("extracts the address from a display-name-formatted From header", () => {
  // The exact format observed from a real Apple Mail reply during testing.
  assert.equal(extractEmailAddress("Sydney J <carmarsyd@icloud.com>"), "carmarsyd@icloud.com");
});

test("passes through an already-bare address unchanged", () => {
  assert.equal(extractEmailAddress("jordan@example.com"), "jordan@example.com");
});

test("trims surrounding whitespace", () => {
  assert.equal(extractEmailAddress("  Jordan Lee <jordan@example.com>  "), "jordan@example.com");
});

test("handles a display name containing angle-bracket-like characters gracefully", () => {
  assert.equal(extractEmailAddress("J. Lee <jordan@example.com>"), "jordan@example.com");
});
