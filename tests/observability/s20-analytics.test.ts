import { describe, expect, it } from "vitest";

import {
  AI_PRICE_CATALOG,
  createOperationalMetrics,
  estimateAIUsageCost,
  resolveAIPrice,
  summarizeLatencies,
  type AIPriceCatalogEntry,
} from "../../packages/observability/src/index.js";

describe("S20 cost and low-cardinality observability", () => {
  it("prices current Gemini and Luna usage with cached input and billable output", () => {
    const at = new Date("2026-09-19T00:00:00.000Z");
    const gemini = resolveAIPrice("gemini", "gemini-3.8-flash", at);
    const luna = resolveAIPrice("openai", "gpt-5.6-luna", at);
    expect(gemini?.version).toBe("ai-provider-prices.2026-09-17.v1");
    expect(luna?.version).toBe("ai-provider-prices.2026-09-17.v1");
    if (gemini === null || luna === null) throw new Error("Missing current price");
    expect(
      estimateAIUsageCost(gemini, { input: 1_000, cachedInput: 200, output: 400, total: 1_400 }),
    ).toBe(2_115n);
    expect(
      estimateAIUsageCost(luna, { input: 1_000, cachedInput: 200, output: 400, total: 1_400 }),
    ).toBe(644n);
    expect(resolveAIPrice("gemini", "gemini-3.8-flash", new Date("2027-01-01"))?.version).toBe(
      "ai-provider-prices.2027-01-01.v1",
    );
  });

  it("selects a historical price by run time and never invents unknown usage cost", () => {
    const historical: AIPriceCatalogEntry = {
      ...AI_PRICE_CATALOG[0]!,
      effectiveFrom: "2025-01-01T00:00:00.000Z",
      effectiveTo: "2026-01-01T00:00:00.000Z",
      inputMicrosPerMillion: 100_000n,
      version: "historical.v1",
    };
    const current: AIPriceCatalogEntry = {
      ...historical,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      inputMicrosPerMillion: 200_000n,
      version: "current.v2",
    };
    expect(
      resolveAIPrice("gemini", historical.model, new Date("2025-06-01"), [historical, current])
        ?.version,
    ).toBe("historical.v1");
    expect(
      resolveAIPrice("gemini", historical.model, new Date("2026-06-01"), [historical, current])
        ?.version,
    ).toBe("current.v2");
    expect(
      estimateAIUsageCost(current, { input: null, cachedInput: null, output: null, total: null }),
    ).toBeNull();
    expect(
      estimateAIUsageCost(current, { input: 10, cachedInput: 11, output: 1, total: 12 }),
    ).toBeNull();
  });

  it("computes nearest-rank percentiles and objective buckets from observations", () => {
    expect(summarizeLatencies([1_000, 4_200, 9_000, 38_000, 61_000])).toEqual({
      count: 5,
      maximumMs: 61_000,
      p50Ms: 9_000,
      p75Ms: 38_000,
      p90Ms: 61_000,
      p95Ms: 61_000,
      p99Ms: 61_000,
      within10Seconds: 3,
      within30Seconds: 3,
      within3Seconds: 1,
      within5Seconds: 2,
      within60Seconds: 4,
      over60Seconds: 1,
    });
    expect(() => summarizeLatencies([-1])).toThrow("Invalid latency observation");
  });

  it("accepts only finite dimensions and retains a bounded Widget sample", () => {
    const metrics = createOperationalMetrics(2);
    const tenant = "0199f1a8-7f65-7c28-a434-a10796c49b01";
    const otherTenant = "0199f1a8-7f65-7c28-a434-a10796c49b02";
    for (const durationMs of [1_000, 2_000, 3_000])
      metrics.observeWidgetMeaningfulLatency(tenant, durationMs);
    metrics.observeWidgetMeaningfulLatency(otherTenant, 9_000);
    expect(metrics.widgetMeaningfulLatency(tenant)).toMatchObject({
      count: 2,
      p50Ms: 2_000,
      maximumMs: 3_000,
    });
    expect(metrics.widgetMeaningfulLatency(otherTenant)).toMatchObject({ count: 1, p50Ms: 9_000 });
    expect(() =>
      metrics.observe({
        channel: "widget",
        durationMs: 300_001,
        kind: "meaningful_first_response_latency",
        outcome: "succeeded",
      }),
    ).toThrow();
  });
});
