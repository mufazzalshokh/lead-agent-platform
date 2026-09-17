import { describe, expect, it, vi } from "vitest";
import {
  COMMERCIAL_V1_AI_PROFILE,
  loadCommercialV1AIConfig,
  loadOpenAIHarnessConfig,
} from "../../packages/config/src/index.js";
import { createCommercialV1AIProvider, createOpenAIProvider } from "../../packages/ai/src/index.js";
import {
  COMMERCIAL_V1_AI_INSTRUCTIONS,
  OPENAI_AGENT_DECISION_SCHEMA,
} from "../../packages/ai/src/schema.js";
import { buildAIProviderInput } from "../../packages/application/src/index.js";
import { EVAL_INSTRUCTIONS } from "../ai-evals/screen.js";
import { AI_SNAPSHOT, validDecision } from "./fixtures.js";

const environment = { GEMINI_API_KEY: "synthetic-gemini-production-test-key" };
const config = () => {
  const value = loadCommercialV1AIConfig(environment);
  if (value === null) throw new TypeError("Missing synthetic configuration");
  return value;
};
const input = (repair = false) => {
  const value = buildAIProviderInput(AI_SNAPSHOT, new AbortController().signal, repair);
  if (value === null) throw new TypeError("Invalid synthetic context");
  return value;
};
const envelope = (modelVersion = "gemini-3.8-flash") => ({
  modelVersion,
  responseId: "synthetic_response",
  candidates: [
    {
      finishReason: "STOP",
      content: { role: "model", parts: [{ text: JSON.stringify(validDecision()) }] },
    },
  ],
});

describe("S13 owner-approved production configuration", () => {
  it("pins the exact immutable paid-tier low-thinking profile and keeps the existing deadline", () => {
    expect(COMMERCIAL_V1_AI_PROFILE).toEqual({
      providerId: "gemini",
      model: "gemini-3.8-flash",
      apiTier: "paid",
      thinkingLevel: "low",
      maxOutputTokens: 4000,
      decisionSchemaVersion: "1",
      modelProfileVersion: "s13-commercial-v1.v1",
      promptTemplateVersion: "s13-uzbek-latin.v1",
    });
    expect(Object.isFrozen(COMMERCIAL_V1_AI_PROFILE)).toBe(true);
    expect(Object.isFrozen(config())).toBe(true);
    expect(config()).toEqual({
      apiKey: environment.GEMINI_API_KEY,
      model: "gemini-3.8-flash",
      requestTimeoutMs: 15_000,
    });
  });
  it.each([{}, { GEMINI_API_KEY: "" }, { OPENAI_API_KEY: "synthetic-openai-test-key" }])(
    "does not activate a different provider when Gemini credentials are absent %o",
    (value) => expect(loadCommercialV1AIConfig(value)).toBeNull(),
  );
  it("accepts only overrides identical to the approved provider/model pin", () => {
    expect(
      loadCommercialV1AIConfig({
        ...environment,
        AI_PROVIDER: "gemini",
        AI_MODEL: "gemini-3.8-flash",
      }),
    ).toEqual(config());
  });
  it.each([
    { AI_PROVIDER: "openai" },
    { AI_PROVIDER: "claude" },
    { AI_PROVIDER: "" },
    { AI_MODEL: "latest" },
    { AI_MODEL: "gpt-5.6-luna" },
    { AI_MODEL: "gemini-3.8-flash-preview" },
    { AI_MODEL: "" },
    { GEMINI_API_KEY: "short" },
    { GEMINI_API_KEY: "x".repeat(513) },
    { GEMINI_API_KEY: "synthetic-key with-space" },
    { GEMINI_API_KEY: "synthetic-key\nnewline" },
    { AI_REQUEST_TIMEOUT_MS: "0" },
    { AI_REQUEST_TIMEOUT_MS: "120001" },
    { AI_REQUEST_TIMEOUT_MS: "NaN" },
  ])("rejects unapproved or invalid configuration without leaking credentials %o", (override) => {
    const value = { ...environment, ...override };
    try {
      loadCommercialV1AIConfig(value);
      throw new Error("Expected configuration rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "configuration_invalid" });
      expect(String(error)).not.toContain(value.GEMINI_API_KEY);
    }
  });
  it("does not let a missing key hide an unapproved provider/model override", () => {
    expect(() => loadCommercialV1AIConfig({ AI_PROVIDER: "openai" })).toThrow();
    expect(() => loadCommercialV1AIConfig({ AI_MODEL: "latest" })).toThrow();
  });
  it.each([false, true])(
    "pins ordinary/repair requests without tools or provider state: %s",
    async (repair) => {
      const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(envelope())));
      const provider = createCommercialV1AIProvider(config(), { fetch: request });
      expect(await provider.decide(input(repair))).toMatchObject({
        kind: "completed",
        model: "gemini-3.8-flash",
      });
      const call = request.mock.calls[0];
      if (typeof call?.[1]?.body !== "string") throw new TypeError("Missing mock request");
      expect(call[0]).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      );
      const sent: unknown = JSON.parse(call[1].body);
      expect(COMMERCIAL_V1_AI_INSTRUCTIONS).toBe(EVAL_INSTRUCTIONS);
      expect(sent).toMatchObject({
        systemInstruction: { parts: [{ text: EVAL_INSTRUCTIONS }] },
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: OPENAI_AGENT_DECISION_SCHEMA,
          maxOutputTokens: 4000,
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
      expect(Object.keys(sent ?? {})).toEqual([
        "systemInstruction",
        "contents",
        "generationConfig",
      ]);
      expect(call[1]).toMatchObject({
        redirect: "error",
        headers: { "x-goog-api-key": environment.GEMINI_API_KEY },
      });
      expect(JSON.stringify(sent)).not.toContain(environment.GEMINI_API_KEY);
      expect(Object.isFrozen(provider)).toBe(true);
    },
  );
  it("rejects a different resolved model without allowing schema repair or silent fallback", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(envelope("different-model"))),
    );
    const result = await createCommercialV1AIProvider(config(), { fetch: request }).decide(input());
    expect(result).toMatchObject({ kind: "invalid_output", model: "different-model" });
    expect(result).not.toHaveProperty("outputHash");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 503])(
    "never falls back to OpenAI or adds transport retries on HTTP %s",
    async (status) => {
      const request = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response("synthetic-error", { status })),
      );
      const result = await createCommercialV1AIProvider(config(), { fetch: request }).decide(
        input(),
      );
      expect(result.kind).toBe("provider_error");
      expect(request).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(environment.GEMINI_API_KEY);
    },
  );
  it("retains the publicly supported non-default Luna/OpenAI adapter", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("synthetic-error", { status: 503 })),
    );
    const nonDefault = loadOpenAIHarnessConfig({
      OPENAI_API_KEY: "synthetic-openai-test-key",
      AI_MODEL: "gpt-5.6-luna",
    });
    await createOpenAIProvider(nonDefault, { fetch: request }).decide(input());
    expect(request.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    expect(request).toHaveBeenCalledTimes(1);
    expect(config().model).toBe("gemini-3.8-flash");
  });
});
