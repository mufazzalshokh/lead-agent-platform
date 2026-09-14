import type { ActiveEventRoute } from "./event-routing.js";
import { QUEUE_NAMES, type QueueName } from "./queue-names.js";
import type { WorkerTelemetry } from "./worker-telemetry.js";

export const WORKER_OPERATIONS_POLL_MILLISECONDS = 15_000;

export type OutboxBacklogSnapshot = Readonly<{
  dispatchablePendingCount: number;
  inactivePendingCount: number;
  oldestDispatchableAgeMilliseconds: number | null;
  pendingCount: number;
}>;

export type WorkerOutboxBacklogProbe = Readonly<{
  observeOutboxBacklog: (
    activeRoutes: readonly ActiveEventRoute[],
  ) => Promise<OutboxBacklogSnapshot>;
}>;

export type WorkerQueueDepth = Readonly<{
  activeCount: number;
  queue: QueueName;
  readyCount: number;
}>;

export type WorkerQueueDepthProbe = Readonly<{
  observeQueueDepths: () => Promise<readonly WorkerQueueDepth[]>;
}>;

export class WorkerOperationsInvariantError extends Error {
  readonly code = "worker_operations_invariant_failed" as const;

  constructor() {
    super("Worker operational observation failed validation");
    this.name = "WorkerOperationsInvariantError";
  }
}

const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const emitOutboxMetrics = (telemetry: WorkerTelemetry, snapshot: OutboxBacklogSnapshot): void => {
  if (
    !isCount(snapshot.pendingCount) ||
    !isCount(snapshot.dispatchablePendingCount) ||
    !isCount(snapshot.inactivePendingCount) ||
    snapshot.dispatchablePendingCount + snapshot.inactivePendingCount > snapshot.pendingCount ||
    (snapshot.oldestDispatchableAgeMilliseconds !== null &&
      (!Number.isFinite(snapshot.oldestDispatchableAgeMilliseconds) ||
        snapshot.oldestDispatchableAgeMilliseconds < 0))
  ) {
    throw new WorkerOperationsInvariantError();
  }
  telemetry.metric({ labels: {}, name: "worker.outbox.pending", value: snapshot.pendingCount });
  telemetry.metric({
    labels: {},
    name: "worker.outbox.dispatchable_pending",
    value: snapshot.dispatchablePendingCount,
  });
  telemetry.metric({
    labels: {},
    name: "worker.outbox.inactive_pending",
    value: snapshot.inactivePendingCount,
  });
  telemetry.metric({
    labels: {},
    name: "worker.outbox.oldest_dispatchable_age_ms",
    value: snapshot.oldestDispatchableAgeMilliseconds ?? 0,
  });
};

const emitQueueMetrics = (
  telemetry: WorkerTelemetry,
  depths: readonly WorkerQueueDepth[],
  activeQueues: readonly QueueName[],
): void => {
  if (
    depths.length !== QUEUE_NAMES.length ||
    new Set(depths.map(({ queue }) => queue)).size !== QUEUE_NAMES.length
  ) {
    throw new WorkerOperationsInvariantError();
  }
  for (const depth of depths) {
    if (
      !(QUEUE_NAMES as readonly string[]).includes(depth.queue) ||
      !isCount(depth.readyCount) ||
      !isCount(depth.activeCount)
    ) {
      throw new WorkerOperationsInvariantError();
    }
    const hasConsumer = activeQueues.includes(depth.queue);
    const saturated = depth.readyCount > 0 && (!hasConsumer || depth.activeCount >= 1);
    telemetry.metric({
      labels: { queue: depth.queue },
      name: "worker.queue.ready",
      value: depth.readyCount,
    });
    telemetry.metric({
      labels: { queue: depth.queue },
      name: "worker.queue.active",
      value: depth.activeCount,
    });
    telemetry.metric({
      labels: { queue: depth.queue },
      name: "worker.workload.saturation",
      value: saturated ? 1 : 0,
    });
  }
};

export const collectWorkerOperationalMetrics = async (input: {
  activeQueues: readonly QueueName[];
  activeRoutes: readonly ActiveEventRoute[];
  outbox?: WorkerOutboxBacklogProbe;
  queue?: WorkerQueueDepthProbe;
  telemetry: WorkerTelemetry;
}): Promise<void> => {
  const observeOutbox = async (): Promise<OutboxBacklogSnapshot | undefined> =>
    input.outbox?.observeOutboxBacklog(input.activeRoutes);
  const observeQueue = async (): Promise<readonly WorkerQueueDepth[] | undefined> =>
    input.queue?.observeQueueDepths();
  const observations = await Promise.allSettled([observeOutbox(), observeQueue()]);
  const backlog = observations[0];
  if (backlog?.status === "fulfilled" && backlog.value !== undefined) {
    try {
      emitOutboxMetrics(input.telemetry, backlog.value);
    } catch {
      input.telemetry.log({
        attributes: {},
        event: "worker.operations.probe_failed",
        severity: "warn",
      });
    }
  } else if (backlog?.status === "rejected") {
    input.telemetry.log({
      attributes: {},
      event: "worker.operations.probe_failed",
      severity: "warn",
    });
  }

  const queueDepths = observations[1];
  if (queueDepths?.status === "fulfilled" && queueDepths.value !== undefined) {
    try {
      emitQueueMetrics(input.telemetry, queueDepths.value, input.activeQueues);
    } catch {
      input.telemetry.log({
        attributes: {},
        event: "worker.operations.probe_failed",
        severity: "warn",
      });
    }
  } else if (queueDepths?.status === "rejected") {
    input.telemetry.log({
      attributes: {},
      event: "worker.operations.probe_failed",
      severity: "warn",
    });
  }
};
