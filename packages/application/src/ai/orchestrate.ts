import { createHash } from "node:crypto";
import { buildAIProviderInput } from "./context.js";
import { aiFallback, evaluateAIDecision, validateAgentDecision } from "./policy.js";
import type {
  AIOrchestrationStore,
  AIOutcome,
  AIProvider,
  AIProviderResult,
  AITelemetry,
  AIWorkReference,
} from "./ports.js";

export const createAIOrchestrator = (
  options: Readonly<{
    provider: AIProvider;
    store: AIOrchestrationStore;
    timeoutMs: number;
    telemetry?: AITelemetry;
  }>,
) => {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120_000
  )
    throw new TypeError("Invalid orchestration deadline");
  return Object.freeze({
    run: async (reference: AIWorkReference, signal?: AbortSignal): Promise<AIOutcome> => {
      const deadline = AbortSignal.any([
        AbortSignal.timeout(options.timeoutMs),
        ...(signal === undefined ? [] : [signal]),
      ]);
      const snapshot = await options.store.load(reference);
      if (snapshot === null) return aiFallback("stale_context");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const input = buildAIProviderInput(snapshot, deadline, attempt === 1);
        const inputHash = createHash("sha256")
          .update(
            JSON.stringify(
              input === null
                ? [snapshot.conversationId, snapshot.sourceMessageId, "context_too_large"]
                : { ...input, signal: undefined },
            ),
          )
          .digest();
        const reservation = await options.store.reserve({ reference, snapshot, inputHash });
        if (reservation === null) return aiFallback("stale_context");
        let provider: AIProviderResult | null = null;
        let outcome: AIOutcome = aiFallback("provider_unavailable");
        if (input === null) outcome = aiFallback("context_too_large");
        else if (deadline.aborted) outcome = aiFallback("timeout");
        else {
          try {
            provider = await Promise.race([
              options.provider.decide(input),
              new Promise<AIProviderResult>((resolve) =>
                deadline.addEventListener(
                  "abort",
                  () =>
                    resolve({
                      kind: "timeout",
                      model: null,
                      responseId: null,
                      latencyMs: options.timeoutMs,
                      usage: {
                        input: null,
                        output: null,
                        total: null,
                        cachedInput: null,
                        reasoning: null,
                      },
                    }),
                  { once: true },
                ),
              ),
            ]);
          } catch {
            // Provider exceptions are never propagated as raw diagnostics or customer text.
            outcome = aiFallback("provider_unavailable");
          }
          if (provider !== null) {
            if (deadline.aborted) outcome = aiFallback("timeout");
            else if (provider.kind === "completed")
              outcome = validateAgentDecision(provider.value)
                ? evaluateAIDecision(provider.value, snapshot.policy)
                : aiFallback("invalid_output");
            else
              outcome = aiFallback(
                provider.kind === "timeout"
                  ? "timeout"
                  : provider.kind === "refusal"
                    ? "refusal"
                    : provider.kind === "invalid_output"
                      ? "invalid_output"
                      : "provider_unavailable",
              );
          }
        }
        const schemaInvalid =
          provider?.model != null &&
          ((provider.kind === "invalid_output" && provider.outputHash !== undefined) ||
            (provider.kind === "completed" && !validateAgentDecision(provider.value)));
        const allowRepair = attempt === 0 && schemaInvalid && !deadline.aborted;
        const resolved = await options.store.finish({
          reference,
          reservation,
          snapshot,
          provider,
          outcome,
          allowRepair,
        });
        options.telemetry?.record({
          operation: "decide",
          outcome: resolved.kind,
          providerOutcome: provider?.kind ?? null,
          model: provider?.model ?? null,
          schemaVersion: "1",
          transportRetries: 0,
          failure: resolved.kind === "fallback_required" ? resolved.reason : null,
          latencyMs: provider?.latencyMs ?? 0,
          usage: provider?.usage ?? null,
          repair: attempt === 1,
        });
        if (
          attempt === 0 &&
          schemaInvalid &&
          resolved.kind === "fallback_required" &&
          resolved.reason === "invalid_output" &&
          !deadline.aborted
        )
          continue;
        return resolved;
      }
      return aiFallback("invalid_output");
    },
  });
};
