export type AITokenUsage = Readonly<{
  input: number | null;
  output: number | null;
  cachedInput: number | null;
  total: number | null;
}>;

export type AIPriceCatalogEntry = Readonly<{
  cachedInputMicrosPerMillion: bigint;
  currency: "USD";
  effectiveFrom: string;
  effectiveTo: string | null;
  inputMicrosPerMillion: bigint;
  model: string;
  outputMicrosPerMillion: bigint;
  provider: string;
  source: string;
  version: string;
}>;

/** Frozen from the provider price evidence accepted during S13. */
export const AI_PRICE_CATALOG: readonly AIPriceCatalogEntry[] = Object.freeze([
  Object.freeze({
    cachedInputMicrosPerMillion: 75_000n,
    currency: "USD",
    effectiveFrom: "2026-09-17T00:00:00.000Z",
    effectiveTo: "2027-01-01T00:00:00.000Z",
    inputMicrosPerMillion: 750_000n,
    model: "gemini-3.8-flash",
    outputMicrosPerMillion: 3_750_000n,
    provider: "gemini",
    source: "docs/ai/s13-model-market.md#provider-pricing",
    version: "ai-provider-prices.2026-09-17.v1",
  }),
  Object.freeze({
    cachedInputMicrosPerMillion: 150_000n,
    currency: "USD",
    effectiveFrom: "2027-01-01T00:00:00.000Z",
    effectiveTo: null,
    inputMicrosPerMillion: 1_500_000n,
    model: "gemini-3.8-flash",
    outputMicrosPerMillion: 7_500_000n,
    provider: "gemini",
    source: "docs/ai/s13-model-market.md#provider-pricing",
    version: "ai-provider-prices.2027-01-01.v1",
  }),
  Object.freeze({
    cachedInputMicrosPerMillion: 20_000n,
    currency: "USD",
    effectiveFrom: "2026-09-17T00:00:00.000Z",
    effectiveTo: null,
    inputMicrosPerMillion: 200_000n,
    model: "gpt-5.6-luna",
    outputMicrosPerMillion: 1_200_000n,
    provider: "openai",
    source: "docs/ai/s13-model-market.md#provider-pricing",
    version: "ai-provider-prices.2026-09-17.v1",
  }),
]);

const safeUnits = (value: number | null): value is number =>
  value !== null && Number.isSafeInteger(value) && value >= 0;

export const resolveAIPrice = (
  provider: string,
  model: string,
  occurredAt: Date,
  catalog: readonly AIPriceCatalogEntry[] = AI_PRICE_CATALOG,
): AIPriceCatalogEntry | null =>
  catalog.find(
    (entry) =>
      entry.provider === provider &&
      entry.model === model &&
      occurredAt.getTime() >= Date.parse(entry.effectiveFrom) &&
      (entry.effectiveTo === null || occurredAt.getTime() < Date.parse(entry.effectiveTo)),
  ) ?? null;

export const estimateAIUsageCost = (
  price: AIPriceCatalogEntry,
  usage: AITokenUsage,
): bigint | null => {
  if (
    !safeUnits(usage.input) ||
    !safeUnits(usage.output) ||
    !safeUnits(usage.cachedInput) ||
    usage.cachedInput > usage.input ||
    (usage.total !== null && (!safeUnits(usage.total) || usage.total < usage.input + usage.output))
  )
    return null;
  const cached = BigInt(usage.cachedInput);
  const uncached = BigInt(usage.input - usage.cachedInput);
  const numerator =
    uncached * price.inputMicrosPerMillion +
    cached * price.cachedInputMicrosPerMillion +
    BigInt(usage.output) * price.outputMicrosPerMillion;
  return (numerator + 999_999n) / 1_000_000n;
};

export type LatencySummary = Readonly<{
  count: number;
  maximumMs: number | null;
  p50Ms: number | null;
  p75Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  within10Seconds: number;
  within30Seconds: number;
  within3Seconds: number;
  within5Seconds: number;
  within60Seconds: number;
  over60Seconds: number;
}>;

const percentile = (sorted: readonly number[], fraction: number): number | null => {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};

export const summarizeLatencies = (samples: readonly number[]): LatencySummary => {
  if (samples.some((sample) => !Number.isSafeInteger(sample) || sample < 0 || sample > 86_400_000))
    throw new TypeError("Invalid latency observation");
  const sorted = [...samples].sort((left, right) => left - right);
  const within = (maximum: number) => sorted.filter((sample) => sample <= maximum).length;
  return Object.freeze({
    count: sorted.length,
    maximumMs: sorted.at(-1) ?? null,
    p50Ms: percentile(sorted, 0.5),
    p75Ms: percentile(sorted, 0.75),
    p90Ms: percentile(sorted, 0.9),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    within10Seconds: within(10_000),
    within30Seconds: within(30_000),
    within3Seconds: within(3_000),
    within5Seconds: within(5_000),
    within60Seconds: within(60_000),
    over60Seconds: sorted.length - within(60_000),
  });
};

export type OperationalChannel = "instagram" | "telegram" | "widget";
export type OperationalMetric = Readonly<{
  channel: OperationalChannel;
  durationMs?: number;
  kind:
    | "acknowledgement_latency"
    | "authentication_denial"
    | "meaningful_first_response_latency"
    | "origin_denial"
    | "outbound_failure"
    | "rate_limit_rejection";
  outcome: "accepted" | "denied" | "failed" | "succeeded";
}>;
export interface OperationalMetrics {
  observe(metric: OperationalMetric): void;
  observeWidgetMeaningfulLatency(organizationId: string, durationMs: number): void;
  widgetMeaningfulLatency(organizationId: string): LatencySummary;
}

const metricKinds = new Set<OperationalMetric["kind"]>([
  "acknowledgement_latency",
  "authentication_denial",
  "meaningful_first_response_latency",
  "origin_denial",
  "outbound_failure",
  "rate_limit_rejection",
]);
const metricChannels = new Set<OperationalChannel>(["instagram", "telegram", "widget"]);
const metricOutcomes = new Set<OperationalMetric["outcome"]>([
  "accepted",
  "denied",
  "failed",
  "succeeded",
]);

/** Process-local, bounded and deliberately unable to accept IDs, content or arbitrary labels. */
export const createOperationalMetrics = (
  maximumSamples = 10_000,
  maximumTenantSeries = 1_000,
): OperationalMetrics => {
  if (
    !Number.isSafeInteger(maximumSamples) ||
    maximumSamples < 1 ||
    maximumSamples > 100_000 ||
    !Number.isSafeInteger(maximumTenantSeries) ||
    maximumTenantSeries < 1 ||
    maximumTenantSeries > 10_000
  )
    throw new TypeError("Invalid metric capacity");
  const widgetSamples = new Map<string, number[]>();
  const validOrganizationId = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
  return Object.freeze({
    observe: (metric: OperationalMetric) => {
      if (
        !metricKinds.has(metric.kind) ||
        !metricChannels.has(metric.channel) ||
        !metricOutcomes.has(metric.outcome)
      )
        throw new TypeError("Invalid bounded metric");
      if (metric.durationMs !== undefined) {
        if (metric.durationMs > 300_000) throw new TypeError("Invalid bounded metric duration");
        summarizeLatencies([metric.durationMs]);
      }
    },
    observeWidgetMeaningfulLatency: (organizationId: string, durationMs: number) => {
      if (
        !validOrganizationId(organizationId) ||
        !Number.isSafeInteger(durationMs) ||
        durationMs < 0 ||
        durationMs > 300_000
      )
        throw new TypeError("Invalid tenant Widget metric");
      let samples = widgetSamples.get(organizationId);
      if (samples === undefined) {
        if (widgetSamples.size >= maximumTenantSeries) return;
        samples = [];
        widgetSamples.set(organizationId, samples);
      }
      samples.push(durationMs);
      if (samples.length > maximumSamples) samples.shift();
    },
    widgetMeaningfulLatency: (organizationId: string) =>
      validOrganizationId(organizationId)
        ? summarizeLatencies(widgetSamples.get(organizationId) ?? [])
        : summarizeLatencies([]),
  });
};
