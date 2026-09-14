import { createHash } from "node:crypto";

import { isRoutedEventType, queueForEvent } from "./event-routing.js";
import type {
  WorkerExecutionIdentityInput,
  WorkerReliabilityPersistencePort,
} from "./handler-reliability.js";
import {
  createWorkerHandlerIdentity,
  type WorkerHandlerContext,
  type WorkerHandlerRegistration,
  type WorkerHandlerRegistry,
  type WorkerReconciliationResult,
} from "./handler-registry.js";
import type {
  CanonicalDispatchEvent,
  TenantCanonicalEventSourcePort,
} from "./outbox-dispatcher.js";
import { requirePrivateQueueEnvelopeV1, type PrivateQueueEnvelopeV1 } from "./queue-envelope.js";
import type { QueueWorkItem, QueueWorkResult } from "./queue-infrastructure.js";
import {
  WorkerExecutionFailure,
  classifyHandlerFailure,
  decideWorkerRetry,
  type WorkerFailureCategory,
} from "./reliability-policy.js";

export class WorkerJobInvariantError extends Error {
  readonly code = "worker_job_invariant_failed" as const;

  constructor() {
    super("Worker job invariant validation failed");
    this.name = "WorkerJobInvariantError";
  }
}

const eventMatchesEnvelope = (
  event: CanonicalDispatchEvent,
  envelope: PrivateQueueEnvelopeV1,
): boolean =>
  event.event_id === envelope.outbox_event_id &&
  event.organization_id === envelope.organization_id &&
  event.event_type === envelope.event_type &&
  event.schema_version === envelope.event_schema_version &&
  event.aggregate_type === envelope.aggregate_type &&
  event.aggregate_id === envelope.aggregate_id &&
  event.correlation_id === envelope.correlation_id &&
  event.causation_id === (envelope.causation_id ?? null);

const fingerprintFor = (
  event: CanonicalDispatchEvent,
  envelope: PrivateQueueEnvelopeV1,
): Uint8Array =>
  createHash("sha256")
    .update(
      JSON.stringify([
        envelope.job_schema_version,
        event.event_id,
        event.organization_id,
        event.event_type,
        event.schema_version,
        event.aggregate_type,
        event.aggregate_id,
        event.correlation_id,
        event.causation_id,
      ]),
    )
    .digest();

const deadLetter = (category: WorkerFailureCategory): QueueWorkResult =>
  Object.freeze({ category, status: "deadletter" });

const completed = (): QueueWorkResult => Object.freeze({ status: "completed" });

export type WorkerJobExecutor = Readonly<{
  execute: (job: QueueWorkItem) => Promise<QueueWorkResult>;
}>;

export const createWorkerJobExecutor = (input: {
  clock?: Readonly<{ now: () => Date }>;
  random?: () => number;
  registry: WorkerHandlerRegistry;
  reliability: WorkerReliabilityPersistencePort;
  tenantEvents: TenantCanonicalEventSourcePort;
}): WorkerJobExecutor => {
  const clock = input.clock ?? { now: () => new Date() };
  const random = input.random ?? Math.random;

  const retryOrDeadLetter = async (
    job: QueueWorkItem,
    failure: WorkerExecutionFailure,
  ): Promise<QueueWorkResult> => {
    const decision = decideWorkerRetry({
      createdAt: job.createdOn,
      executionNumber: job.retryCount + 1,
      failure,
      now: clock.now(),
      random,
    });
    if (decision.kind === "dead_letter") return deadLetter(decision.category);
    const prepared = await input.reliability.prepareRetry({
      delaySeconds: decision.delaySeconds,
      physicalJobId: job.id,
      queue: job.queue,
      retryCount: job.retryCount,
    });
    return prepared
      ? Object.freeze({ category: decision.category, status: "failed" as const })
      : deadLetter("RETRYABLE_INFRASTRUCTURE");
  };

  const createContext = (
    job: QueueWorkItem,
    envelope: PrivateQueueEnvelopeV1,
    canonicalEvent: CanonicalDispatchEvent,
    registration: WorkerHandlerRegistration,
  ): WorkerHandlerContext => {
    const tenant = Object.freeze({ organizationId: envelope.organization_id });
    return Object.freeze({
      attempt: Object.freeze({
        attemptNumber: job.retryCount + 1,
        jobId: job.id,
        retryLimit: job.retryLimit,
      }),
      canonicalEvent,
      causationId: envelope.causation_id ?? null,
      correlationId: envelope.correlation_id,
      identity: createWorkerHandlerIdentity(registration.handlerVersion, envelope.outbox_event_id),
      organizationId: envelope.organization_id,
      outboxEventId: envelope.outbox_event_id,
      tenant,
    });
  };

  const finish = async (
    identity: WorkerExecutionIdentityInput,
    leaseToken: string,
    state: "permanent_failure" | "reconciliation_required" | "retryable_failure" | "succeeded",
    category: WorkerFailureCategory | null,
  ): Promise<boolean> =>
    input.reliability.finishExecution({ ...identity, category, leaseToken, state });

  const invokeHandler = async (
    job: QueueWorkItem,
    registration: WorkerHandlerRegistration,
    context: WorkerHandlerContext,
    identity: WorkerExecutionIdentityInput,
    leaseToken: string,
  ): Promise<QueueWorkResult> => {
    try {
      await registration.handler(context);
      return (await finish(identity, leaseToken, "succeeded", null))
        ? completed()
        : retryOrDeadLetter(job, new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT"));
    } catch (error) {
      const failure = classifyHandlerFailure(error);
      const decision = decideWorkerRetry({
        createdAt: job.createdOn,
        executionNumber: job.retryCount + 1,
        failure,
        now: clock.now(),
        random,
      });
      const hasReconciler = registration.reconcile !== undefined;

      if (failure.category === "AMBIGUOUS_EXTERNAL_EFFECT") {
        await finish(identity, leaseToken, "reconciliation_required", failure.category);
        if (!hasReconciler || decision.kind === "dead_letter") return deadLetter(failure.category);
        const prepared = await input.reliability.prepareRetry({
          delaySeconds: decision.delaySeconds,
          physicalJobId: job.id,
          queue: job.queue,
          retryCount: job.retryCount,
        });
        return prepared
          ? Object.freeze({ category: failure.category, status: "failed" as const })
          : deadLetter("RETRYABLE_INFRASTRUCTURE");
      }

      if (decision.kind === "retry") {
        const persisted = await finish(identity, leaseToken, "retryable_failure", failure.category);
        if (!persisted) return deadLetter("AMBIGUOUS_EXTERNAL_EFFECT");
        const prepared = await input.reliability.prepareRetry({
          delaySeconds: decision.delaySeconds,
          physicalJobId: job.id,
          queue: job.queue,
          retryCount: job.retryCount,
        });
        return prepared
          ? Object.freeze({ category: failure.category, status: "failed" as const })
          : deadLetter("RETRYABLE_INFRASTRUCTURE");
      }

      await finish(identity, leaseToken, "permanent_failure", failure.category);
      return deadLetter(failure.category);
    }
  };

  const reconcile = async (
    job: QueueWorkItem,
    registration: WorkerHandlerRegistration,
    context: WorkerHandlerContext,
    identity: WorkerExecutionIdentityInput,
  ): Promise<QueueWorkResult> => {
    if (registration.reconcile === undefined) {
      return deadLetter("AMBIGUOUS_EXTERNAL_EFFECT");
    }

    let result: WorkerReconciliationResult;
    try {
      result = await registration.reconcile(context);
    } catch (error) {
      return retryOrDeadLetter(job, classifyHandlerFailure(error));
    }

    if (result.state === "succeeded") {
      const resolved = await input.reliability.resolveReconciliation({
        ...identity,
        category: null,
        resolution: "succeeded",
      });
      return resolved ? completed() : deadLetter("TENANT_INTEGRITY");
    }
    if (result.state === "permanent_failure") {
      await input.reliability.resolveReconciliation({
        ...identity,
        category: "PERMANENT_BUSINESS",
        resolution: "permanent_failure",
      });
      return deadLetter("PERMANENT_BUSINESS");
    }
    if (result.state === "unresolved") {
      await input.reliability.resolveReconciliation({
        ...identity,
        category: "AMBIGUOUS_EXTERNAL_EFFECT",
        resolution: "unresolved",
      });
      return deadLetter("AMBIGUOUS_EXTERNAL_EFFECT");
    }

    if (result.state !== "not_executed") {
      return deadLetter("PERMANENT_VALIDATION");
    }

    const leaseToken = await input.reliability.resumeAfterReconciliation(identity);
    return leaseToken === null
      ? retryOrDeadLetter(job, new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE"))
      : invokeHandler(job, registration, context, identity, leaseToken);
  };

  return Object.freeze({
    execute: async (job: QueueWorkItem): Promise<QueueWorkResult> => {
      if (job.retryLimit !== 4 || job.retryCount < 0 || job.retryCount >= 5) {
        return deadLetter("TENANT_INTEGRITY");
      }

      let envelope: PrivateQueueEnvelopeV1;
      try {
        envelope = requirePrivateQueueEnvelopeV1(job.data);
      } catch {
        return deadLetter("PERMANENT_VALIDATION");
      }
      if (queueForEvent(envelope.event_type) !== job.queue) {
        return deadLetter("TENANT_INTEGRITY");
      }

      const registration = input.registry.resolve(
        envelope.event_type,
        envelope.event_schema_version,
      );
      if (registration === undefined || registration.queue !== job.queue) {
        return deadLetter("UNSUPPORTED_VERSION");
      }

      let canonicalEvent: CanonicalDispatchEvent;
      try {
        canonicalEvent = await input.tenantEvents.loadCanonicalEvent(
          envelope.organization_id,
          envelope.outbox_event_id,
        );
      } catch {
        return retryOrDeadLetter(job, new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE"));
      }
      if (
        !eventMatchesEnvelope(canonicalEvent, envelope) ||
        !isRoutedEventType(canonicalEvent.event_type)
      ) {
        return deadLetter("TENANT_INTEGRITY");
      }

      const context = createContext(job, envelope, canonicalEvent, registration);
      const identity: WorkerExecutionIdentityInput = Object.freeze({
        executionNumber: job.retryCount + 1,
        fingerprint: fingerprintFor(canonicalEvent, envelope),
        handlerVersion: registration.handlerVersion,
        organizationId: envelope.organization_id,
        outboxEventId: envelope.outbox_event_id,
      });

      let acquisition;
      try {
        acquisition = await input.reliability.acquireExecution(identity);
      } catch {
        return retryOrDeadLetter(job, new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE"));
      }
      if (acquisition.state === "known_success" || acquisition.state === "busy") {
        return completed();
      }
      if (acquisition.state === "known_permanent_failure") {
        return deadLetter("PERMANENT_BUSINESS");
      }
      if (acquisition.state === "collision") {
        return deadLetter("TENANT_INTEGRITY");
      }
      if (acquisition.state === "reconciliation_required") {
        return reconcile(job, registration, context, identity);
      }
      if (acquisition.state !== "acquired") {
        return deadLetter("TENANT_INTEGRITY");
      }
      return invokeHandler(job, registration, context, identity, acquisition.leaseToken);
    },
  });
};
