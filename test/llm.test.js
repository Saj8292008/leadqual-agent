const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateAgainstSchema } = require("../src/services/llm");

const tool = {
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
      status: { type: "string" },
      budget: { type: "string" },
    },
    required: ["reply", "status"],
  },
};

test("accepts a well-formed response", () => {
  const err = validateAgainstSchema({ reply: "hi", status: "qualifying" }, tool);
  assert.equal(err, null);
});

test("accepts optional fields present alongside required ones", () => {
  const err = validateAgainstSchema({ reply: "hi", status: "qualifying", budget: "$400k" }, tool);
  assert.equal(err, null);
});

test("rejects a missing required field", () => {
  const err = validateAgainstSchema({ status: "qualifying" }, tool);
  assert.match(err, /missing required field: reply/);
});

test("rejects an empty-string required field", () => {
  const err = validateAgainstSchema({ reply: "", status: "qualifying" }, tool);
  assert.match(err, /missing required field: reply/);
});

test("rejects a field not declared in the schema (catches the qwen nesting failure mode)", () => {
  const err = validateAgainstSchema({ record: { reply: "hi", status: "qualifying" } }, tool);
  assert.match(err, /unexpected field: record/);
});

test("rejects a non-object response", () => {
  assert.match(validateAgainstSchema("not an object", tool), /not an object/);
  assert.match(validateAgainstSchema(null, tool), /not an object/);
  assert.match(validateAgainstSchema(["a", "b"], tool), /not an object/);
});
