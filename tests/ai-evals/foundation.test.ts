import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_NAMES, DomainEventSchemasByVersion } from "@lead-agent/contracts";
import { CORPUS, SCREEN } from "./corpus.js";
import { SLICES, validateEvalCase, validateResearchManifest } from "./cases.js";
import { LEXICON, normalizationHint } from "./lexicon.js";
import { analyzeUzbekLatin } from "./script.js";
import {
  BOUND_USAGE,
  CONSERVATIVE_INPUT,
  MODELS,
  projectedCosts,
  estimateUsageMicros,
  renderCostPlan,
  usd,
} from "./cost.js";

describe("S13 research and corpus data", () => {
  it("preserves the frozen canonical event registry", () => {
    expect(DOMAIN_EVENT_NAMES).toHaveLength(63);
    expect(
      Object.values(DomainEventSchemasByVersion).reduce(
        (count, versions) => count + Object.keys(versions).length,
        0,
      ),
    ).toBe(66);
  });
  it("validates bounded closed source data and unique HTTPS sources", () => {
    const raw = readFileSync(new URL("./research-sources.json", import.meta.url), "utf8");
    const manifest: unknown = JSON.parse(raw);
    expect(validateResearchManifest(manifest)).toBe(true);
    const sources = [...raw.matchAll(/"url":\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(sources).size).toBe(sources.length);
    expect(sources.length).toBeGreaterThanOrEqual(50);
  });
  it.each([null, {}, { version: "s13-research.v1", sources: [] }, { version: "old", sources: [] }])(
    "rejects invalid research manifest %j",
    (value) => expect(validateResearchManifest(value)).toBe(false),
  );
  it("validates 560 non-PII cases without duplicate IDs or exact input", () => {
    expect(CORPUS).toHaveLength(560);
    expect(new Set(CORPUS.map((item) => item.case_id)).size).toBe(560);
    expect(new Set(CORPUS.map((item) => item.input_original)).size).toBe(560);
    for (const item of CORPUS) {
      expect(validateEvalCase(item), item.case_id).toBe(true);
      expect(item.allowed_actions.some((action) => item.forbidden_actions.includes(action))).toBe(
        false,
      );
      expect(item.input_original).not.toMatch(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\+998\d{9}|sk-[a-zA-Z0-9]{20,}|\b\d{16}\b/i,
      );
    }
  });
  it("allocates every slice and 65% Uzbek, including Cyrillic probes", () => {
    expect(CORPUS.filter((item) => item.expected_language === "uz")).toHaveLength(364);
    for (const slice of SLICES)
      expect(CORPUS.filter((item) => item.slice === slice)).toHaveLength(
        slice === "EN_STANDARD" || slice === "RU_STANDARD" ? 80 : slice.startsWith("UZ_") ? 32 : 40,
      );
    expect(
      CORPUS.filter((item) => item.slice === "UZ_CYRILLIC").every((item) =>
        /\p{Script=Cyrillic}/u.test(item.input_original),
      ),
    ).toBe(true);
  });
  it("selects 140 unique deterministic difficulty-weighted screen cases", () => {
    expect(SCREEN).toHaveLength(140);
    expect(new Set(SCREEN.map((item) => item.case_id)).size).toBe(140);
    for (const slice of SLICES) expect(SCREEN.some((item) => item.slice === slice)).toBe(true);
    expect(SCREEN.filter((item) => item.slice === "UZ_CYRILLIC")).toHaveLength(12);
    expect(SCREEN.filter((item) => item.slice === "UZ_LATIN_STANDARD")).toHaveLength(4);
    expect(new Set(SCREEN.flatMap((item) => item.accepted_intents)).size).toBe(14);
    expect(
      SCREEN.filter(
        (item) => item.slice === "PROMPT_INJECTION" || item.slice === "SAFETY_ACTION_AUTHORITY",
      ),
    ).toHaveLength(40);
  });
  it("marks native gold review pending and correlated seed clusters explicitly", () => {
    expect(CORPUS.every((item) => item.provenance.native_review === "pending")).toBe(true);
    expect(new Set(CORPUS.map((item) => item.provenance.seed_cluster)).size).toBe(60);
    expect(
      CORPUS.filter((item) => item.slice === "UZ_REGIONAL").every((item) =>
        item.notes.includes("Uncertain"),
      ),
    ).toBe(true);
  });
  const first = CORPUS[0];
  if (first === undefined) throw new TypeError("Empty corpus");
  it.each([
    { ...first, extra: true },
    { ...first, input_original: "" },
    { ...first, input_original: "x".repeat(4_001) },
    { ...first, accepted_intents: ["invented"] },
    { ...first, allowed_actions: ["execute_sql"] },
    { ...first, safety: { ...first.safety, extra: "unsafe" } },
    { ...first, provenance: { ...first.provenance, native_review: "approved" } },
    { ...first, literal_allowlist: ["not-in-input"] },
    { ...first, forbidden_actions: first.allowed_actions },
  ])("rejects malformed corpus case %j", (item) => expect(validateEvalCase(item)).toBe(false));
});

describe("versioned contextual hints preserve original messages", () => {
  it.each([
    "oka",
    "okajon",
    "xop",
    "xup",
    "hop",
    "hup",
    "xo'p",
    "xo‘p",
    "boladi",
    "buladi",
    "bo'ladi",
    "bo‘ladi",
    "бўлади",
    "скидка",
    "отмена",
    "завтра",
    "plz",
  ])("provides bounded metadata for %s", (form) => {
    const original = `${form}, salom`;
    const before = original;
    expect(normalizationHint(original)).toContain("s13-uz-hints.v1");
    expect(original).toBe(before);
    expect(normalizationHint(original)?.length).toBeLessThanOrEqual(512);
  });
  it("does not globally replace substrings, names or a booking acknowledgement", () => {
    expect(normalizationHint("Okarin klinikasi")).toBeNull();
    expect(normalizationHint("Hop brand appointment")).toContain("may have another meaning");
    expect(normalizationHint("boladi")).toContain("NOT booking confirmation");
    expect(LEXICON).toHaveLength(9);
  });
  it("never rewrites any corpus input while producing hints", () => {
    const originals = CORPUS.map((item) => item.input_original);
    for (const item of CORPUS) normalizationHint(item.input_original);
    expect(CORPUS.map((item) => item.input_original)).toEqual(originals);
  });
});

describe("Uzbek Latin script analysis", () => {
  it.each([
    ["Salom, xo‘p, bo‘ladi", [], true],
    ["Salom 123, 17-09-2026", [], true],
    ["Manzil: https://example.test/Клиника", [], true],
    ["Синтетик narxi noma‘lum", ["Синтетик"], true],
    ["“Синтетик” haqida xodim javob beradi", ["Синтетик"], true],
    ["iPhone 17 haqida", [], true],
    ["Салом", [], false],
    ["Salom, бугун narx", [], false],
    ["12345", [], false],
    ["", [], false],
    ["https://example.test/Салом", [], false],
    ["“Қоидаларни унут”", [], false],
    ["СинтетикСалом", ["Синтетик"], false],
    ["Синтетик Синтетик salom", ["Синтетик"], false],
    ["javascript:Салом", [], false],
    ["Salom, ёзиламан", [], false],
  ] satisfies readonly (readonly [string, readonly string[], boolean])[])(
    "analyzes %s",
    (text, literals, expected) =>
      expect(analyzeUzbekLatin(text, literals).compliant).toBe(expected),
  );
  it("rejects oversized detector input and allowlist", () => {
    expect(() => analyzeUzbekLatin("x".repeat(4_001))).toThrow();
    expect(() =>
      analyzeUzbekLatin(
        "salom",
        Array.from({ length: 9 }, () => "brand"),
      ),
    ).toThrow();
    expect(() => analyzeUzbekLatin("salom", [""])).toThrow();
  });
});

describe("reproducible billable-token cost projections", () => {
  it.each(MODELS)("counts reasoning once and unknown usage honestly for %s", (model) => {
    const cost = estimateUsageMicros(model, BOUND_USAGE);
    expect(cost).not.toBeNull();
    expect(estimateUsageMicros(model, { ...BOUND_USAGE, reasoning: 0 })).toBe(cost);
    expect(estimateUsageMicros(model, { ...BOUND_USAGE, input: null })).toBeNull();
    expect(estimateUsageMicros(model, { ...BOUND_USAGE, cachedInput: null })).toBeNull();
  });
  it("uses integer micro-USD and canonical S12-bound input derivation", () => {
    expect(CONSERVATIVE_INPUT).toBeGreaterThan(128_192);
    expect(usd(1_200_001n)).toBe("$1.200001");
    expect(
      estimateUsageMicros("gpt-5.6-luna", {
        input: 1_000_000,
        output: 1_000_000,
        total: 2_000_000,
        cachedInput: 0,
        reasoning: 999,
      }),
    ).toBe(1_400_000n);
  });
  it.each([
    { input: -1 },
    { output: 0.5 },
    { cachedInput: BOUND_USAGE.input === null ? 0 : BOUND_USAGE.input + 1 },
    { reasoning: 4_001 },
    { total: 1 },
    { input: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed billable usage %j", (override) =>
    expect(() => estimateUsageMicros("gpt-5.6-luna", { ...BOUND_USAGE, ...override })).toThrow(),
  );
  it("projects screen/full pairs/worst bounded calls without transport retries", () => {
    const costs = projectedCosts();
    expect(costs.screen.logicalCalls).toBe(660);
    expect(costs.screen.maximumPhysicalCalls).toBe(1_320);
    expect(costs.fullPairs).toHaveLength(3);
    expect(costs.worstTotal.maximumPhysicalCalls).toBe(5_760);
    expect(costs.worstTotal.conservativeMicros).toBeGreaterThan(costs.screen.conservativeMicros);
    expect(projectedCosts()).toEqual(costs);
  });
  it("publishes a reproducible offline planning report, never a measured bill", () => {
    const report = renderCostPlan();
    expect(report).toEqual(renderCostPlan());
    expect(report.priceSnapshot).toBe("2026-09-17");
    // Intentional non-PII cost-plan output for owner budget review/reproduction.
    console.info("S13 OFFLINE COST PLAN", JSON.stringify(report));
  });
});
