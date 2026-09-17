import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";
import { buildGeminiRequest } from "../../packages/ai/src/providers/gemini.js";
import {
  EVAL_INSTRUCTIONS,
  INPUT_RESERVE,
  inputForCase,
  openAIScreenFetch,
  planScreen,
} from "./screen.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const tokens = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > INPUT_RESERVE
  )
    throw new Error("Preflight input tokens outside reserved allowance; no generation authorized");
  return value;
};
/** Two token-count requests only. No generations, retries, uploads or conversation state. */
export const preflightInputCounts = async (
  keys: Readonly<{ openai: string; gemini: string }>,
  request: typeof fetch = fetch,
) => {
  const bodies: {
    gemini: ReturnType<typeof buildGeminiRequest>;
    openai: Record<string, unknown>;
    size: number;
    caseId: string;
  }[] = [];
  for (const row of planScreen()) {
    const input = inputForCase(row.item, new AbortController().signal, row.hint);
    let captured: unknown;
    const capture: typeof fetch = (_url, options) => {
      if (typeof options?.body !== "string") throw new Error("Missing preflight body");
      captured = JSON.parse(options.body);
      return Promise.resolve(Response.json({}));
    };
    await createOpenAIProvider(
      { apiKey: "synthetic-preflight-placeholder", model: "gpt-5.6-luna", requestTimeoutMs: 1000 },
      { fetch: openAIScreenFetch(capture) },
    ).decide(input);
    if (!record(captured)) throw new Error("Preflight input reserve exceeded; no generation");
    const gemini = buildGeminiRequest(input, EVAL_INSTRUCTIONS, "low");
    const size = Math.max(
      Buffer.byteLength(JSON.stringify(captured)),
      Buffer.byteLength(JSON.stringify(gemini)),
    );
    if (size + 512 > INPUT_RESERVE)
      throw new Error("Preflight input reserve exceeded; no generation");
    bodies.push({ gemini, openai: captured, size, caseId: row.item.case_id });
  }
  const largest = bodies.sort((a, b) => b.size - a.size)[0];
  if (largest === undefined) throw new Error("No screen fixtures");
  const count = async (
    url: string,
    header: Readonly<Record<string, string>>,
    body: unknown,
    field: string,
  ) => {
    const response = await request(url, {
      method: "POST",
      headers: { ...header, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    }).catch(() => {
      throw new Error("Token-count network/deadline failure; no generation");
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Token-count preflight HTTP ${response.status}; no generation`);
    }
    const text = await response.text();
    if (text.length > 65536) throw new Error("Invalid token-count response");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Invalid token-count response");
    }
    if (!record(value)) throw new Error("Invalid token-count response");
    return tokens(value[field]);
  };
  const openai = await count(
    "https://api.openai.com/v1/responses/input_tokens",
    { Authorization: `Bearer ${keys.openai}` },
    {
      model: "gpt-5.6-luna",
      instructions: largest.openai["instructions"],
      input: largest.openai["input"],
      text: largest.openai["text"],
      tools: [],
    },
    "input_tokens",
  );
  const gemini = await count(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens",
    { "x-goog-api-key": keys.gemini },
    { generateContentRequest: { model: "models/gemini-3.8-flash", ...largest.gemini } },
    "totalTokens",
  );
  return {
    openai,
    gemini,
    largestSerializedBytes: largest.size,
    caseId: largest.caseId,
    inputReserve: INPUT_RESERVE,
    note: "Largest serialized fixture checked with provider counters; byte/token upper-bound remains conservative planning inference for other fixtures.",
  };
};
