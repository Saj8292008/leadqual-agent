const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The email route loads the DB — isolate it (node --test runs files in parallel).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
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

const { replyText } = require("../src/routes/email");

test("uses only the new reply text, not the quoted thread below it", () => {
  // Regression: a Gmail reply of "2" arrived as "2\n\nOn Wed ... wrote:\n> ..."
  // in `text`, so it never matched as a showing-slot pick.
  const msg = {
    text: "2\n\nOn Wed, Sep 30, 2026 at 7:54 PM Sam <inbox@agentmail.to> wrote:\n> Reply with the number that works best.",
    extracted_text: "2",
  };
  assert.equal(replyText(msg), "2");
});

test("falls back to the raw text when no extracted text is provided", () => {
  assert.equal(replyText({ text: "  Around $450k  " }), "Around $450k");
  assert.equal(replyText({ text: "hi", extracted_text: "   " }), "hi");
});
