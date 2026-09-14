import { describe, expect, it, vi } from "vitest";

import {
  PRODUCTION_HANDLER_REGISTRY,
  createWorkerHandlerRegistry,
  type WorkerEventHandler,
  type WorkerHandlerRegistration,
} from "../../apps/worker/src/handler-registry.js";
import { createWorkerJobExecutor } from "../../apps/worker/src/job-executor.js";
import type {
  CanonicalDispatchEvent,
  OutboxDispatcher,
} from "../../apps/worker/src/outbox-dispatcher.js";
import { createPrivateQueueEnvelopeV1 } from "../../apps/worker/src/queue-envelope.js";
import type {
  QueueInfrastructure,
  QueueName,
  QueueWorkHandler,
  QueueWorkItem,
  QueueWorkRegistration,
} from "../../apps/worker/src/queue-infrastructure.js";
import type { WorkerReliabilityPersistencePort } from "../../apps/worker/src/handler-reliability.js";
import {
  WORKER_DISPATCH_POLL_MILLISECONDS,
  createWorkerRuntime,
} from "../../apps/worker/src/worker-runtime.js";

const ORGANIZATION_A = "0193f1a8-7f65-7c28-a434-000000000001";
const ORGANIZATION_B = "0193f1a8-7f65-7c28-a434-000000000002";
const OUTBOX_EVENT_ID = "0193f1a8-7f65-7c28-a434-000000000003";
const CORRELATION_ID = "0193f1a8-7f65-7c28-a434-000000000004";

const handler = vi.fn<WorkerEventHandler>(() => Promise.resolve());

const registration = (
  eventType: WorkerHandlerRegistration["eventType"] = "organization.created",
  schemaVersion = "1",
  queue: QueueName = "maintenance",
  registeredHandler: WorkerEventHandler = handler,
): WorkerHandlerRegistration => ({
  eventType,
  handler: registeredHandler,
  handlerVersion: "v1",
  queue,
  schemaVersion,
});

const canonicalEvent = (overrides: Partial<CanonicalDispatchEvent> = {}): CanonicalDispatchEvent =>
  Object.freeze({
    aggregate_id: ORGANIZATION_A,
    aggregate_type: "organization",
    causation_id: null,
    correlation_id: CORRELATION_ID,
    event_id: OUTBOX_EVENT_ID,
    event_type: "organization.created",
    organization_id: ORGANIZATION_A,
    schema_version: "1",
    ...overrides,
  });

const envelope = (overrides: { organizationId?: string } = {}) =>
  createPrivateQueueEnvelopeV1({
    aggregateId: ORGANIZATION_A,
    aggregateType: "organization",
    causationId: null,
    correlationId: CORRELATION_ID,
    eventSchemaVersion: "1",
    eventType: "organization.created",
    organizationId: overrides.organizationId ?? ORGANIZATION_A,
    outboxEventId: OUTBOX_EVENT_ID,
  });

const queueJob = (data: unknown = envelope(), queue: QueueName = "maintenance"): QueueWorkItem =>
  Object.freeze({
    createdOn: new Date("2026-09-14T00:00:00.000Z"),
    data,
    id: OUTBOX_EVENT_ID,
    queue,
    retryCount: 1,
    retryLimit: 4,
  });

const createMemoryReliability = (): WorkerReliabilityPersistencePort => ({
  acquireExecution: () =>
    Promise.resolve({
      leaseToken: "123e4567-e89b-42d3-a456-426614174000",
      state: "acquired",
    }),
  finishExecution: () => Promise.resolve(true),
  prepareRetry: () => Promise.resolve(true),
  resolveReconciliation: () => Promise.resolve(true),
  resumeAfterReconciliation: () => Promise.resolve("123e4567-e89b-42d3-a456-426614174000"),
});

const createMemoryQueue = (failureQueue?: QueueName) => {
  const handlers = new Map<QueueName, QueueWorkHandler>();
  const started: string[] = [];
  const stopped: string[] = [];
  const stoppedWorkers: QueueWorkRegistration[] = [];
  const queue: QueueInfrastructure = {
    ...createMemoryReliability(),
    enqueueDurably: () => Promise.resolve(null),
    inspectExistingJobForReconciliation: () => Promise.resolve([]),
    registerWorker: (queueName, registeredHandler) => {
      if (queueName === failureQueue) return Promise.reject(new Error("synthetic registration"));
      handlers.set(queueName, registeredHandler);
      return Promise.resolve(Object.freeze({ id: `worker-${queueName}`, queue: queueName }));
    },
    start: () => {
      started.push("start");
      return Promise.resolve();
    },
    stop: () => {
      stopped.push("stop");
      return Promise.resolve();
    },
    stopWorker: (worker) => {
      stoppedWorkers.push(worker);
      handlers.delete(worker.queue);
      return Promise.resolve();
    },
  };
  return { handlers, queue, started, stopped, stoppedWorkers };
};

const neverClaimingDispatcher = (): OutboxDispatcher => ({
  dispatchOnce: () =>
    Promise.resolve({
      claimed: 0,
      deadLettered: 0,
      deferred: 0,
      enqueued: 0,
      published: 0,
      reconciled: 0,
      retryReleased: 0,
    }),
});

describe("S8.4 finite worker handler registry", () => {
  it("keeps the production registry honestly empty and deeply frozen", () => {
    expect(PRODUCTION_HANDLER_REGISTRY.registrations).toEqual([]);
    expect(PRODUCTION_HANDLER_REGISTRY.activeRoutes).toEqual([]);
    expect(PRODUCTION_HANDLER_REGISTRY.activeQueues).toEqual([]);
    expect(Object.isFrozen(PRODUCTION_HANDLER_REGISTRY)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_HANDLER_REGISTRY.registrations)).toBe(true);
  });

  it("derives exact routes and one active queue from immutable registrations", () => {
    const registry = createWorkerHandlerRegistry([
      registration("organization.created"),
      registration("organization.status_changed"),
    ]);
    expect(registry.activeRoutes).toEqual([
      { eventType: "organization.created", schemaVersion: "1" },
      { eventType: "organization.status_changed", schemaVersion: "1" },
    ]);
    expect(registry.activeQueues).toEqual(["maintenance"]);
    expect(registry.resolve("organization.created", "1")?.handlerVersion).toBe("v1");
    expect(registry.resolve("organization.created", "2")).toBeUndefined();
    expect(Object.isFrozen(registry.registrations[0])).toBe(true);
  });

  it("registers lead.reopened V1 and V2 as independent exact handlers", () => {
    const v1 = vi.fn<WorkerEventHandler>(() => Promise.resolve());
    const v2 = vi.fn<WorkerEventHandler>(() => Promise.resolve());
    const registry = createWorkerHandlerRegistry([
      registration("lead.reopened", "1", "analytics", v1),
      registration("lead.reopened", "2", "analytics", v2),
    ]);
    expect(registry.activeRoutes).toEqual([
      { eventType: "lead.reopened", schemaVersion: "1" },
      { eventType: "lead.reopened", schemaVersion: "2" },
    ]);
    expect(registry.resolve("lead.reopened", "1")?.handler).toBe(v1);
    expect(registry.resolve("lead.reopened", "2")?.handler).toBe(v2);
  });

  it.each([
    {
      name: "duplicate exact identity",
      value: [registration(), registration()],
    },
    {
      name: "unknown event",
      value: [{ ...registration(), eventType: "unknown.event" }],
    },
    {
      name: "unsupported schema version",
      value: [{ ...registration(), schemaVersion: "2" }],
    },
    {
      name: "wrong queue ownership",
      value: [{ ...registration(), queue: "analytics" }],
    },
    {
      name: "invalid handler version",
      value: [{ ...registration(), handlerVersion: "latest" }],
    },
    {
      name: "extra registration field",
      value: [{ ...registration(), enabled: true }],
    },
  ])("rejects $name at construction", ({ value }) => {
    expect(() => createWorkerHandlerRegistry(value)).toThrowError(
      "Worker handler registry validation failed",
    );
  });
});

describe("S8.4 fail-closed queue job execution", () => {
  it("reloads the canonical tenant event before invoking a narrow trusted handler context", async () => {
    const registeredHandler = vi.fn<WorkerEventHandler>(() => Promise.resolve());
    const loadCanonicalEvent = vi.fn(() => Promise.resolve(canonicalEvent()));
    const executor = createWorkerJobExecutor({
      clock: { now: () => new Date("2026-09-14T00:00:01.000Z") },
      registry: createWorkerHandlerRegistry([
        registration(undefined, "1", "maintenance", registeredHandler),
      ]),
      reliability: createMemoryReliability(),
      tenantEvents: { loadCanonicalEvent },
    });
    await executor.execute(queueJob());
    expect(loadCanonicalEvent).toHaveBeenCalledWith(ORGANIZATION_A, OUTBOX_EVENT_ID);
    expect(registeredHandler).toHaveBeenCalledTimes(1);
    const context = registeredHandler.mock.calls[0]?.[0];
    expect(context).toMatchObject({
      attempt: { attemptNumber: 2, jobId: OUTBOX_EVENT_ID, retryLimit: 4 },
      causationId: null,
      correlationId: CORRELATION_ID,
      identity: {
        handlerVersion: "v1",
        idempotencyKey: `v1:${OUTBOX_EVENT_ID}`,
        outboxEventId: OUTBOX_EVENT_ID,
      },
      organizationId: ORGANIZATION_A,
      outboxEventId: OUTBOX_EVENT_ID,
      tenant: { organizationId: ORGANIZATION_A },
    });
    expect(context).not.toHaveProperty("database");
    expect(context).not.toHaveProperty("job");
    expect(context).not.toHaveProperty("leaseToken");
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("rejects an invalid envelope before registry lookup or tenant reload", async () => {
    const loadCanonicalEvent = vi.fn();
    const executor = createWorkerJobExecutor({
      registry: createWorkerHandlerRegistry([registration()]),
      reliability: createMemoryReliability(),
      tenantEvents: { loadCanonicalEvent },
    });
    await expect(executor.execute(queueJob({ malformed: true }))).resolves.toEqual({
      category: "PERMANENT_VALIDATION",
      status: "deadletter",
    });
    expect(loadCanonicalEvent).not.toHaveBeenCalled();
  });

  it("rejects a queue/event mismatch before tenant reload", async () => {
    const loadCanonicalEvent = vi.fn();
    const executor = createWorkerJobExecutor({
      registry: createWorkerHandlerRegistry([registration()]),
      reliability: createMemoryReliability(),
      tenantEvents: { loadCanonicalEvent },
    });
    await expect(executor.execute(queueJob(envelope(), "analytics"))).resolves.toEqual({
      category: "TENANT_INTEGRITY",
      status: "deadletter",
    });
    expect(loadCanonicalEvent).not.toHaveBeenCalled();
  });

  it("fails a stale queued job whose exact handler is absent", async () => {
    const loadCanonicalEvent = vi.fn();
    const executor = createWorkerJobExecutor({
      registry: PRODUCTION_HANDLER_REGISTRY,
      reliability: createMemoryReliability(),
      tenantEvents: { loadCanonicalEvent },
    });
    await expect(executor.execute(queueJob())).resolves.toEqual({
      category: "UNSUPPORTED_VERSION",
      status: "deadletter",
    });
    expect(loadCanonicalEvent).not.toHaveBeenCalled();
  });

  it("fails closed on canonical provenance or tenant mismatch", async () => {
    const registeredHandler = vi.fn<WorkerEventHandler>(() => Promise.resolve());
    const executor = createWorkerJobExecutor({
      registry: createWorkerHandlerRegistry([
        registration(undefined, "1", "maintenance", registeredHandler),
      ]),
      reliability: createMemoryReliability(),
      tenantEvents: {
        loadCanonicalEvent: (organizationId) =>
          Promise.resolve(
            canonicalEvent({
              organization_id: organizationId === ORGANIZATION_A ? ORGANIZATION_B : ORGANIZATION_A,
            }),
          ),
      },
    });
    await expect(executor.execute(queueJob())).resolves.toEqual({
      category: "TENANT_INTEGRITY",
      status: "deadletter",
    });
    expect(registeredHandler).not.toHaveBeenCalled();
  });

  it("propagates handler failures and exposes a stable duplicate-execution identity", async () => {
    const identities: string[] = [];
    const registeredHandler: WorkerEventHandler = (context) => {
      identities.push(context.identity.idempotencyKey);
      return Promise.reject(new Error("synthetic handler failure"));
    };
    const executor = createWorkerJobExecutor({
      registry: createWorkerHandlerRegistry([
        registration(undefined, "1", "maintenance", registeredHandler),
      ]),
      reliability: createMemoryReliability(),
      tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalEvent()) },
    });
    await expect(executor.execute(queueJob())).resolves.toEqual({
      category: "AMBIGUOUS_EXTERNAL_EFFECT",
      status: "deadletter",
    });
    await expect(executor.execute(queueJob())).resolves.toEqual({
      category: "AMBIGUOUS_EXTERNAL_EFFECT",
      status: "deadletter",
    });
    expect(identities).toEqual([`v1:${OUTBOX_EVENT_ID}`, `v1:${OUTBOX_EVENT_ID}`]);
  });

  it("uses the envelope organization as the sole tenant reload authority", async () => {
    const registeredHandler = vi.fn<WorkerEventHandler>(() => Promise.resolve());
    const loadCanonicalEvent = vi.fn(() =>
      Promise.resolve(canonicalEvent({ organization_id: ORGANIZATION_B })),
    );
    const executor = createWorkerJobExecutor({
      registry: createWorkerHandlerRegistry([
        registration(undefined, "1", "maintenance", registeredHandler),
      ]),
      reliability: createMemoryReliability(),
      tenantEvents: { loadCanonicalEvent },
    });
    await expect(
      executor.execute(queueJob(envelope({ organizationId: ORGANIZATION_B }))),
    ).resolves.toEqual({ status: "completed" });
    expect(loadCanonicalEvent).toHaveBeenCalledWith(ORGANIZATION_B, OUTBOX_EVENT_ID);
    expect(registeredHandler.mock.calls[0]?.[0].tenant.organizationId).toBe(ORGANIZATION_B);
  });
});

describe("S8.4 worker lifecycle", () => {
  it("keeps the worker entrypoint side-effect free when imported", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("../../apps/worker/src/index.js");
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    info.mockRestore();
    error.mockRestore();
  });

  it("starts an empty production registry passively with honest readiness and no consumers", async () => {
    const memory = createMemoryQueue();
    const dispatcher = neverClaimingDispatcher();
    const dispatchOnce = vi.spyOn(dispatcher, "dispatchOnce");
    const sleeps: number[] = [];
    const runtime = createWorkerRuntime({
      dispatcher,
      observability: { onDispatcherError: vi.fn() },
      queue: memory.queue,
      random: () => 0,
      registry: PRODUCTION_HANDLER_REGISTRY,
      sleeper: (milliseconds, signal) => {
        sleeps.push(milliseconds);
        return new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    });
    expect(runtime.readiness()).toEqual({
      activeHandlerCount: 0,
      activeQueueCount: 0,
      activeRouteCount: 0,
      ready: false,
      state: "created",
    });
    await runtime.start();
    await Promise.resolve();
    expect(runtime.readiness()).toMatchObject({ ready: true, state: "ready" });
    expect(memory.started).toEqual(["start"]);
    expect(memory.handlers.size).toBe(0);
    expect(dispatchOnce).toHaveBeenCalledWith([]);
    expect(sleeps).toEqual([WORKER_DISPATCH_POLL_MILLISECONDS]);
    await runtime.stop();
    expect(memory.stopped).toEqual(["stop"]);
    expect(runtime.readiness()).toMatchObject({ ready: false, state: "stopped" });
  });

  it("is deterministic when start and stop are each called twice", async () => {
    const memory = createMemoryQueue();
    const runtime = createWorkerRuntime({
      observability: { onDispatcherError: vi.fn() },
      queue: memory.queue,
      registry: PRODUCTION_HANDLER_REGISTRY,
    });
    await Promise.all([runtime.start(), runtime.start()]);
    await Promise.all([runtime.stop(), runtime.stop()]);
    expect(memory.started).toEqual(["start"]);
    expect(memory.stopped).toEqual(["stop"]);
  });

  it("shares one cleanup path when repeated stop arrives during startup", async () => {
    const memory = createMemoryQueue();
    let releaseStart: (() => void) | undefined;
    const queue: QueueInfrastructure = {
      ...memory.queue,
      start: () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve;
        }),
    };
    const runtime = createWorkerRuntime({
      observability: { onDispatcherError: vi.fn() },
      queue,
      registry: PRODUCTION_HANDLER_REGISTRY,
    });
    const starting = runtime.start();
    const firstStop = runtime.stop();
    const secondStop = runtime.stop();
    expect(firstStop).toBe(secondStop);
    releaseStart?.();
    await starting;
    await firstStop;
    expect(memory.stopped).toEqual(["stop"]);
    expect(runtime.readiness()).toMatchObject({ ready: false, state: "stopped" });
  });

  it("registers exactly one consumer for each derived active queue", async () => {
    const memory = createMemoryQueue();
    const registry = createWorkerHandlerRegistry([
      registration("organization.created"),
      registration("organization.status_changed"),
      registration("lead.created", "1", "analytics"),
    ]);
    const runtime = createWorkerRuntime({
      dispatcher: neverClaimingDispatcher(),
      observability: { onDispatcherError: vi.fn() },
      queue: memory.queue,
      registry,
      tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalEvent()) },
      tenantRuntime: { verifyReady: () => Promise.resolve() },
    });
    await runtime.start();
    expect([...memory.handlers.keys()]).toEqual(["analytics", "maintenance"]);
    expect(runtime.readiness()).toMatchObject({
      activeHandlerCount: 3,
      activeQueueCount: 2,
      activeRouteCount: 3,
      ready: true,
    });
    await runtime.stop();
    expect(memory.stoppedWorkers).toHaveLength(2);
  });

  it("cleans already-opened resources and never reports ready after startup failure", async () => {
    const memory = createMemoryQueue("maintenance");
    const closeTenantRuntime = vi.fn(() => Promise.resolve());
    const registry = createWorkerHandlerRegistry([
      registration("lead.created", "1", "analytics"),
      registration("organization.created"),
    ]);
    const runtime = createWorkerRuntime({
      closeTenantRuntime,
      dispatcher: neverClaimingDispatcher(),
      observability: { onDispatcherError: vi.fn() },
      queue: memory.queue,
      registry,
      tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalEvent()) },
      tenantRuntime: { verifyReady: () => Promise.resolve() },
    });
    await expect(runtime.start()).rejects.toThrowError("synthetic registration");
    expect(runtime.readiness()).toMatchObject({ ready: false, state: "failed" });
    expect(memory.stoppedWorkers).toEqual([{ id: "worker-analytics", queue: "analytics" }]);
    expect(memory.stopped).toEqual(["stop"]);
    expect(closeTenantRuntime).toHaveBeenCalledTimes(1);
  });

  it("fails readiness and closes the queue before registering work when tenant verification fails", async () => {
    const memory = createMemoryQueue();
    const runtime = createWorkerRuntime({
      dispatcher: neverClaimingDispatcher(),
      observability: { onDispatcherError: vi.fn() },
      queue: memory.queue,
      registry: createWorkerHandlerRegistry([registration()]),
      tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalEvent()) },
      tenantRuntime: {
        verifyReady: () => Promise.reject(new Error("synthetic tenant unavailable")),
      },
    });
    await expect(runtime.start()).rejects.toThrowError("synthetic tenant unavailable");
    expect(runtime.readiness()).toMatchObject({ ready: false, state: "failed" });
    expect(memory.handlers.size).toBe(0);
    expect(memory.stopped).toEqual(["stop"]);
  });
});
