import { isRoutedEventType } from "./event-routing.js";
import { QUEUE_NAMES, type QueueName } from "./queue-names.js";
import { WORKER_FAILURE_CATEGORIES, type WorkerFailureCategory } from "./reliability-policy.js";

export const WORKER_METRIC_NAMES = Object.freeze([
  "worker.readiness",
  "worker.outbox.pending",
  "worker.outbox.dispatchable_pending",
  "worker.outbox.inactive_pending",
  "worker.outbox.oldest_dispatchable_age_ms",
  "worker.outbox.claim_recovery_total",
  "worker.dispatch.attempt_total",
  "worker.dispatch.failure_total",
  "worker.dispatch.latency_ms",
  "worker.queue.ready",
  "worker.queue.active",
  "worker.job.completed_total",
  "worker.job.retry_total",
  "worker.job.failed_total",
  "worker.job.dlq_total",
  "worker.handler.latency_ms",
  "worker.workload.saturation",
  "worker.reconciliation.mismatch_total",
  "worker.shutdown.drain_timeout_total",
] as const);

export type WorkerMetricName = (typeof WORKER_METRIC_NAMES)[number];
export type WorkerLifecycleTelemetryState =
  "created" | "starting" | "ready" | "stopping" | "stopped" | "failed";
export type WorkerTelemetryOutcome =
  | "completed"
  | "deadletter"
  | "deferred"
  | "drained"
  | "enqueued"
  | "failed"
  | "published"
  | "reconciled"
  | "retry"
  | "retry_released"
  | "timed_out";

export type WorkerMetricLabels = Readonly<{
  failureCategory?: WorkerFailureCategory;
  outcome?: WorkerTelemetryOutcome;
  queue?: QueueName;
  state?: WorkerLifecycleTelemetryState;
}>;

export type WorkerMetricRecord = Readonly<{
  labels: WorkerMetricLabels;
  name: WorkerMetricName;
  value: number;
}>;

export type WorkerSafeTelemetryAttributes = Readonly<{
  attempt?: number;
  causationId?: string;
  correlationId?: string;
  eventType?: string;
  eventVersion?: string;
  failureCategory?: WorkerFailureCategory;
  handlerVersion?: string;
  organizationId?: string;
  outboxEventId?: string;
  physicalJobId?: string;
  queue?: QueueName;
  state?: WorkerLifecycleTelemetryState;
}>;

export type WorkerLogRecord = Readonly<{
  attributes: WorkerSafeTelemetryAttributes;
  event:
    | "worker.dispatch.failed"
    | "worker.job.failed"
    | "worker.lifecycle.changed"
    | "worker.operations.probe_failed"
    | "worker.shutdown.drain_timed_out";
  severity: "error" | "info" | "warn";
}>;

export type WorkerTraceLink = Readonly<{
  causationId?: string;
  correlationId: string;
}>;

export type WorkerSpanEnd = Readonly<{
  durationMilliseconds: number;
  failureCategory?: WorkerFailureCategory;
  outcome: WorkerTelemetryOutcome;
}>;

export type WorkerTelemetrySpan = Readonly<{
  end: (result: WorkerSpanEnd) => void;
}>;

export type WorkerSpanStart = Readonly<{
  attributes: WorkerSafeTelemetryAttributes;
  links: readonly WorkerTraceLink[];
  name: "worker.handler.execute" | "worker.outbox.dispatch";
}>;

export type WorkerTelemetrySink = Readonly<{
  flush: () => Promise<void>;
  log: (record: WorkerLogRecord) => void;
  metric: (record: WorkerMetricRecord) => void;
  startSpan: (record: WorkerSpanStart) => WorkerTelemetrySpan;
}>;

export type WorkerTelemetry = WorkerTelemetrySink;

const NOOP_SPAN: WorkerTelemetrySpan = Object.freeze({ end: () => undefined });

const WORKER_LOG_EVENTS = Object.freeze([
  "worker.dispatch.failed",
  "worker.job.failed",
  "worker.lifecycle.changed",
  "worker.operations.probe_failed",
  "worker.shutdown.drain_timed_out",
] as const);
const WORKER_LIFECYCLE_STATES = Object.freeze([
  "created",
  "starting",
  "ready",
  "stopping",
  "stopped",
  "failed",
] as const);
const WORKER_TELEMETRY_OUTCOMES = Object.freeze([
  "completed",
  "deadletter",
  "deferred",
  "drained",
  "enqueued",
  "failed",
  "published",
  "reconciled",
  "retry",
  "retry_released",
  "timed_out",
] as const);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VERSION_PATTERN = /^[1-9][0-9]{0,5}$/u;
const HANDLER_VERSION_PATTERN = /^v[1-9][0-9]{0,5}$/u;

const includes = <Value extends string>(values: readonly Value[], value: unknown): value is Value =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const sanitizeAttributes = (
  attributes: WorkerSafeTelemetryAttributes,
): WorkerSafeTelemetryAttributes =>
  Object.freeze({
    ...(Number.isSafeInteger(attributes.attempt) && (attributes.attempt ?? 0) >= 1
      ? { attempt: attributes.attempt }
      : {}),
    ...(typeof attributes.causationId === "string" && UUID_PATTERN.test(attributes.causationId)
      ? { causationId: attributes.causationId }
      : {}),
    ...(typeof attributes.correlationId === "string" && UUID_PATTERN.test(attributes.correlationId)
      ? { correlationId: attributes.correlationId }
      : {}),
    ...(typeof attributes.eventType === "string" && isRoutedEventType(attributes.eventType)
      ? { eventType: attributes.eventType }
      : {}),
    ...(typeof attributes.eventVersion === "string" && VERSION_PATTERN.test(attributes.eventVersion)
      ? { eventVersion: attributes.eventVersion }
      : {}),
    ...(includes(WORKER_FAILURE_CATEGORIES, attributes.failureCategory)
      ? { failureCategory: attributes.failureCategory }
      : {}),
    ...(typeof attributes.handlerVersion === "string" &&
    HANDLER_VERSION_PATTERN.test(attributes.handlerVersion)
      ? { handlerVersion: attributes.handlerVersion }
      : {}),
    ...(typeof attributes.organizationId === "string" &&
    UUID_PATTERN.test(attributes.organizationId)
      ? { organizationId: attributes.organizationId }
      : {}),
    ...(typeof attributes.outboxEventId === "string" && UUID_PATTERN.test(attributes.outboxEventId)
      ? { outboxEventId: attributes.outboxEventId }
      : {}),
    ...(typeof attributes.physicalJobId === "string" && UUID_PATTERN.test(attributes.physicalJobId)
      ? { physicalJobId: attributes.physicalJobId }
      : {}),
    ...(includes(QUEUE_NAMES, attributes.queue) ? { queue: attributes.queue } : {}),
    ...(includes(WORKER_LIFECYCLE_STATES, attributes.state) ? { state: attributes.state } : {}),
  });

const sanitizeLabels = (labels: WorkerMetricLabels): WorkerMetricLabels =>
  Object.freeze({
    ...(includes(WORKER_FAILURE_CATEGORIES, labels.failureCategory)
      ? { failureCategory: labels.failureCategory }
      : {}),
    ...(includes(WORKER_TELEMETRY_OUTCOMES, labels.outcome) ? { outcome: labels.outcome } : {}),
    ...(includes(QUEUE_NAMES, labels.queue) ? { queue: labels.queue } : {}),
    ...(includes(WORKER_LIFECYCLE_STATES, labels.state) ? { state: labels.state } : {}),
  });

export const NOOP_WORKER_TELEMETRY: WorkerTelemetry = Object.freeze({
  flush: () => Promise.resolve(),
  log: () => undefined,
  metric: () => undefined,
  startSpan: () => NOOP_SPAN,
});

const safeNotify = (notify: (() => void) | undefined): void => {
  try {
    notify?.();
  } catch {
    // A telemetry fallback cannot be allowed to affect business processing.
  }
};

export const createSafeWorkerTelemetry = (
  sink: WorkerTelemetrySink,
  onTelemetryFailure?: () => void,
): WorkerTelemetry =>
  Object.freeze({
    flush: async (): Promise<void> => {
      try {
        await sink.flush();
      } catch {
        safeNotify(onTelemetryFailure);
      }
    },
    log: (record): void => {
      if (
        !includes(WORKER_LOG_EVENTS, record.event) ||
        !includes(["error", "info", "warn"] as const, record.severity)
      ) {
        safeNotify(onTelemetryFailure);
        return;
      }
      try {
        sink.log(
          Object.freeze({
            attributes: sanitizeAttributes(record.attributes),
            event: record.event,
            severity: record.severity,
          }),
        );
      } catch {
        safeNotify(onTelemetryFailure);
      }
    },
    metric: (record): void => {
      if (
        !includes(WORKER_METRIC_NAMES, record.name) ||
        !Number.isFinite(record.value) ||
        record.value < 0
      ) {
        safeNotify(onTelemetryFailure);
        return;
      }
      try {
        sink.metric(
          Object.freeze({
            labels: sanitizeLabels(record.labels),
            name: record.name,
            value: record.value,
          }),
        );
      } catch {
        safeNotify(onTelemetryFailure);
      }
    },
    startSpan: (record): WorkerTelemetrySpan => {
      if (!includes(["worker.handler.execute", "worker.outbox.dispatch"] as const, record.name)) {
        safeNotify(onTelemetryFailure);
        return NOOP_SPAN;
      }
      try {
        const links = Object.freeze(
          record.links
            .slice(0, 4)
            .filter(({ correlationId }) => UUID_PATTERN.test(correlationId))
            .map(({ causationId, correlationId }) =>
              Object.freeze({
                ...(causationId !== undefined && UUID_PATTERN.test(causationId)
                  ? { causationId }
                  : {}),
                correlationId,
              }),
            ),
        );
        const span = sink.startSpan(
          Object.freeze({
            attributes: sanitizeAttributes(record.attributes),
            links,
            name: record.name,
          }),
        );
        return Object.freeze({
          end: (result): void => {
            if (
              !Number.isFinite(result.durationMilliseconds) ||
              result.durationMilliseconds < 0 ||
              !includes(WORKER_TELEMETRY_OUTCOMES, result.outcome)
            ) {
              safeNotify(onTelemetryFailure);
              return;
            }
            try {
              span.end(
                Object.freeze({
                  durationMilliseconds: result.durationMilliseconds,
                  ...(includes(WORKER_FAILURE_CATEGORIES, result.failureCategory)
                    ? { failureCategory: result.failureCategory }
                    : {}),
                  outcome: result.outcome,
                }),
              );
            } catch {
              safeNotify(onTelemetryFailure);
            }
          },
        });
      } catch {
        safeNotify(onTelemetryFailure);
        return NOOP_SPAN;
      }
    },
  });

export const createStructuredConsoleWorkerTelemetry = (
  input: {
    clock?: Readonly<{ now: () => Date }>;
    service?: string;
  } = {},
): WorkerTelemetry => {
  const clock = input.clock ?? { now: () => new Date() };
  const service =
    typeof input.service === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.service)
      ? input.service
      : "worker";
  const write = (kind: "log" | "metric" | "span", value: object): void => {
    console.info(
      JSON.stringify({
        kind,
        service,
        timestamp: clock.now().toISOString(),
        ...value,
      }),
    );
  };
  return createSafeWorkerTelemetry(
    {
      flush: () => Promise.resolve(),
      log: (record) => write("log", record),
      metric: (record) => write("metric", record),
      startSpan: (record) => ({
        end: (result) => write("span", { ...record, ...result }),
      }),
    },
    () => console.error("Worker telemetry export failed", { code: "worker_telemetry_failed" }),
  );
};
