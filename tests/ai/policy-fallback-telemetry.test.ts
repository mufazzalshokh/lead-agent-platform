import { describe, expect, it, vi } from "vitest";
import {
  createAppointmentSubmissionOrchestrator,
  EMPTY_SALES_EVIDENCE,
  planAppointmentSubmission,
  type AIOrchestrationStore,
  type AIProviderResult,
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
  const setup = (mode: "rejected" | "budget" | "stale" | "extraction" = "rejected") => {
    const write = vi.fn<(record: Readonly<Record<string, unknown>>) => void>(),
      record = vi.fn<(plan: ReturnType<typeof planAppointmentSubmission>) => void>(),
      safeTelemetry = createStructuredAITelemetry(write);
    const decide = vi.fn((): Promise<AIProviderResult> =>
      Promise.resolve({
        ...AI_METADATA,
        kind: "completed",
        value: validDecision({
          language: "uz",
          action:
            mode === "extraction"
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
      const plan = planAppointmentSubmission(snapshot, outcome);
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
      telemetry: safeTelemetry,
      store: {
        load: () => Promise.resolve(snapshot),
        reserve: () => Promise.resolve({ runId: fixtureId(41103), attemptNo: 1 }),
        authorizeDispatch: () => Promise.resolve(mode !== "budget"),
        finish,
      },
    });
    return { flow, decide, write, record };
  };
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
