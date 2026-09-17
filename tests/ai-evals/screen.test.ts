import { describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";
import { buildGeminiRequest } from "../../packages/ai/src/providers/gemini.js";
import {
  EVAL_INSTRUCTIONS,
  ABLATIONS,
  INPUT_RESERVE,
  SMOKE,
  SCREEN_HASH,
  planScreen,
  inputForCase,
  openAIScreenFetch,
} from "./screen.js";
import { createBudgetLedger, reservePerCall, screenProjection } from "./budget.js";
import { SCREEN } from "./corpus.js";
import { analyzeUzbekLatin } from "./script.js";

describe("S13 bounded matched screen planning", () => {
  it("preserves exact core/all slices/intents and calls including extras/repairs", () => {
    expect(SMOKE).toHaveLength(10);
    expect(ABLATIONS).toHaveLength(5);
    expect(planScreen()).toHaveLength(155);
    expect(planScreen(true)).toHaveLength(160);
    expect(
      planScreen()
        .filter((row) => row.phase === "core")
        .map((row) => row.item),
    ).toEqual(SCREEN);
    expect(SCREEN_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(screenProjection(160)).toMatchObject({
      maximumPhysicalCalls: 640,
      reservedUSD: "$9.216000",
      normalUSD: "$0.876000",
    });
    expect(() => screenProjection(220)).toThrow();
  });
  it("never rewrites original input or includes expected answers", () => {
    for (const item of ABLATIONS) {
      const a = inputForCase(item, new AbortController().signal),
        b = inputForCase(item, new AbortController().signal, true);
      expect(a.message).toBe(item.input_original);
      expect(b.message).toBe(item.input_original);
      expect(b.history).toHaveLength(a.history.length + 1);
      for (const field of [
        "accepted_intents",
        "allowed_actions",
        "required_flags",
        "expected_language",
      ])
        expect(JSON.stringify(a)).not.toContain(field);
    }
  });
  it("identical common instructions/schema/data with API-only syntax differences; explicit low/low", async () => {
    const item = ABLATIONS[0];
    if (!item) throw new Error("Missing pair");
    const input = inputForCase(item, new AbortController().signal, true);
    const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));
    await createOpenAIProvider(
      { apiKey: "synthetic-openai-test-key", model: "gpt-5.6-luna", requestTimeoutMs: 1000 },
      { fetch: openAIScreenFetch(request) },
    ).decide(input);
    const sent = request.mock.calls[0]?.[1]?.body;
    if (typeof sent !== "string") throw new Error("Missing request");
    const body: unknown = JSON.parse(sent);
    const gemini = buildGeminiRequest(input, EVAL_INSTRUCTIONS, "low");
    expect(body).toMatchObject({
      instructions: EVAL_INSTRUCTIONS,
      reasoning: { effort: "low" },
      store: false,
      tools: [],
      max_output_tokens: 4000,
      input: [{ content: [{ text: gemini.contents[0]?.parts[0]?.text }] }],
      text: { format: { schema: gemini.generationConfig.responseJsonSchema } },
    });
    expect(gemini.systemInstruction.parts[0]?.text).toBe(EVAL_INSTRUCTIONS);
    expect(gemini.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
  });
  it("every fixture and repair stays within conservative serialized input reservation", () => {
    for (const row of planScreen(true))
      for (const repair of [false, true]) {
        const body = buildGeminiRequest(
          inputForCase(row.item, new AbortController().signal, row.hint, repair),
          EVAL_INSTRUCTIONS,
          "low",
        );
        expect(Buffer.byteLength(JSON.stringify(body)) + 512).toBeLessThanOrEqual(INPUT_RESERVE);
      }
  });
  it("keeps live spend gated and counts reasoning once", () => {
    const ledger = createBudgetLedger();
    ledger.before("gemini-3.8-flash");
    expect(
      ledger.after({ input: 3000, output: 500, total: 3500, cachedInput: 0, reasoning: 200 }),
    ).toBe("$0.004125");
    ledger.before("gpt-5.6-luna");
    expect(
      ledger.after({ input: 3000, output: 500, total: 3500, cachedInput: 0, reasoning: 200 }),
    ).toBe("$0.001350");
    expect(ledger.snapshot().estimatedSpendUSD).toBe("$0.005475");
  });
  it("unknown cache uses full price, not fabricated cache discount", () => {
    const ledger = createBudgetLedger();
    ledger.before("gemini-3.8-flash");
    expect(
      ledger.after({ input: 3000, output: 500, total: 3500, cachedInput: null, reasoning: null }),
    ).toBe("$0.004125");
  });
  it("unknown billed usage retains reservation and fails closed", () => {
    const ledger = createBudgetLedger();
    ledger.before("gpt-5.6-luna");
    expect(() =>
      ledger.after({ input: null, output: null, total: null, cachedInput: null, reasoning: null }),
    ).toThrow("Usage unknown");
    expect(ledger.snapshot().estimatedSpendUSD).toBe("$0.007050");
    expect(() => ledger.before("gpt-5.6-luna")).toThrow("Evaluation budget stop");
  });
  it("reserves before dispatch, rejects concurrent/unbounded calls", () => {
    const ledger = createBudgetLedger();
    ledger.before("gemini-3.8-flash");
    expect(() => ledger.before("gemini-3.8-flash")).toThrow();
    expect(reservePerCall("gemini-3.8-flash")).toBe(21750n);
  });
  it("optional work stops at target, all work stops before hard ceiling", () => {
    const ledger = createBudgetLedger();
    for (let i = 0; i < 230; i++) {
      ledger.before("gemini-3.8-flash");
      ledger.after({ input: 9000, output: 4000, total: 13000, cachedInput: 0, reasoning: 4000 });
    }
    expect(() => ledger.before("gemini-3.8-flash", true)).toThrow();
    for (let i = 230; i < 459; i++) {
      ledger.before("gemini-3.8-flash");
      ledger.after({ input: 9000, output: 4000, total: 13000, cachedInput: 0, reasoning: 4000 });
    }
    expect(() => ledger.before("gemini-3.8-flash")).toThrow();
  });
  it("exact original quotes exempted, arbitrary/whole quoted prose not a Latin pass", () => {
    expect(analyzeUzbekLatin('Siz "Салом" deb yozdingiz.', [], "Салом").compliant).toBe(true);
    expect(analyzeUzbekLatin('Siz "Подтверждено" dedingiz.', [], "Салом").compliant).toBe(false);
    expect(analyzeUzbekLatin('"Салом"', [], "Салом").compliant).toBe(false);
    expect(analyzeUzbekLatin('Salom "Салом" "Салом"', [], "Салом").compliant).toBe(false);
  });
});
