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
  dispatchOnce: (activeRoutes: readonly ActiveEventRoute[]) => Promise<DispatchOnceResult>;
}>;

export class OutboxDispatchIntegrityError extends Error {
  readonly code = "outbox_dispatch_integrity_error" as const;

  constructor() {
    super("Outbox dispatch integrity validation failed");
    this.name = "OutboxDispatchIntegrityError";
  }
}

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
  if (existingJobs.length !== 1) throw new OutboxDispatchIntegrityError();
  const existing = existingJobs[0];
  if (
    existing === undefined ||
    existing.id !== expected.outbox_event_id ||
    existing.queue !== queue
  ) {
    throw new OutboxDispatchIntegrityError();
  }
  let envelope: PrivateQueueEnvelopeV1;
  try {
    envelope = requirePrivateQueueEnvelopeV1(existing.data);
  } catch (error) {
    if (error instanceof PrivateQueueEnvelopeValidationError) {
      throw new OutboxDispatchIntegrityError();
    }
    throw error;
  }
  if (!privateQueueEnvelopesMatch(envelope, expected)) {
    throw new OutboxDispatchIntegrityError();
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
  tenantEvents: TenantCanonicalEventSourcePort;
}): OutboxDispatcher => {
  const batchSize = input.batchSize ?? 50;
  const leaseSeconds = input.leaseSeconds ?? 60;
  const concurrency = input.enqueueConcurrency ?? OUTBOX_DISPATCH_MAX_ENQUEUE_CONCURRENCY;
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
  ): Promise<ItemOutcome> => {
    let enqueueAttempted = false;
    try {
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
      let outcome: "enqueued" | "reconciled";
      if (before.length > 0) {
        exactExistingEnvelope(before, queue, envelope);
        outcome = "reconciled";
      } else {
        enqueueAttempted = true;
        const enqueuedId = await input.queue.enqueueDurably(queue, event.event_id, envelope);
        if (enqueuedId !== null && enqueuedId !== event.event_id) {
          throw new OutboxDispatchIntegrityError();
        }
        const after = await input.queue.inspectExistingJobForReconciliation(event.event_id);
        exactExistingEnvelope(after, queue, envelope);
        outcome = enqueuedId === null ? "reconciled" : "enqueued";
      }

      const publication = await input.relay.markPublished(leaseIdentity(claim));
      return publication === "lease_lost" ? "deferred" : outcome;
    } catch (error) {
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
          return deadLettered ? "dead_lettered" : "deferred";
        } catch {
          return "deferred";
        }
      }
      if (enqueueAttempted) return "deferred";
      try {
        const released = await input.relay.releaseForRetry({
          ...leaseIdentity(claim),
          availableAt: new Date(
            input.clock.now().getTime() + OUTBOX_DISPATCH_RETRY_DELAY_MILLISECONDS,
          ),
          errorCategory: "transient",
        });
        return released ? "retry_released" : "deferred";
      } catch {
        return "deferred";
      }
    }
  };

  return Object.freeze({
    dispatchOnce: async (
      requestedActiveRoutes: readonly ActiveEventRoute[],
    ): Promise<DispatchOnceResult> => {
      const activeRoutes = createActiveEventRoutes(requestedActiveRoutes);
      const claims = await input.relay.claimBatch({
        activeRoutes,
        batchSize,
        dispatcherId: input.dispatcherId,
        leaseSeconds,
      });
      const outcomes = await runBounded(claims, concurrency, (claim) =>
        processClaim(claim, activeRoutes),
      );
      return outcomes.reduce<DispatchOnceResult>(
        (result, outcome) => incrementOutcome(result, outcome),
        Object.freeze({
          claimed: claims.length,
          deadLettered: 0,
          deferred: 0,
          enqueued: 0,
          published: 0,
          reconciled: 0,
          retryReleased: 0,
        }),
      );
    },
  });
};
