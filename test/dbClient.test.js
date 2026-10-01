const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leadqual-test-"));
const { toArgs } = require("../src/db/client");

test("a whole record is narrowed to the statement's own named parameters", () => {
  // Regression: updateLead.run({ ...lead, thread_id }) sent all 14 lead
  // columns for an 8-parameter UPDATE. A local SQLite file ignored the
  // extras, but Turso failed every inbound email reply with
  // "Number of arguments mismatch: expected 8, got 14".
  const sql = "UPDATE leads SET status = @status, notes = @notes WHERE id = @id";
  const lead = { id: 1, status: "booked", notes: null, email: "x@example.com", created_at: "2026-09-30", offered_slots: "[]" };
  assert.deepEqual(toArgs(sql, [lead]), { status: "booked", notes: null, id: 1 });
});

test("missing named parameters become null rather than being dropped", () => {
  assert.deepEqual(toArgs("INSERT INTO t (a, b) VALUES (@a, @b)", [{ a: 1 }]), { a: 1, b: null });
});

test("positional parameters pass through unchanged", () => {
  assert.deepEqual(toArgs("SELECT * FROM t WHERE id = ? AND kind = ?", [5, "x"]), [5, "x"]);
});
