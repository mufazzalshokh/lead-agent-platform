import { describe, expect, it, vi } from "vitest";

import { createActiveEventRoutes } from "../../apps/worker/src/event-routing.js";
import { createPrivateQueueEnvelopeV1 } from "../../apps/worker/src/queue-envelope.js";
import {
  createObservedQueueWorkHandler,
  type QueueWorkItem,
} from "../../apps/worker/src/queue-infrastructure.js";
import { QUEUE_NAMES } from "../../apps/worker/src/queue-names.js";
import { collectWorkerOperationalMetrics } from "../../apps/worker/src/worker-operations.js";
import {
  createSafeWorkerTelemetry,
  type WorkerLogRecord,
  type WorkerMetricRecord,
  type WorkerSpanEnd,
  type WorkerSpanStart,
  type WorkerTelemetry,
} from "../../apps/worker/src/worker-telemetry.js";

const ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-000000000001";
const OUTBOX_EVENT_ID = "0193f1a8-7f65-7c28-a434-000000000003";
const CORRELATION_ID = "0193f1a8-7f65-7c28-a434-000000000004";
const CAUSATION_ID = "0193f1a8-7f65-7c28-a434-000000000005";

const createRecorder = () => {
  const metrics: WorkerMetricRecord[] = [];
  const logs: WorkerLogRecord[] = [];
  const spanStarts: WorkerSpanStart[] = [];
  const spanEnds: WorkerSpanEnd[] = [];
  const flush = vi.fn(() => Promise.resolve());
  const telemetry: WorkerTelemetry = createSafeWorkerTelemetry({
    flush,
    log: (record) => logs.push(record),
    metric: (record) => metrics.push(record),
    startSpan: (record) => {
      spanStarts.push(record);
      return { end: (result) => spanEnds.push(result) };
    },
  });
  return { flush, logs, metrics, spanEnds, spanStarts, telemetry };
};

const workItem = (queue: "analytics" | "maintenance" = "maintenance"): QueueWorkItem =>
  Object.freeze({
    createdOn: new Date("2026-09-14T00:00:00.000Z"),
    data: createPrivateQueueEnvelopeV1({
      aggregateId: ORGANIZATION_ID,
      aggregateType: "organization",
      causationId: CAUSATION_ID,
      correlationId: CORRELATION_ID,
      eventSchemaVersion: "1",
      eventType: "organization.created",
      organizationId: ORGANIZATION_ID,
      outboxEventId: OUTBOX_EVENT_ID,
    }),
    id: OUTBOX_EVENT_ID,
    queue,
    retryCount: 0,
    retryLimit: 4,
    signal: new AbortController().signal,
  });

describe("S8.6 worker operational telemetry", () => {
  it("distinguishes dispatchable and inactive backlog and reports every finite queue", async () => {
    const recorder = createRecorder();
    const depths = QUEUE_NAMES.map((queue, index) =>
      Object.freeze({
        activeCount: queue === "maintenance" ? 1 : 0,
        queue,
        readyCount: index + 1,
      }),
    );

    await collectWorkerOperationalMetrics({
      activeQueues: ["maintenance"],
      activeRoutes: createActiveEventRoutes([
        { eventType: "organization.created", schemaVersion: "1" },
      ]),
      outbox: {
        observeOutboxBacklog: () =>
          Promise.resolve({
            dispatchablePendingCount: 7,
            inactivePendingCount: 4,
            oldestDispatchableAgeMilliseconds: 12_345,
            pendingCount: 11,
          }),
      },
      queue: { observeQueueDepths: () => Promise.resolve(depths) },
      telemetry: recorder.telemetry,
    });

    expect(recorder.metrics).toEqual(
      expect.arrayContaining([
        { labels: {}, name: "worker.outbox.pending", value: 11 },
        { labels: {}, name: "worker.outbox.dispatchable_pending", value: 7 },
        { labels: {}, name: "worker.outbox.inactive_pending", value: 4 },
        { labels: {}, name: "worker.outbox.oldest_dispatchable_age_ms", value: 12_345 },
      ]),
    );
    expect(recorder.metrics.filter(({ name }) => name === "worker.queue.ready")).toHaveLength(6);
    expect(
      recorder.metrics.find(
        ({ labels, name }) =>
          name === "worker.workload.saturation" && labels.queue === "maintenance",
      ),
    ).toMatchObject({ value: 1 });
    expect(
      recorder.metrics.find(
        ({ labels, name }) => name === "worker.queue.ready" && labels.queue === "analytics",
      ),
    ).toMatchObject({ value: 5 });
  });

  it("isolates invalid or failed probes without aborting the other observation", async () => {
    const recorder = createRecorder();
    await collectWorkerOperationalMetrics({
      activeQueues: [],
      activeRoutes: [],
      outbox: { observeOutboxBacklog: () => Promise.reject(new Error("synthetic secret")) },
      queue: {
        observeQueueDepths: () =>
          Promise.resolve(QUEUE_NAMES.map((queue) => ({ activeCount: 0, queue, readyCount: 0 }))),
      },
      telemetry: recorder.telemetry,
    });

    expect(recorder.logs).toContainEqual({
      attributes: {},
      event: "worker.operations.probe_failed",
      severity: "warn",
    });
    expect(recorder.metrics.filter(({ name }) => name === "worker.queue.ready")).toHaveLength(6);
    expect(JSON.stringify(recorder)).not.toContain("synthetic secret");
  });

  it("emits safe job outcomes, handler latency, and asynchronous correlation links", async () => {
    const recorder = createRecorder();
    const times = [1_000, 1_025];
    const observed = createObservedQueueWorkHandler({
      clock: { now: () => new Date(times.shift() ?? 1_025) },
      handler: () => Promise.resolve({ status: "completed" }),
      queue: "maintenance",
      telemetry: recorder.telemetry,
    });

    await expect(observed(workItem())).resolves.toEqual({ status: "completed" });
    expect(recorder.metrics).toEqual(
      expect.arrayContaining([
        {
          labels: { outcome: "completed", queue: "maintenance" },
          name: "worker.job.completed_total",
          value: 1,
        },
        {
          labels: { outcome: "completed", queue: "maintenance" },
          name: "worker.handler.latency_ms",
          value: 25,
        },
      ]),
    );
    expect(recorder.spanStarts).toEqual([
      expect.objectContaining({
        links: [{ causationId: CAUSATION_ID, correlationId: CORRELATION_ID }],
        name: "worker.handler.execute",
      }),
    ]);
    expect(recorder.spanEnds).toEqual([{ durationMilliseconds: 25, outcome: "completed" }]);
  });

  it("does not expose handler errors or payload-shaped data in telemetry", async () => {
    const recorder = createRecorder();
    const secret = "customer-message-and-provider-response-must-not-appear";
    const observed = createObservedQueueWorkHandler({
      handler: () => Promise.reject(new Error(secret)),
      queue: "maintenance",
      telemetry: recorder.telemetry,
    });

    await expect(observed(workItem())).rejects.toThrowError(secret);
    const serializedTelemetry = JSON.stringify({
      logs: recorder.logs,
      metrics: recorder.metrics,
      spans: recorder.spanStarts,
    });
    expect(serializedTelemetry).not.toContain(secret);
    expect(serializedTelemetry).not.toContain("payload");
    expect(serializedTelemetry).toContain(OUTBOX_EVENT_ID);
    expect(serializedTelemetry).not.toContain("leaseToken");
  });

  it("runtime-sanitizes telemetry records to the finite safe attribute allowlist", () => {
    const recorder = createRecorder();
    const secret = "raw-customer-payload";
    const attributes = {
      correlationId: CORRELATION_ID,
      customerText: secret,
      leaseToken: secret,
    };
    const unsafeRecord = {
      attributes,
      event: "worker.dispatch.failed" as const,
      payload: secret,
      severity: "warn" as const,
    };

    recorder.telemetry.log(unsafeRecord);
    expect(recorder.logs).toEqual([
      {
        attributes: { correlationId: CORRELATION_ID },
        event: "worker.dispatch.failed",
        severity: "warn",
      },
    ]);
    expect(JSON.stringify(recorder.logs)).not.toContain(secret);
    expect(JSON.stringify(recorder.logs)).not.toContain("leaseToken");
  });

  it("counts retry, failure, and DLQ dispositions without changing them", async () => {
    const recorder = createRecorder();
    const retry = createObservedQueueWorkHandler({
      handler: () => Promise.resolve({ category: "RETRYABLE_INFRASTRUCTURE", status: "failed" }),
      queue: "maintenance",
      telemetry: recorder.telemetry,
    });
    const deadletter = createObservedQueueWorkHandler({
      handler: () => Promise.resolve({ category: "PERMANENT_BUSINESS", status: "deadletter" }),
      queue: "maintenance",
      telemetry: recorder.telemetry,
    });

    await expect(retry(workItem())).resolves.toEqual({
      category: "RETRYABLE_INFRASTRUCTURE",
      status: "failed",
    });
    await expect(deadletter(workItem())).resolves.toEqual({
      category: "PERMANENT_BUSINESS",
      status: "deadletter",
    });
    expect(recorder.metrics.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "worker.job.retry_total",
        "worker.job.failed_total",
        "worker.job.dlq_total",
      ]),
    );
  });

  it("allows an unrelated queue to complete while another queue is saturated", async () => {
    const recorder = createRecorder();
    let releaseMaintenance: (() => void) | undefined;
    const maintenance = createObservedQueueWorkHandler({
      handler: () =>
        new Promise((resolve) => {
          releaseMaintenance = () => resolve({ status: "completed" });
        }),
      queue: "maintenance",
      telemetry: recorder.telemetry,
    });
    const analytics = createObservedQueueWorkHandler({
      handler: () => Promise.resolve({ status: "completed" }),
      queue: "analytics",
      telemetry: recorder.telemetry,
    });

    const blocked = maintenance(workItem());
    await Promise.resolve();
    await expect(analytics(workItem("analytics"))).resolves.toEqual({ status: "completed" });
    releaseMaintenance?.();
    await expect(blocked).resolves.toEqual({ status: "completed" });
  });

  it("keeps business processing successful when every telemetry export hook fails", async () => {
    const telemetry: WorkerTelemetry = {
      flush: () => Promise.reject(new Error("synthetic")),
      log: () => {
        throw new Error("synthetic");
      },
      metric: () => {
        throw new Error("synthetic");
      },
      startSpan: () => {
        throw new Error("synthetic");
      },
    };
    const observed = createObservedQueueWorkHandler({
      handler: () => Promise.resolve({ status: "completed" }),
      queue: "maintenance",
      telemetry,
    });

    await expect(observed(workItem())).resolves.toEqual({ status: "completed" });
  });
});
