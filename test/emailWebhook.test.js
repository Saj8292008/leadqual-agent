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

const { slotPick } = require("../src/routes/email");

test("a natural reply naming one offered option counts as a pick", () => {
  // Regression: observed live — "1 works for me." wasn't treated as a pick
  // (only a bare digit was), so the AI answered and nothing got booked.
  assert.equal(slotPick("1 works for me.", 3), 1);
  assert.equal(slotPick("2", 3), 2);
  assert.equal(slotPick("Option 3 please!", 3), 3);
  assert.equal(slotPick("#2 is great, thanks", 3), 2);
});

test("ambiguous or non-option numbers are not treated as a pick", () => {
  assert.equal(slotPick("2 or 3 both work", 3), null, "two options named");
  assert.equal(slotPick("can we do 10am instead?", 3), null, "a time, not an option");
  assert.equal(slotPick("anything at 4:30?", 3), null);
  assert.equal(slotPick("5", 3), null, "out of range");
  assert.equal(slotPick("my budget is 450k", 3), null);
  assert.equal(slotPick("none of those work", 3), null);
});
