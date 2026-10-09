import { describe, expect, it, vi } from "vitest";
import {
  createAppointmentSubmissionOrchestrator,
  EMPTY_SALES_EVIDENCE,
  planAppointmentSubmission,
  type AIOrchestrationStore,
  type AIProviderResult,
  type AITelemetry,
} from "../../packages/application/src/index.js";
import { createStructuredAITelemetry } from "../../apps/worker/src/ai-telemetry.js";
import { AI_METADATA, AI_REFERENCE, AI_SNAPSHOT, fixtureId, validDecision } from "./fixtures.js";
import {
  isSchemaValue,
  LeadIdSchema,
  ResourceIdSchema,
} from "../../packages/contracts/src/index.js";

const leadId = fixtureId(41101),
  policyId = fixtureId(41102);
if (!isSchemaValue(LeadIdSchema, leadId) || !isSchemaValue(ResourceIdSchema, policyId))
  throw new Error("Invalid synthetic fallback context");

const snapshot = {
  ...AI_SNAPSHOT,
  locale: "uz" as const,
  message: "Salom, konsultatsiya narxi qancha va qancha davom etadi?",
  sales: {
    leadId,
    leadVersion: 1,
    leadStatus: "engaged",
    policy: { id: policyId, version: 1 },
    services: [],
    locations: [],
    stored: EMPTY_SALES_EVIDENCE,
    contactable: true,
  },
};

describe("S22 rejected-proposal disposition and safe structured telemetry", () => {
  const setup = (
    mode:
      "rejected" | "budget" | "stale" | "extraction" | "citation" | "citation_empty" = "rejected",
  ) => {
    const write = vi.fn<(record: Readonly<Record<string, unknown>>) => void>(),
      record = vi.fn<(plan: ReturnType<typeof planAppointmentSubmission>) => void>(),
      metric = vi.fn<AITelemetry["record"]>(),
      safeTelemetry = createStructuredAITelemetry(write);
    const claim = validDecision({
      factual_claims: [
        {
          claim_kind: "price",
          source_type: "service",
          source_id: fixtureId(41200),
          source_version: 4,
        },
      ],
    }).factual_claims[0];
    if (claim === undefined) throw new Error("Missing synthetic citation");
    const testSnapshot = {
      ...snapshot,
      policy: {
        ...snapshot.policy,
        facts: mode === "citation" ? [{ reference: claim, text: "SYNTHETIC_PRIVATE_FACT" }] : [],
      },
    };
    const decide = vi.fn((): Promise<AIProviderResult> =>
      Promise.resolve({
        ...AI_METADATA,
        kind: "completed",
        value: validDecision({
          language: "uz",
          action:
            mode === "extraction" || mode === "citation" || mode === "citation_empty"
              ? { type: "none" }
              : { type: "request_handoff", reason: "customer_requested" },
          ...(mode === "extraction"
            ? {
                extracted_facts: {
                  ...validDecision().extracted_facts,
                  display_name: "PRIVATE_CUSTOMER_NAME",
                  phone_raw: "+998900000000",
                },
              }
            : {}),
          ...(mode === "citation" || mode === "citation_empty"
            ? { factual_claims: [{ ...claim, source_version: 5 }] }
            : {}),
          message: { mode: "send_candidate", draft_text: "SENSITIVE_UNTRUSTED_PROVIDER_BODY" },
        }),
      }),
    );
    const finish: AIOrchestrationStore["finish"] = (input) => {
      const outcome =
        mode === "stale"
          ? {
              kind: "fallback_required" as const,
              reason: "stale_context" as const,
              applied: false as const,
            }
          : input.outcome;
      const plan = planAppointmentSubmission(testSnapshot, outcome);
      record(plan);
      // A controlled application/store test, not live or PostgreSQL persistence evidence.
      return Promise.resolve({
        ...outcome,
        salesResult: plan.result,
        replyDisposition: plan.text === null ? "suppressed" : "queued",
      });
    };
    const flow = createAppointmentSubmissionOrchestrator({
      provider: { decide },
      timeoutMs: 1000,
      telemetry: {
        record: (input) => {
          metric(input);
          safeTelemetry.record(input);
        },
      },
      store: {
        load: () => Promise.resolve(testSnapshot),
        reserve: () => Promise.resolve({ runId: fixtureId(41103), attemptNo: 1 }),
        authorizeDispatch: () => Promise.resolve(mode !== "budget"),
        finish,
      },
    });
    return { flow, decide, write, record, metric };
  };
  it.each(["citation", "citation_empty"] as const)(
    "%s rejection reports only bounded snapshot counts and never repairs a policy denial",
    async (mode) => {
      const test = setup(mode);
      expect(await test.flow.run(AI_REFERENCE)).toMatchObject({ kind: "handoff_requested" });
      expect(test.decide).toHaveBeenCalledOnce();
      expect(test.record.mock.calls[0]?.[0]).toMatchObject({ submission: null, sources: [] });
      expect(test.write).toHaveBeenCalledWith(
        expect.objectContaining({
          policyRejectionCode: "untrusted_citation",
          citationCounts: { supplied: mode === "citation" ? 1 : 0, proposed: 1, unmatched: 1 },
          providerOutcome: "completed",
          schemaValid: true,
          replyDisposition: "queued",
        }),
      );
      expect(JSON.stringify(test.write.mock.calls)).not.toMatch(
        /SYNTHETIC_PRIVATE_FACT|SENSITIVE|source_id|source_version/u,
      );
    },
  );
  it("citation telemetry projects only valid counts, not extra properties or unbounded values", async () => {
    const test = setup("citation");
    await test.flow.run(AI_REFERENCE);
    const input = test.metric.mock.calls[0]?.[0];
    if (input === undefined) throw new Error("Missing telemetry metric");
    const write = vi.fn<(record: Readonly<Record<string, unknown>>) => void>();
    const sink = createStructuredAITelemetry(write);
    const withPrivateExtra = {
      supplied: 1,
      proposed: 1,
      unmatched: 1,
      payload: "PRIVATE_CITATION",
    };
    sink.record({ ...input, citationCounts: withPrivateExtra });
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        citationCounts: { supplied: 1, proposed: 1, unmatched: 1 },
      }),
    );
    for (const counts of [
      null,
      { supplied: 25, proposed: 1, unmatched: 1 },
      { supplied: 1, proposed: 13, unmatched: 1 },
      { supplied: 1, proposed: 1, unmatched: 2 },
      { supplied: 1, proposed: 1, unmatched: -1 },
      { supplied: Number.NaN, proposed: 1, unmatched: 1 },
    ]) {
      sink.record({ ...input, citationCounts: counts });
      expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ citationCounts: null }));
    }
    expect(JSON.stringify(write.mock.calls)).not.toContain("PRIVATE_CITATION");
  });
  it("reports rejected field names through the complete controlled path, never values", async () => {
    const test = setup("extraction");
    expect(await test.flow.run(AI_REFERENCE)).toMatchObject({
      kind: "handoff_requested",
      reason: "policy_blocked",
    });
    expect(test.decide).toHaveBeenCalledOnce();
    expect(test.record.mock.calls[0]?.[0].submission).toBeNull();
    expect(test.write).toHaveBeenCalledWith(
      expect.objectContaining({
        policyRejectionCode: "untrusted_extraction",
        extractionRejectionFields: ["display_name", "phone_raw"],
        replyDisposition: "queued",
      }),
    );
    expect(JSON.stringify(test.write.mock.calls)).not.toMatch(
      /PRIVATE_CUSTOMER_NAME|998900000000|SENSITIVE|draft_text/u,
    );
  });
  it("one rejected physical call has a safe terminal plan and correlated disposition", async () => {
    const test = setup();
    expect(await test.flow.run(AI_REFERENCE)).toMatchObject({
      kind: "handoff_requested",
      reason: "policy_blocked",
    });
    expect(test.decide).toHaveBeenCalledOnce();
    expect(test.record.mock.calls[0]?.[0]).toMatchObject({
      submission: null,
      sources: [],
      handoffReason: "policy_blocked",
    });
    expect(test.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "worker.ai.outcome",
        organizationId: AI_REFERENCE.organizationId,
        conversationId: AI_REFERENCE.conversationId,
        messageId: AI_REFERENCE.messageId,
        correlationId: AI_REFERENCE.correlationId,
        aiRunId: fixtureId(41103),
        attemptNo: 1,
        providerOutcome: "completed",
        schemaValid: true,
        proposedAction: "request_handoff",
        failure: "policy_denied",
        policyRejectionCode: "handoff_not_authorized",
        replyDisposition: "queued",
        salesResultKind: "handoff_requested",
        transportRetries: 0,
        model: AI_METADATA.model,
        usage: AI_METADATA.usage,
      }),
    );
    expect(JSON.stringify(test.write.mock.calls)).not.toMatch(
      /SENSITIVE|draft_text|token|phone_raw|responseId/u,
    );
  });
  it.each(["budget", "stale"] as const)(
    "%s denial stays distinct and has no fallback side effect",
    async (mode) => {
      const test = setup(mode);
      expect(await test.flow.run(AI_REFERENCE)).toMatchObject({
        kind: "grounding_insufficient",
        reason: mode === "budget" ? "policy_denied" : "stale_context",
      });
      expect(test.record.mock.calls[0]?.[0]).toMatchObject({
        text: null,
        handoffReason: null,
        submission: null,
      });
      expect(test.write).toHaveBeenCalledWith(
        expect.objectContaining({ replyDisposition: "suppressed", policyRejectionCode: null }),
      );
      expect(test.decide).toHaveBeenCalledTimes(mode === "budget" ? 0 : 1);
    },
  );
  it("a failed telemetry sink cannot throw or replay the committed action", async () => {
    const test = setup();
    await test.flow.run(AI_REFERENCE);
    const metric = test.write.mock.calls[0]?.[0];
    expect(metric).toBeDefined();
    // Use the actual orchestrator telemetry input, retaining type safety.
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejectedSink = createStructuredAITelemetry(() => {
      throw new Error("PRIVATE_SINK_ERROR");
    });
    const flow = createAppointmentSubmissionOrchestrator({
      provider: { decide: test.decide },
      timeoutMs: 1000,
      telemetry: rejectedSink,
      store: {
        load: () => Promise.resolve(snapshot),
        reserve: () => Promise.resolve({ runId: fixtureId(41104), attemptNo: 1 }),
        finish: (input) => Promise.resolve(input.outcome),
      },
    });
    await expect(flow.run(AI_REFERENCE)).resolves.toMatchObject({ kind: "grounding_insufficient" });
    expect(onError).toHaveBeenCalledWith("AI telemetry export failed", {
      code: "ai_telemetry_failed",
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain("PRIVATE");
    onError.mockRestore();
  });
});
