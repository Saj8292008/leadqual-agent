const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Loads the DB — isolate it (node --test runs files in parallel).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
const { subjectFor, nextFollowupTimestamp } = require("../src/services/conversationEngine");

test("subjectFor includes the lead's name", () => {
  assert.equal(subjectFor({ name: "Jordan Lee" }), "Re: your home search — Jordan Lee");
});

test("subjectFor falls back gracefully with no name", () => {
  assert.equal(subjectFor({ name: null }), "Re: your home search");
});

test("nextFollowupTimestamp returns null for falsy days", () => {
  assert.equal(nextFollowupTimestamp(0), null);
  assert.equal(nextFollowupTimestamp(null), null);
});

test("nextFollowupTimestamp adds the right offset", () => {
  const before = Date.now();
  const ts = nextFollowupTimestamp(3);
  const diffDays = (new Date(ts).getTime() - before) / (24 * 60 * 60 * 1000);
  assert.ok(diffDays > 2.9 && diffDays < 3.1);
});
