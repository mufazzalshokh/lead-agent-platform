import { describe, expect, it, vi } from "vitest";
import { createAIMessageHandler } from "../../apps/worker/src/ai-handler.js";
import { createProductionHandlerRegistry } from "../../apps/worker/src/telegram-outbound.js";
import type { WorkerEventHandler } from "../../apps/worker/src/handler-registry.js";
import { aiFallback, type createAIOrchestrator } from "../../packages/application/src/index.js";
import { DomainEventSchemasByVersion, isSchemaValue } from "../../packages/contracts/src/index.js";
import { AI_REFERENCE, fixtureId } from "./fixtures.js";

const context = (): Parameters<WorkerEventHandler>[0] => {
  const event: unknown = {
    actor: { actor_type: "system", actor_id: null },
    aggregate_id: AI_REFERENCE.conversationId,
    aggregate_type: "conversation",
    aggregate_version: 2,
    causation_id: null,
    correlation_id: AI_REFERENCE.correlationId,
    event_id: AI_REFERENCE.causationId,
    event_type: "message.received",
    occurred_at: "2026-09-15T08:00:00.000Z",
    organization_id: AI_REFERENCE.organizationId,
    payload: { message_direction: "inbound", message_id: AI_REFERENCE.messageId },
    request_id: null,
    schema_id: "MessageReceivedDomainEvent.v1",
    schema_version: "1",
  };
  if (!isSchemaValue(DomainEventSchemasByVersion["message.received"]["1"], event))
    throw new TypeError("Invalid S12 worker fixture");
  return {
    attempt: { attemptNumber: 1, jobId: fixtureId(12300), retryLimit: 5 },
    canonicalEvent: event,
    causationId: null,
    correlationId: AI_REFERENCE.correlationId,
    identity: {
      handlerVersion: "v1",
      idempotencyKey: `v1:${event.event_id}`,
      outboxEventId: event.event_id,
      providerIdempotencyKey: event.event_id,
    },
    organizationId: AI_REFERENCE.organizationId,
    outboxEventId: event.event_id,
    signal: new AbortController().signal,
    tenant: { organizationId: AI_REFERENCE.organizationId },
  };
};
describe("S12 finite reference-only worker integration", () => {
  it("translates the canonical Conversation-scoped Message event to exact durable references", async () => {
    const run = vi.fn<ReturnType<typeof createAIOrchestrator>["run"]>(() =>
      Promise.resolve(aiFallback("refusal")),
    );
    const value = context();
    await createAIMessageHandler({ run })(value);
    expect(run).toHaveBeenCalledWith(AI_REFERENCE, value.signal);
  });
  it("rejects malformed payload before orchestration", async () => {
    const run = vi.fn<ReturnType<typeof createAIOrchestrator>["run"]>();
    const value = context();
    await expect(
      createAIMessageHandler({ run })({
        ...value,
        canonicalEvent: {
          ...value.canonicalEvent,
          payload: { message_direction: "inbound", message_id: "not-an-id" },
        },
      }),
    ).rejects.toMatchObject({ code: "worker_job_invariant_failed" });
    expect(run).not.toHaveBeenCalled();
  });
  it("does not add transcript/draft fields to the queue reference", async () => {
    const run = vi.fn<ReturnType<typeof createAIOrchestrator>["run"]>(() =>
      Promise.resolve(aiFallback("refusal")),
    );
    await createAIMessageHandler({ run })(context());
    expect(Object.keys(run.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      "causationId",
      "conversationId",
      "correlationId",
      "messageId",
      "organizationId",
    ]);
  });
  it("activates only the already-owned ai event route when explicitly configured", () => {
    const outbound = vi.fn<WorkerEventHandler>();
    const handler = vi.fn<WorkerEventHandler>();
    const registry = createProductionHandlerRegistry({
      telegramOutbound: outbound,
      aiMessage: handler,
    });
    expect(registry.activeRoutes).toEqual(
      expect.arrayContaining([{ eventType: "message.received", schemaVersion: "1" }]),
    );
    expect(
      createProductionHandlerRegistry({ telegramOutbound: outbound }).activeRoutes,
    ).not.toEqual(expect.arrayContaining([{ eventType: "message.received", schemaVersion: "1" }]));
  });
});
