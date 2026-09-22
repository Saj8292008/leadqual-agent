const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROVIDER = process.env.LLM_PROVIDER || "anthropic";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const OLLAMA_MAX_RETRIES = 3;

// Runs a forced-tool-call turn against whichever provider is configured and
// returns the tool's parsed arguments. Anthropic's forced tool_choice is
// reliable enough to trust directly; local models are not, so those get
// validated against the schema and retried on failure.
async function callTool({ system, user, tool }) {
  if (PROVIDER === "ollama") {
    return callOllamaWithRetry({ system, user, tool });
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

async function callOllama({ system, user, tool }) {
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [toOpenAiTool(tool)],
      tool_choice: { type: "function", function: { name: tool.name } },
    }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Ollama did not return a tool call");
  return JSON.parse(toolCall.function.arguments);
}

// Local models (tested: qwen2.5:3b) sometimes wrap the whole payload under a
// spurious top-level key, or drop a required field. Catch both: reject any
// key not declared in the schema, and confirm every required key is present.
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

async function callOllamaWithRetry({ system, user, tool }) {
  let lastError;
  for (let attempt = 1; attempt <= OLLAMA_MAX_RETRIES; attempt++) {
    try {
      const args = await callOllama({ system, user, tool });
      const validationError = validateAgainstSchema(args, tool);
      if (!validationError) return args;
      lastError = new Error(`schema validation failed (attempt ${attempt}/${OLLAMA_MAX_RETRIES}): ${validationError}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

module.exports = { callTool, validateAgainstSchema };
