import type { AITelemetry } from "@lead-agent/application";
import { AI_EXTRACTION_REJECTION_FIELDS } from "@lead-agent/application";

const citationCounts = (value: Parameters<AITelemetry["record"]>[0]["citationCounts"]) =>
  value != null &&
  Number.isSafeInteger(value.supplied) &&
  value.supplied >= 0 &&
  value.supplied <= 24 &&
  Number.isSafeInteger(value.proposed) &&
  value.proposed >= 0 &&
  value.proposed <= 12 &&
  Number.isSafeInteger(value.unmatched) &&
  value.unmatched >= 0 &&
  value.unmatched <= value.proposed
    ? { supplied: value.supplied, proposed: value.proposed, unmatched: value.unmatched }
    : null;

/** Explicit metadata projection: never spread provider/store objects into logs. */
export const createStructuredAITelemetry = (
  write: (record: Readonly<Record<string, unknown>>) => void = (record) =>
    console.info(JSON.stringify(record)),
): AITelemetry => ({
  record: (metric) => {
    try {
      write({
        service: "lead-agent-worker",
        event: "worker.ai.outcome",
        organizationId: metric.organizationId,
        conversationId: metric.conversationId,
        messageId: metric.messageId,
        correlationId: metric.correlationId,
        aiRunId: metric.runId,
        attemptNo: metric.attemptNo,
        outcome: metric.outcome,
        providerOutcome: metric.providerOutcome,
        model:
          metric.model !== null && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/u.test(metric.model)
            ? metric.model
            : null,
        usage:
          metric.usage === null
            ? null
            : {
                input: metric.usage.input,
                output: metric.usage.output,
                total: metric.usage.total,
                cachedInput: metric.usage.cachedInput,
                reasoning: metric.usage.reasoning,
              },
        failure: metric.failure,
        proposedAction: metric.proposedAction,
        schemaValid: metric.schemaValid,
        policyRejectionCode: metric.modelRejection,
        extractionRejectionFields: AI_EXTRACTION_REJECTION_FIELDS.filter(
          (field) =>
            metric.modelRejection === "untrusted_extraction" &&
            metric.extractionRejectionFields?.includes(field),
        ),
        citationCounts: citationCounts(metric.citationCounts),
        salesResultKind: metric.salesResultKind,
        replyDisposition: metric.replyDisposition,
        latencyMs: metric.latencyMs,
        repair: metric.repair,
        transportRetries: metric.transportRetries,
      });
    } catch {
      // Diagnostics must not replay an already-committed provider invocation.
      console.error("AI telemetry export failed", { code: "ai_telemetry_failed" });
    }
  },
});
