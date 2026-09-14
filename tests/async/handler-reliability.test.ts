import { describe, expect, it, vi } from "vitest";

import type {
  WorkerExecutionIdentityInput,
  WorkerExecutionFinishState,
  WorkerReliabilityPersistencePort,
} from "../../apps/worker/src/handler-reliability.js";
import {
  createWorkerHandlerRegistry,
  type WorkerEventHandler,
} from "../../apps/worker/src/handler-registry.js";
import { createWorkerJobExecutor } from "../../apps/worker/src/job-executor.js";
import type { CanonicalDispatchEvent } from "../../apps/worker/src/outbox-dispatcher.js";
import { createPrivateQueueEnvelopeV1 } from "../../apps/worker/src/queue-envelope.js";
import type { QueueWorkItem } from "../../apps/worker/src/queue-infrastructure.js";
import { WorkerExecutionFailure } from "../../apps/worker/src/reliability-policy.js";

const ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-000000000101";
const OUTBOX_EVENT_ID = "0193f1a8-7f65-7c28-a434-000000000102";
const LEASE_TOKEN = "123e4567-e89b-42d3-a456-426614174000";
const NOW = new Date("2026-09-14T12:00:00.000Z");

const event: CanonicalDispatchEvent = Object.freeze({
  aggregate_id: ORGANIZATION_ID,
  aggregate_type: "organization",
  causation_id: null,
  correlation_id: OUTBOX_EVENT_ID,
  event_id: OUTBOX_EVENT_ID,
  event_type: "organization.created",
  organization_id: ORGANIZATION_ID,
  schema_version: "1",
});

const envelope = createPrivateQueueEnvelopeV1({
  aggregateId: ORGANIZATION_ID,
  aggregateType: "organization",
  causationId: null,
  correlationId: OUTBOX_EVENT_ID,
  eventSchemaVersion: "1",
  eventType: "organization.created",
  organizationId: ORGANIZATION_ID,
  outboxEventId: OUTBOX_EVENT_ID,
});

const job = (retryCount = 0): QueueWorkItem =>
  Object.freeze({
    createdOn: new Date(NOW.getTime() - 1_000),
    data: envelope,
    id: OUTBOX_EVENT_ID,
    queue: "maintenance",
    retryCount,
    retryLimit: 4,
  });

const createStatefulReliability = () => {
  let state: WorkerExecutionFinishState | "absent" | "in_progress" = "absent";
  const acquireExecution = vi.fn(() => {
    if (state === "succeeded") return Promise.resolve({ state: "known_success" as const });
    if (state === "permanent_failure") {
      return Promise.resolve({ state: "known_permanent_failure" as const });
    }
    if (state === "reconciliation_required") {
      return Promise.resolve({ state: "reconciliation_required" as const });
    }
    state = "in_progress";
    return Promise.resolve({ leaseToken: LEASE_TOKEN, state: "acquired" as const });
  });
  const finishExecution = vi.fn(
    (input: WorkerExecutionIdentityInput & { state: WorkerExecutionFinishState }) => {
      state = input.state;
      return Promise.resolve(true);
    },
  );
  const resolveReconciliation = vi.fn(
    (input: WorkerExecutionIdentityInput & { resolution: string }) => {
      state = input.resolution === "succeeded" ? "succeeded" : "reconciliation_required";
      return Promise.resolve(true);
    },
  );
  const port: WorkerReliabilityPersistencePort = {
    acquireExecution,
    finishExecution,
    prepareRetry: () => Promise.resolve(true),
    resolveReconciliation,
    resumeAfterReconciliation: () => {
      state = "in_progress";
      return Promise.resolve(LEASE_TOKEN);
    },
  };
  return { acquireExecution, finishExecution, port, resolveReconciliation };
};

const executorWith = (
  handler: WorkerEventHandler,
  reliability: WorkerReliabilityPersistencePort,
  reconcile?: () => Promise<
    | { state: "not_executed" }
    | { state: "succeeded" }
    | { state: "permanent_failure" }
    | { state: "unresolved" }
  >,
) =>
  createWorkerJobExecutor({
    clock: { now: () => NOW },
    random: () => 0,
    registry: createWorkerHandlerRegistry([
      {
        eventType: "organization.created",
        handler,
        handlerVersion: "v1",
        queue: "maintenance",
        ...(reconcile === undefined ? {} : { reconcile }),
        schemaVersion: "1",
      },
    ]),
    reliability,
    tenantEvents: { loadCanonicalEvent: () => Promise.resolve(event) },
  });

describe("S8.5 handler reliability wrapper", () => {
  it("turns exact success replay into a durable no-op with one logical effect", async () => {
    const memory = createStatefulReliability();
    const handler = vi.fn<WorkerEventHandler>(() => Promise.resolve());
    const executor = executorWith(handler, memory.port);
    await expect(executor.execute(job())).resolves.toEqual({ status: "completed" });
    await expect(executor.execute(job(1))).resolves.toEqual({ status: "completed" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(memory.acquireExecution).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[0].identity).toMatchObject({
      idempotencyKey: `v1:${OUTBOX_EVENT_ID}`,
      providerIdempotencyKey: OUTBOX_EVENT_ID,
    });
  });

  it("reconciles known provider success after an ambiguous crash window", async () => {
    const memory = createStatefulReliability();
    const handler = vi.fn<WorkerEventHandler>(() =>
      Promise.reject(new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT")),
    );
    const reconcile = vi.fn(() => Promise.resolve({ state: "succeeded" as const }));
    const executor = executorWith(handler, memory.port, reconcile);
    await expect(executor.execute(job())).resolves.toEqual({
      category: "AMBIGUOUS_EXTERNAL_EFFECT",
      status: "failed",
    });
    await expect(executor.execute(job(1))).resolves.toEqual({ status: "completed" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(memory.resolveReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: "succeeded" }),
    );
  });

  it("quarantines unresolved ambiguity without a blind second effect", async () => {
    const memory = createStatefulReliability();
    const handler = vi.fn<WorkerEventHandler>(() =>
      Promise.reject(new Error("provider acknowledgement lost")),
    );
    const executor = executorWith(handler, memory.port, () =>
      Promise.resolve({ state: "unresolved" }),
    );
    await executor.execute(job());
    await expect(executor.execute(job(1))).resolves.toEqual({
      category: "AMBIGUOUS_EXTERNAL_EFFECT",
      status: "deadletter",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fails a malformed reconciliation result closed without another effect", async () => {
    const memory = createStatefulReliability();
    const handler = vi.fn<WorkerEventHandler>(() =>
      Promise.reject(new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT")),
    );
    const executor = executorWith(handler, memory.port, () =>
      Promise.resolve({ state: "forged" } as never),
    );
    await executor.execute(job());
    await expect(executor.execute(job(1))).resolves.toEqual({
      category: "PERMANENT_VALIDATION",
      status: "deadletter",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(memory.resolveReconciliation).not.toHaveBeenCalled();
  });

  it("fails a same-identity provenance collision closed before the effect", async () => {
    const memory = createStatefulReliability();
    const collisionPort: WorkerReliabilityPersistencePort = {
      ...memory.port,
      acquireExecution: () => Promise.resolve({ state: "collision" }),
    };
    const handler = vi.fn<WorkerEventHandler>(() => Promise.resolve());
    await expect(executorWith(handler, collisionPort).execute(job())).resolves.toEqual({
      category: "TENANT_INTEGRITY",
      status: "deadletter",
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
