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

test("openai_compatible provider times out instead of hanging forever on a stalled request", async () => {
  // Regression: observed NVIDIA NIM hang indefinitely on one real request
  // (no response, no error, zero CPU activity) with no timeout in place.
  const originalFetch = global.fetch;
  global.fetch = (url, opts) =>
    new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      // deliberately never resolves otherwise
    });

  process.env.LLM_PROVIDER = "openai_compatible";
  process.env.OPENAI_COMPATIBLE_TIMEOUT_MS = "200";
  delete require.cache[require.resolve("../src/services/llm")];
  const { callTool } = require("../src/services/llm");

  try {
    await assert.rejects(
      callTool({ system: "sys", user: "hi", tool: { name: "x", input_schema: tool.input_schema } }),
      /timed out/
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_COMPATIBLE_TIMEOUT_MS;
    delete require.cache[require.resolve("../src/services/llm")];
  }
});

test("openai_compatible provider waits out a 429 rate limit and then succeeds", async () => {
  // Regression: Groq's free tier returned 429 + retry-after mid-conversation;
  // the three retries fired back-to-back and all failed within a second.
  const originalFetch = global.fetch;
  const callTimes = [];
  global.fetch = async () => {
    callTimes.push(Date.now());
    if (callTimes.length === 1) {
      return new Response("rate limited", { status: 429, headers: { "retry-after": "0.3" } });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ reply: "hi", status: "qualifying" }) } }] } }],
      }),
      { status: 200 }
    );
  };

  process.env.LLM_PROVIDER = "openai_compatible";
  delete require.cache[require.resolve("../src/services/llm")];
  const { callTool } = require("../src/services/llm");

  try {
    const args = await callTool({ system: "sys", user: "hi", tool: { name: "x", input_schema: tool.input_schema } });
    assert.deepEqual(args, { reply: "hi", status: "qualifying" });
    assert.equal(callTimes.length, 2);
    assert.ok(callTimes[1] - callTimes[0] >= 250, "second attempt should wait for retry-after");
  } finally {
    global.fetch = originalFetch;
    delete process.env.LLM_PROVIDER;
    delete require.cache[require.resolve("../src/services/llm")];
  }
});
