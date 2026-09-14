import {
  EventRoutingInvariantError,
  createActiveEventRoutes,
  isRoutedEventType,
  queueForEvent,
  type ActiveEventRoute,
} from "./event-routing.js";
import {
  PrivateQueueEnvelopeValidationError,
  createPrivateQueueEnvelopeV1,
  privateQueueEnvelopesMatch,
  requirePrivateQueueEnvelopeV1,
  type PrivateQueueEnvelopeV1,
} from "./queue-envelope.js";
import {
  QueueInfrastructureValidationError,
  type ExistingQueueJob,
  type QueueInfrastructure,
  type QueueName,
} from "./queue-infrastructure.js";
import {
  NOOP_WORKER_TELEMETRY,
  createSafeWorkerTelemetry,
  type WorkerTelemetry,
  type WorkerTelemetryOutcome,
} from "./worker-telemetry.js";

export const OUTBOX_DISPATCH_MAX_ENQUEUE_CONCURRENCY = 10;
export const OUTBOX_DISPATCH_RETRY_DELAY_MILLISECONDS = 5_000;

export type DispatchClaim = Readonly<{
  aggregateId: string;
  aggregateType: string;
  attemptNumber: number;
  causationId: string | null;
  correlationId: string;
  eventType: string;
  leaseToken: string;
  lockedUntil: Date;
  organizationId: string;
  outboxEventId: string;
  schemaVersion: string;
}>;

export type CanonicalDispatchEvent = Readonly<{
  aggregate_id: string;
  aggregate_type: string;
  causation_id: string | null;
  correlation_id: string;
  event_id: string;
  event_type: string;
  organization_id: string;
  schema_version: string;
}>;

export type DispatcherRelayPort = Readonly<{
  claimBatch: (input: {
    activeRoutes: readonly ActiveEventRoute[];
    batchSize: number;
    dispatcherId: string;
    leaseSeconds: number;
  }) => Promise<readonly DispatchClaim[]>;
  markDeadLettered: (input: {
    errorCategory: "permanent";
    leaseToken: string;
    organizationId: string;
    outboxEventId: string;
  }) => Promise<boolean>;
  markPublished: (input: {
    leaseToken: string;
    organizationId: string;
    outboxEventId: string;
  }) => Promise<"already_published" | "lease_lost" | "published">;
  releaseForRetry: (input: {
    availableAt: Date;
    errorCategory: "transient";
    leaseToken: string;
    organizationId: string;
    outboxEventId: string;
  }) => Promise<boolean>;
}>;

export type TenantCanonicalEventSourcePort = Readonly<{
  loadCanonicalEvent: (
    organizationId: string,
    outboxEventId: string,
  ) => Promise<CanonicalDispatchEvent>;
}>;

export type OutboxDispatcherClock = Readonly<{
  now: () => Date;
}>;

export type DispatchOnceResult = Readonly<{
  claimed: number;
  deadLettered: number;
  deferred: number;
  enqueued: number;
  published: number;
  reconciled: number;
  retryReleased: number;
}>;

export type OutboxDispatcher = Readonly<{
  dispatchOnce: (
    activeRoutes: readonly ActiveEventRoute[],
    signal?: AbortSignal,
  ) => Promise<DispatchOnceResult>;
}>;

export class OutboxDispatchIntegrityError extends Error {
  readonly code = "outbox_dispatch_integrity_error" as const;

  constructor() {
    super("Outbox dispatch integrity validation failed");
    this.name = "OutboxDispatchIntegrityError";
  }
}

class OutboxReconciliationMismatchError extends OutboxDispatchIntegrityError {}

const EMPTY_DISPATCH_RESULT: DispatchOnceResult = Object.freeze({
  claimed: 0,
  deadLettered: 0,
  deferred: 0,
  enqueued: 0,
  published: 0,
  reconciled: 0,
  retryReleased: 0,
});

type ItemOutcome = "dead_lettered" | "deferred" | "enqueued" | "reconciled" | "retry_released";

const isPermanentTenantEventError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = Reflect.get(error, "code");
  return (
    code === "canonical_outbox_event_integrity_error" || code === "canonical_outbox_event_not_found"
  );
};

const leaseIdentity = (claim: DispatchClaim) => ({
  leaseToken: claim.leaseToken,
  organizationId: claim.organizationId,
  outboxEventId: claim.outboxEventId,
});

const eventMatchesClaim = (event: CanonicalDispatchEvent, claim: DispatchClaim): boolean =>
  event.event_id === claim.outboxEventId &&
  event.organization_id === claim.organizationId &&
  event.event_type === claim.eventType &&
  event.schema_version === claim.schemaVersion &&
  event.aggregate_type === claim.aggregateType &&
  event.aggregate_id === claim.aggregateId &&
  event.correlation_id === claim.correlationId &&
  event.causation_id === claim.causationId;

const exactExistingEnvelope = (
  existingJobs: readonly ExistingQueueJob[],
  queue: QueueName,
  expected: PrivateQueueEnvelopeV1,
): boolean => {
  if (existingJobs.length !== 1) throw new OutboxReconciliationMismatchError();
  const existing = existingJobs[0];
  if (
    existing === undefined ||
    existing.id !== expected.outbox_event_id ||
    existing.queue !== queue
  ) {
    throw new OutboxReconciliationMismatchError();
  }
  let envelope: PrivateQueueEnvelopeV1;
  try {
    envelope = requirePrivateQueueEnvelopeV1(existing.data);
  } catch (error) {
    if (error instanceof PrivateQueueEnvelopeValidationError) {
      throw new OutboxReconciliationMismatchError();
    }
    throw error;
  }
  if (!privateQueueEnvelopesMatch(envelope, expected)) {
    throw new OutboxReconciliationMismatchError();
  }
  return true;
};

const isActiveClaim = (claim: DispatchClaim, activeRoutes: readonly ActiveEventRoute[]): boolean =>
  activeRoutes.some(
    ({ eventType, schemaVersion }) =>
      eventType === claim.eventType && schemaVersion === claim.schemaVersion,
  );

const incrementOutcome = (result: DispatchOnceResult, outcome: ItemOutcome): DispatchOnceResult =>
  Object.freeze({
    ...result,
    deadLettered: result.deadLettered + (outcome === "dead_lettered" ? 1 : 0),
    deferred: result.deferred + (outcome === "deferred" ? 1 : 0),
    enqueued: result.enqueued + (outcome === "enqueued" ? 1 : 0),
    published: result.published + (outcome === "enqueued" || outcome === "reconciled" ? 1 : 0),
    reconciled: result.reconciled + (outcome === "reconciled" ? 1 : 0),
    retryReleased: result.retryReleased + (outcome === "retry_released" ? 1 : 0),
  });

const runBounded = async <Value, Result>(
  values: readonly Value[],
  concurrency: number,
  operation: (value: Value) => Promise<Result>,
): Promise<readonly Result[]> => {
  const results: Result[] = new Array<Result>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        const value = values[index];
        if (value !== undefined) results[index] = await operation(value);
      }
    },
  );
  await Promise.all(workers);
  return Object.freeze(results);
};

export const createOutboxDispatcher = (input: {
  batchSize?: number;
  clock: OutboxDispatcherClock;
  dispatcherId: string;
  enqueueConcurrency?: number;
  leaseSeconds?: number;
  queue: Pick<QueueInfrastructure, "enqueueDurably" | "inspectExistingJobForReconciliation">;
  relay: DispatcherRelayPort;
  telemetry?: WorkerTelemetry;
  tenantEvents: TenantCanonicalEventSourcePort;
}): OutboxDispatcher => {
  const batchSize = input.batchSize ?? 50;
  const leaseSeconds = input.leaseSeconds ?? 60;
  const concurrency = input.enqueueConcurrency ?? OUTBOX_DISPATCH_MAX_ENQUEUE_CONCURRENCY;
  const telemetry = createSafeWorkerTelemetry(input.telemetry ?? NOOP_WORKER_TELEMETRY);
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 50 ||
    !Number.isSafeInteger(leaseSeconds) ||
    leaseSeconds < 1 ||
    leaseSeconds > 300 ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > OUTBOX_DISPATCH_MAX_ENQUEUE_CONCURRENCY
  ) {
    throw new OutboxDispatchIntegrityError();
  }

  const processClaim = async (
    claim: DispatchClaim,
    activeRoutes: readonly ActiveEventRoute[],
    signal?: AbortSignal,
  ): Promise<ItemOutcome> => {
    const startedAt = input.clock.now().getTime();
    const trace = telemetry.startSpan({
      attributes: {
        attempt: claim.attemptNumber,
        ...(claim.causationId === null ? {} : { causationId: claim.causationId }),
        correlationId: claim.correlationId,
        eventType: claim.eventType,
        eventVersion: claim.schemaVersion,
        organizationId: claim.organizationId,
        outboxEventId: claim.outboxEventId,
      },
      links: [
        {
          ...(claim.causationId === null ? {} : { causationId: claim.causationId }),
          correlationId: claim.correlationId,
        },
      ],
      name: "worker.outbox.dispatch",
    });
    telemetry.metric({ labels: {}, name: "worker.dispatch.attempt_total", value: 1 });
    if (claim.attemptNumber > 1) {
      telemetry.metric({ labels: {}, name: "worker.outbox.claim_recovery_total", value: 1 });
    }

    let enqueueAttempted = false;
    let outcome: ItemOutcome;
    try {
      if (signal?.aborted === true) {
        throw new Error("Outbox dispatch interrupted");
      }
      if (!isActiveClaim(claim, activeRoutes)) throw new OutboxDispatchIntegrityError();
      const event = await input.tenantEvents.loadCanonicalEvent(
        claim.organizationId,
        claim.outboxEventId,
      );
      if (!eventMatchesClaim(event, claim) || !isRoutedEventType(event.event_type)) {
        throw new OutboxDispatchIntegrityError();
      }

      const queue = queueForEvent(event.event_type);
      const envelope = createPrivateQueueEnvelopeV1({
        aggregateId: event.aggregate_id,
        aggregateType: event.aggregate_type,
        causationId: event.causation_id,
        correlationId: event.correlation_id,
        eventSchemaVersion: event.schema_version,
        eventType: event.event_type,
        organizationId: event.organization_id,
        outboxEventId: event.event_id,
      });

      const before = await input.queue.inspectExistingJobForReconciliation(event.event_id);
      let publicationOutcome: "enqueued" | "reconciled";
      if (before.length > 0) {
        exactExistingEnvelope(before, queue, envelope);
        publicationOutcome = "reconciled";
      } else {
        enqueueAttempted = true;
        const enqueuedId = await input.queue.enqueueDurably(queue, event.event_id, envelope);
        if (enqueuedId !== null && enqueuedId !== event.event_id) {
          throw new OutboxDispatchIntegrityError();
        }
        const after = await input.queue.inspectExistingJobForReconciliation(event.event_id);
        exactExistingEnvelope(after, queue, envelope);
        publicationOutcome = enqueuedId === null ? "reconciled" : "enqueued";
      }

      const publication = await input.relay.markPublished(leaseIdentity(claim));
      outcome = publication === "lease_lost" ? "deferred" : publicationOutcome;
    } catch (error) {
      if (error instanceof OutboxReconciliationMismatchError) {
        telemetry.metric({
          labels: {},
          name: "worker.reconciliation.mismatch_total",
          value: 1,
        });
      }
      const permanent =
        error instanceof EventRoutingInvariantError ||
        error instanceof OutboxDispatchIntegrityError ||
        error instanceof PrivateQueueEnvelopeValidationError ||
        error instanceof QueueInfrastructureValidationError ||
        isPermanentTenantEventError(error);
      if (permanent) {
        try {
          const deadLettered = await input.relay.markDeadLettered({
            ...leaseIdentity(claim),
            errorCategory: "permanent",
          });
          outcome = deadLettered ? "dead_lettered" : "deferred";
        } catch {
          outcome = "deferred";
        }
      } else if (enqueueAttempted || signal?.aborted === true) {
        outcome = "deferred";
      } else {
        try {
          const released = await input.relay.releaseForRetry({
            ...leaseIdentity(claim),
            availableAt: new Date(
              input.clock.now().getTime() + OUTBOX_DISPATCH_RETRY_DELAY_MILLISECONDS,
            ),
            errorCategory: "transient",
          });
          outcome = released ? "retry_released" : "deferred";
        } catch {
          outcome = "deferred";
        }
      }
    }

    const durationMilliseconds = Math.max(0, input.clock.now().getTime() - startedAt);
    const telemetryOutcome: WorkerTelemetryOutcome =
      outcome === "dead_lettered" ? "deadletter" : outcome;
    telemetry.metric({
      labels: { outcome: telemetryOutcome },
      name: "worker.dispatch.latency_ms",
      value: durationMilliseconds,
    });
    if (outcome === "dead_lettered" || outcome === "deferred" || outcome === "retry_released") {
      telemetry.metric({
        labels: { outcome: telemetryOutcome },
        name: "worker.dispatch.failure_total",
        value: 1,
      });
      telemetry.log({
        attributes: {
          attempt: claim.attemptNumber,
          ...(claim.causationId === null ? {} : { causationId: claim.causationId }),
          correlationId: claim.correlationId,
          eventType: claim.eventType,
          eventVersion: claim.schemaVersion,
          organizationId: claim.organizationId,
          outboxEventId: claim.outboxEventId,
        },
        event: "worker.dispatch.failed",
        severity: outcome === "dead_lettered" ? "error" : "warn",
      });
    }
    trace.end({ durationMilliseconds, outcome: telemetryOutcome });
    return outcome;
  };

  return Object.freeze({
    dispatchOnce: async (
      requestedActiveRoutes: readonly ActiveEventRoute[],
      signal?: AbortSignal,
    ): Promise<DispatchOnceResult> => {
      if (signal?.aborted === true) return EMPTY_DISPATCH_RESULT;
      const activeRoutes = createActiveEventRoutes(requestedActiveRoutes);
      const claims = await input.relay.claimBatch({
        activeRoutes,
        batchSize,
        dispatcherId: input.dispatcherId,
        leaseSeconds,
      });
      const outcomes = await runBounded(claims, concurrency, (claim) =>
        processClaim(claim, activeRoutes, signal),
      );
      return outcomes.reduce<DispatchOnceResult>(
        (result, outcome) => incrementOutcome(result, outcome),
        Object.freeze({ ...EMPTY_DISPATCH_RESULT, claimed: claims.length }),
      );
    },
  });
};
