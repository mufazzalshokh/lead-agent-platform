import { describe, expect, it, vi } from "vitest";

import {
  createWorkerHandlerRegistry,
  type WorkerHandlerRegistration,
} from "../../apps/worker/src/handler-registry.js";
import type { WorkerReliabilityPersistencePort } from "../../apps/worker/src/handler-reliability.js";
import type {
  CanonicalDispatchEvent,
  OutboxDispatcher,
} from "../../apps/worker/src/outbox-dispatcher.js";
import type {
  QueueInfrastructure,
  QueueWorkRegistration,
} from "../../apps/worker/src/queue-infrastructure.js";
import {
  WORKER_SHUTDOWN_DRAIN_MILLISECONDS,
  createWorkerRuntime,
} from "../../apps/worker/src/worker-runtime.js";
import {
  WORKER_PROCESS_HARD_SHUTDOWN_MILLISECONDS,
  createWorkerShutdownCoordinator,
} from "../../apps/worker/src/worker-signals.js";
import {
  createSafeWorkerTelemetry,
  type WorkerLogRecord,
  type WorkerMetricRecord,
} from "../../apps/worker/src/worker-telemetry.js";

const ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-000000000001";
const OUTBOX_EVENT_ID = "0193f1a8-7f65-7c28-a434-000000000003";
const CORRELATION_ID = "0193f1a8-7f65-7c28-a434-000000000004";

const registration: WorkerHandlerRegistration = {
  eventType: "organization.created",
  handler: () => Promise.resolve(),
  handlerVersion: "v1",
  queue: "maintenance",
  schemaVersion: "1",
};

const canonicalEvent: CanonicalDispatchEvent = Object.freeze({
  aggregate_id: ORGANIZATION_ID,
  aggregate_type: "organization",
  causation_id: null,
  correlation_id: CORRELATION_ID,
  event_id: OUTBOX_EVENT_ID,
  event_type: "organization.created",
  organization_id: ORGANIZATION_ID,
  schema_version: "1",
});

const reliability = (): WorkerReliabilityPersistencePort => ({
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

const emptyDispatchResult = Object.freeze({
  claimed: 0,
  deadLettered: 0,
  deferred: 0,
  enqueued: 0,
  published: 0,
  reconciled: 0,
  retryReleased: 0,
});

const createRuntimeFixture = (
  input: {
    dispatcher?: OutboxDispatcher;
    drainWaiter?: (
      pending: readonly Promise<void>[],
      timeoutMilliseconds: number,
    ) => Promise<"drained" | "timed_out">;
    stopWorker?: (registration: QueueWorkRegistration) => Promise<void>;
  } = {},
) => {
  const order: string[] = [];
  const metrics: WorkerMetricRecord[] = [];
  const logs: WorkerLogRecord[] = [];
  const stopOptions: unknown[] = [];
  const telemetry = createSafeWorkerTelemetry({
    flush: () => {
      order.push("telemetry.flush");
      return Promise.resolve();
    },
    log: (record) => logs.push(record),
    metric: (record) => metrics.push(record),
    startSpan: () => ({ end: () => undefined }),
  });
  const queue: QueueInfrastructure = {
    ...reliability(),
    enqueueDurably: () => Promise.resolve(null),
    inspectExistingJobForReconciliation: () => Promise.resolve([]),
    registerWorker: (queueName) =>
      Promise.resolve(Object.freeze({ id: `worker-${queueName}`, queue: queueName })),
    start: () => {
      order.push("queue.start");
      return Promise.resolve();
    },
    stop: (options) => {
      order.push("queue.stop");
      stopOptions.push(options);
      return Promise.resolve();
    },
    stopWorker: (worker) => {
      order.push("queue.stopWorker");
      return input.stopWorker?.(worker) ?? Promise.resolve();
    },
  };
  const dispatcher =
    input.dispatcher ??
    ({ dispatchOnce: () => Promise.resolve(emptyDispatchResult) } satisfies OutboxDispatcher);
  const runtime = createWorkerRuntime({
    closeTenantRuntime: () => {
      order.push("tenant.close");
      return Promise.resolve();
    },
    dispatcher,
    ...(input.drainWaiter === undefined ? {} : { drainWaiter: input.drainWaiter }),
    observability: { onDispatcherError: vi.fn() },
    queue,
    registry: createWorkerHandlerRegistry([registration]),
    sleeper: (_milliseconds, signal) =>
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    telemetry,
    tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalEvent) },
    tenantRuntime: { verifyReady: () => Promise.resolve() },
  });
  return { logs, metrics, order, runtime, stopOptions };
};

describe("S8.6 bounded worker shutdown", () => {
  it("drops readiness immediately, drains active work, flushes telemetry, and closes resources", async () => {
    let releaseActiveWork: (() => void) | undefined;
    const fixture = createRuntimeFixture({
      stopWorker: () =>
        new Promise<void>((resolve) => {
          releaseActiveWork = resolve;
        }),
    });

    expect(fixture.runtime.liveness()).toEqual({ live: true });
    expect(fixture.runtime.readiness()).toMatchObject({ ready: false, state: "created" });
    await fixture.runtime.start();
    expect(fixture.runtime.readiness()).toMatchObject({ ready: true, state: "ready" });

    const stopping = fixture.runtime.stop();
    expect(fixture.runtime.readiness()).toMatchObject({ ready: false, state: "stopping" });
    expect(fixture.order).toContain("queue.stopWorker");
    expect(fixture.order).not.toContain("queue.stop");
    releaseActiveWork?.();
    await stopping;

    expect(fixture.runtime.readiness()).toMatchObject({ ready: false, state: "stopped" });
    expect(fixture.runtime.liveness()).toEqual({ live: true });
    expect(fixture.order.indexOf("telemetry.flush")).toBeLessThan(
      fixture.order.indexOf("queue.stop"),
    );
    expect(fixture.order.indexOf("queue.stop")).toBeLessThan(fixture.order.indexOf("tenant.close"));
    expect(fixture.stopOptions).toEqual([
      { recoveryTimeoutMilliseconds: 1_000, unfinishedWork: "fail_for_retry" },
    ]);
    expect(
      fixture.metrics
        .filter(({ name }) => name === "worker.readiness")
        .map(({ labels, value }) => ({ state: labels.state, value })),
    ).toEqual([
      { state: "starting", value: 0 },
      { state: "ready", value: 1 },
      { state: "stopping", value: 0 },
      { state: "stopped", value: 0 },
    ]);
  });

  it("bounds the drain at 25 seconds and leaves unfinished pg-boss work recoverable", async () => {
    const drainWaiter = vi.fn(() => Promise.resolve("timed_out" as const));
    const fixture = createRuntimeFixture({
      drainWaiter,
      stopWorker: () => new Promise<void>(() => undefined),
    });
    await fixture.runtime.start();
    await fixture.runtime.stop();

    expect(drainWaiter).toHaveBeenCalledWith(expect.any(Array), WORKER_SHUTDOWN_DRAIN_MILLISECONDS);
    expect(fixture.stopOptions).toEqual([
      { recoveryTimeoutMilliseconds: 1_000, unfinishedWork: "fail_for_retry" },
    ]);
    expect(fixture.metrics).toContainEqual({
      labels: { outcome: "timed_out" },
      name: "worker.shutdown.drain_timeout_total",
      value: 1,
    });
    expect(fixture.logs).toContainEqual({
      attributes: {},
      event: "worker.shutdown.drain_timed_out",
      severity: "warn",
    });
  });

  it("does not overlap dispatcher cycles and stops a cycle through its abort signal", async () => {
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const dispatchOnce = vi.fn((_routes, signal?: AbortSignal) => {
      observedSignal = signal;
      active += 1;
      maximum = Math.max(maximum, active);
      return new Promise<typeof emptyDispatchResult>((resolve) => {
        release = () => {
          active -= 1;
          resolve(emptyDispatchResult);
        };
      });
    });
    const fixture = createRuntimeFixture({ dispatcher: { dispatchOnce } });
    await fixture.runtime.start();
    await Promise.resolve();
    expect(dispatchOnce).toHaveBeenCalledTimes(1);

    const stopping = fixture.runtime.stop();
    expect(observedSignal?.aborted).toBe(true);
    expect(dispatchOnce).toHaveBeenCalledTimes(1);
    release?.();
    await stopping;
    expect(maximum).toBe(1);
  });

  it("routes SIGTERM, SIGINT, and repeated requests through one cleanup promise", async () => {
    let releaseStop: (() => void) | undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        }),
    );
    const scheduled: ReturnType<typeof setTimeout>[] = [];
    const cancelled: ReturnType<typeof setTimeout>[] = [];
    const coordinator = createWorkerShutdownCoordinator({
      cancelDeadline: (handle) => {
        cancelled.push(handle);
        clearTimeout(handle);
      },
      runtime: { stop },
      scheduleDeadline: (callback, milliseconds) => {
        const handle = setTimeout(callback, milliseconds);
        handle.unref();
        scheduled.push(handle);
        return handle;
      },
    });

    const term = coordinator.request("SIGTERM");
    const interrupt = coordinator.request("SIGINT");
    expect(term).toBe(interrupt);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    releaseStop?.();
    await term;
    expect(cancelled).toEqual(scheduled);
  });

  it("enforces a process deadline inside the deployment grace period", async () => {
    let deadlineCallback: (() => void) | undefined;
    let releaseStop: (() => void) | undefined;
    const forceExit = vi.fn();
    const coordinator = createWorkerShutdownCoordinator({
      forceExit,
      runtime: {
        stop: () =>
          new Promise<void>((resolve) => {
            releaseStop = resolve;
          }),
      },
      scheduleDeadline: (callback, milliseconds) => {
        expect(milliseconds).toBe(WORKER_PROCESS_HARD_SHUTDOWN_MILLISECONDS);
        deadlineCallback = callback;
        const handle = setTimeout(() => undefined, milliseconds);
        handle.unref();
        return handle;
      },
    });

    const stopping = coordinator.request("SIGTERM");
    deadlineCallback?.();
    expect(forceExit).toHaveBeenCalledWith(1);
    releaseStop?.();
    await stopping;
  });
});
