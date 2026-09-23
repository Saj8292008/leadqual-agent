const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROVIDER = process.env.LLM_PROVIDER || "anthropic";

// Any provider that speaks the OpenAI-compatible /chat/completions + tools
// shape — Ollama (local), Groq, NVIDIA NIM, etc. — is driven by these three
// values instead of one-off provider-specific code.
const OPENAI_COMPATIBLE_BASE_URL = process.env.OPENAI_COMPATIBLE_BASE_URL || "http://localhost:11434/v1";
const OPENAI_COMPATIBLE_API_KEY = process.env.OPENAI_COMPATIBLE_API_KEY || "";
const OPENAI_COMPATIBLE_MODEL = process.env.OPENAI_COMPATIBLE_MODEL || "qwen2.5:3b";
const OPENAI_COMPATIBLE_MAX_RETRIES = 3;
const OPENAI_COMPATIBLE_TIMEOUT_MS = Number(process.env.OPENAI_COMPATIBLE_TIMEOUT_MS || 45000);

// Runs a forced-tool-call turn against whichever provider is configured and
// returns the tool's parsed arguments. Anthropic's forced tool_choice is
// reliable enough to trust directly; third-party OpenAI-compatible providers
// vary in reliability, so those get validated against the schema and
// retried on failure.
async function callTool({ system, user, tool }) {
  if (PROVIDER === "openai_compatible") {
    return callOpenAiCompatibleWithRetry({ system, user, tool });
  }
  return callAnthropic({ system, user, tool });
}

async function callAnthropic({ system, user, tool }) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1200,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: user }],
  });
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a tool call");
  return toolUse.input;
}

function toOpenAiTool(tool) {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  };
}

async function callOpenAiCompatible({ system, user, tool }) {
  const headers = { "Content-Type": "application/json" };
  if (OPENAI_COMPATIBLE_API_KEY) headers.Authorization = `Bearer ${OPENAI_COMPATIBLE_API_KEY}`;

  // A stalled provider (observed: NVIDIA NIM hanging indefinitely on one
  // request with zero CPU activity, no error, no response) must not be
  // able to hang the whole conversation turn forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_COMPATIBLE_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_COMPATIBLE_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [toOpenAiTool(tool)],
        tool_choice: { type: "function", function: { name: tool.name } },
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`${OPENAI_COMPATIBLE_MODEL} request timed out after ${OPENAI_COMPATIBLE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`${OPENAI_COMPATIBLE_MODEL} request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error(`${OPENAI_COMPATIBLE_MODEL} did not return a tool call`);
  return JSON.parse(toolCall.function.arguments);
}

// Smaller/local models (tested: qwen2.5:3b via Ollama) sometimes wrap the
// whole payload under a spurious top-level key, or drop a required field.
// Catch both: reject any key not declared in the schema, and confirm every
// required key is present.
function validateAgainstSchema(args, tool) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return "response is not an object";
  }
  const props = tool.input_schema.properties || {};
  for (const key of Object.keys(args)) {
    if (!(key in props)) return `unexpected field: ${key}`;
  }
  const required = tool.input_schema.required || [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return `missing required field: ${key}`;
    }
  }
  return null;
}

async function callOpenAiCompatibleWithRetry({ system, user, tool }) {
  let lastError;
  for (let attempt = 1; attempt <= OPENAI_COMPATIBLE_MAX_RETRIES; attempt++) {
    try {
      const args = await callOpenAiCompatible({ system, user, tool });
      const validationError = validateAgainstSchema(args, tool);
      if (!validationError) return args;
      lastError = new Error(
        `schema validation failed (attempt ${attempt}/${OPENAI_COMPATIBLE_MAX_RETRIES}): ${validationError}`
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

module.exports = { callTool, validateAgainstSchema };
