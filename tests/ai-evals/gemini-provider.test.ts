import { describe, expect, it, vi } from "vitest";
import { createGeminiProvider, parseGeminiUsage } from "../../packages/ai/src/providers/gemini.js";
import { AI_INSTRUCTIONS, OPENAI_AGENT_DECISION_SCHEMA } from "../../packages/ai/src/schema.js";
import { validateAgentDecision } from "@lead-agent/application";
import { validDecision } from "../ai/fixtures.js";
import { inputForCase, SMOKE } from "./screen.js";

const config = {
  apiKey: "synthetic-gemini-test-key",
  model: "gemini-3.8-flash",
  requestTimeoutMs: 1000,
} as const;
const item = SMOKE[0];
if (item === undefined) throw new TypeError("Missing smoke fixture");
const input = () => inputForCase(item, new AbortController().signal);
const envelope = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  modelVersion: config.model,
  responseId: "synthetic_response",
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 5,
    totalTokenCount: 35,
    cachedContentTokenCount: 2,
  },
  candidates: [
    {
      finishReason: "STOP",
      content: { role: "model", parts: [{ text: JSON.stringify(validDecision()) }] },
    },
  ],
  ...overrides,
});
const provider = (value: unknown) =>
  createGeminiProvider(config, {
    fetch: vi.fn<typeof fetch>(() => Promise.resolve(Response.json(value))),
  });
describe("S13 Gemini untrusted provider boundary", () => {
  it("valid decision, billable reasoning once, strict schema, no tools/state, header credentials", async () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(envelope())));
    const result = await createGeminiProvider(config, { fetch: request }).decide(input());
    expect(result).toMatchObject({
      kind: "completed",
      model: config.model,
      usage: { input: 10, output: 25, total: 35, cachedInput: 2, reasoning: 5 },
    });
    const call = request.mock.calls[0];
    if (typeof call?.[1]?.body !== "string") throw new TypeError("Missing request");
    expect(call[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(call[1]).toMatchObject({
      redirect: "error",
      headers: { "x-goog-api-key": config.apiKey },
    });
    const body: unknown = JSON.parse(call[1].body);
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: AI_INSTRUCTIONS }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: OPENAI_AGENT_DECISION_SCHEMA,
        maxOutputTokens: 4000,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    expect(body).toHaveProperty("contents");
    for (const key of [
      "tools",
      "cachedContent",
      "previous_interaction_id",
      "store",
      "conversation",
    ])
      expect(body).not.toHaveProperty(key);
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });
  it.each([
    null,
    {},
    { candidates: [] },
    envelope({ modelVersion: null }),
    envelope({
      candidates: [
        {
          finishReason: "STOP",
          content: { role: "model", parts: [{ functionCall: { name: "sql" } }] },
        },
      ],
    }),
  ])("rejects malformed or tool-like envelopes %j", async (body) =>
    expect(await provider(body).decide(input())).toMatchObject({ kind: "invalid_output" }),
  );
  it.each(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"])(
    "classifies %s refusal",
    async (finishReason) =>
      expect(
        await provider(envelope({ candidates: [{ finishReason }] })).decide(input()),
      ).toMatchObject({ kind: "refusal" }),
  );
  it("classifies prompt-level safety refusal", async () =>
    expect(
      await provider(
        envelope({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }),
      ).decide(input()),
    ).toMatchObject({ kind: "refusal" }));
  it("classifies incomplete output without repair eligibility", async () =>
    expect(
      await provider(envelope({ candidates: [{ finishReason: "MAX_TOKENS" }] })).decide(input()),
    ).toMatchObject({ kind: "incomplete", reason: "output_limit" }));
  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [429, "rate_limit"],
    [500, "unavailable"],
    [503, "unavailable"],
    [400, "request"],
  ])("maps HTTP %s without exposing errors/retrying", async (status, category) => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("synthetic-sensitive-error", {
          status: Number(status),
          headers: { "retry-after": "2" },
        }),
      ),
    );
    const result = await createGeminiProvider(config, { fetch: request }).decide(input());
    expect(result).toMatchObject({ kind: "provider_error", category, retryAfterMs: 2000 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it.each(["<html>private</html>", "x".repeat(65_537)])(
    "bounds/rejects HTTP JSON",
    async (text) => {
      const request = vi.fn<typeof fetch>(() => Promise.resolve(new Response(text)));
      expect(await createGeminiProvider(config, { fetch: request }).decide(input())).toMatchObject({
        kind: "invalid_output",
      });
    },
  );
  it("does not treat JSON shape as canonical decision authorization", async () => {
    const result = await provider(
      envelope({
        candidates: [
          {
            finishReason: "STOP",
            content: { role: "model", parts: [{ text: '{"execute_sql":true}' }] },
          },
        ],
      }),
    ).decide(input());
    expect(result.kind).toBe("completed");
    expect(result.kind === "completed" && validateAgentDecision(result.value)).toBe(false);
  });
  it("discards thought text, parses final text only", async () => {
    const result = await provider(
      envelope({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              role: "model",
              parts: [
                { thought: true, text: "synthetic-hidden-reasoning" },
                { text: JSON.stringify(validDecision()) },
              ],
            },
          },
        ],
      }),
    ).decide(input());
    expect(result.kind).toBe("completed");
    expect(JSON.stringify(result)).not.toContain("hidden-reasoning");
  });
  it("abort before dispatch", async () => {
    const signal = AbortSignal.abort();
    const request = vi.fn<typeof fetch>();
    expect(
      await createGeminiProvider(config, { fetch: request }).decide({ ...input(), signal }),
    ).toMatchObject({ kind: "timeout" });
    expect(request).not.toHaveBeenCalled();
  });
  it("deadline aborts request without leaking exception", async () => {
    const request = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(new Error(config.apiKey)), {
            once: true,
          }),
        ),
    );
    const result = await createGeminiProvider(
      { ...config, requestTimeoutMs: 10 },
      { fetch: request },
    ).decide(input());
    expect(result.kind).toBe("timeout");
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });
  it("network failures are not blindly retried", async () => {
    const request = vi.fn<typeof fetch>(() => Promise.reject(new Error(config.apiKey)));
    const result = await createGeminiProvider(config, { fetch: request }).decide(input());
    expect(result).toMatchObject({ kind: "provider_error", category: "network", retryable: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });
  it("rejects oversized input before SQL/transport", async () => {
    const request = vi.fn<typeof fetch>();
    expect(
      await createGeminiProvider(config, { fetch: request }).decide({
        ...input(),
        message: "x".repeat(4001),
      }),
    ).toMatchObject({ kind: "invalid_output" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { promptTokenCount: 10, totalTokenCount: 9 },
    { promptTokenCount: 10, totalTokenCount: 30, candidatesTokenCount: 25, thoughtsTokenCount: 10 },
    { promptTokenCount: 10, totalTokenCount: 30, cachedContentTokenCount: 11 },
  ])("unknown/inconsistent usage is not free %j", (value) =>
    expect(parseGeminiUsage(value).output).toBeNull(),
  );
  it("unreported cache/reasoning stays unknown; total proves billable output", () =>
    expect(parseGeminiUsage({ promptTokenCount: 10, totalTokenCount: 30 })).toEqual({
      input: 10,
      output: 20,
      total: 30,
      cachedInput: null,
      reasoning: null,
    }));
});
