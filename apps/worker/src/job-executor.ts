import { isRoutedEventType, queueForEvent } from "./event-routing.js";
import {
  createWorkerHandlerIdentity,
  type WorkerHandlerContext,
  type WorkerHandlerRegistry,
} from "./handler-registry.js";
import type {
  CanonicalDispatchEvent,
  TenantCanonicalEventSourcePort,
} from "./outbox-dispatcher.js";
import { requirePrivateQueueEnvelopeV1, type PrivateQueueEnvelopeV1 } from "./queue-envelope.js";
import type { QueueWorkItem } from "./queue-infrastructure.js";

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

export type WorkerJobExecutor = Readonly<{
  execute: (job: QueueWorkItem) => Promise<void>;
}>;

export const createWorkerJobExecutor = (input: {
  registry: WorkerHandlerRegistry;
  tenantEvents: TenantCanonicalEventSourcePort;
}): WorkerJobExecutor =>
  Object.freeze({
    execute: async (job: QueueWorkItem): Promise<void> => {
      const envelope = requirePrivateQueueEnvelopeV1(job.data);
      if (job.id !== envelope.outbox_event_id || queueForEvent(envelope.event_type) !== job.queue) {
        throw new WorkerJobInvariantError();
      }

      const registration = input.registry.resolve(
        envelope.event_type,
        envelope.event_schema_version,
      );
      if (registration === undefined || registration.queue !== job.queue) {
        throw new WorkerJobInvariantError();
      }

      const canonicalEvent = await input.tenantEvents.loadCanonicalEvent(
        envelope.organization_id,
        envelope.outbox_event_id,
      );
      if (
        !eventMatchesEnvelope(canonicalEvent, envelope) ||
        !isRoutedEventType(canonicalEvent.event_type)
      ) {
        throw new WorkerJobInvariantError();
      }

      const tenant = Object.freeze({ organizationId: envelope.organization_id });
      const context: WorkerHandlerContext = Object.freeze({
        attempt: Object.freeze({
          attemptNumber: job.retryCount + 1,
          jobId: job.id,
          retryLimit: job.retryLimit,
        }),
        canonicalEvent,
        causationId: envelope.causation_id ?? null,
        correlationId: envelope.correlation_id,
        identity: createWorkerHandlerIdentity(
          registration.handlerVersion,
          envelope.outbox_event_id,
        ),
        organizationId: envelope.organization_id,
        outboxEventId: envelope.outbox_event_id,
        tenant,
      });
      await registration.handler(context);
    },
  });
