import type { QueueDatabaseRuntimeConfig } from "@lead-agent/config";
import { PgBoss } from "pg-boss";

import { isPrivateQueueEnvelopeV1, type PrivateQueueEnvelopeV1 } from "./queue-envelope.js";
import { QUEUE_NAMES, type QueueName } from "./queue-names.js";

export { QUEUE_NAMES, type QueueName } from "./queue-names.js";

export const PG_BOSS_PACKAGE_VERSION = "12.31.0" as const;
export const PG_BOSS_SCHEMA = "pgboss" as const;
export const PG_BOSS_SCHEMA_VERSION = 41 as const;
export const PG_BOSS_CONSTRUCTION_PLAN_SHA256 =
  "47cb669984703400f9d39066d3c3ce649d5ffab050967125295397c29da592ef" as const;

export type ExistingQueueJob = Readonly<{
  data: unknown;
  id: string;
  queue: QueueName;
}>;

export type QueueWorkItem = Readonly<{
  data: unknown;
  id: string;
  queue: QueueName;
  retryCount: number;
  retryLimit: number;
}>;

export type QueueWorkRegistration = Readonly<{
  id: string;
  queue: QueueName;
}>;

export type QueueWorkHandler = (job: QueueWorkItem) => Promise<void>;

export class QueueInfrastructureDatabaseError extends Error {
  readonly code = "queue_infrastructure_database_error" as const;

  constructor() {
    super("Queue infrastructure database operation failed");
    this.name = "QueueInfrastructureDatabaseError";
  }
}

export class QueueInfrastructureValidationError extends Error {
  readonly code = "queue_infrastructure_validation_error" as const;

  constructor() {
    super("Queue infrastructure input validation failed");
    this.name = "QueueInfrastructureValidationError";
  }
}

const queueInfrastructureDatabaseCauses = new WeakMap<QueueInfrastructureDatabaseError, unknown>();

export const readQueueInfrastructureDatabaseCause = (
  error: QueueInfrastructureDatabaseError,
): unknown => queueInfrastructureDatabaseCauses.get(error);

export type QueueInfrastructure = Readonly<{
  enqueueDurably: (
    queue: QueueName,
    jobId: string,
    envelope: PrivateQueueEnvelopeV1,
  ) => Promise<string | null>;
  inspectExistingJobForReconciliation: (jobId: string) => Promise<readonly ExistingQueueJob[]>;
  registerWorker: (queue: QueueName, handler: QueueWorkHandler) => Promise<QueueWorkRegistration>;
  start: () => Promise<void>;
  stopWorker: (registration: QueueWorkRegistration) => Promise<void>;
  stop: () => Promise<void>;
}>;

export const createQueueInfrastructure = (
  configuration: QueueDatabaseRuntimeConfig,
): QueueInfrastructure => {
  const boss = new PgBoss({
    application_name: "lead-agent-worker-queue",
    connectionString: configuration.connectionString,
    connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
    createSchema: false,
    max: configuration.maxConnections,
    migrate: false,
    reindex: false,
    schedule: false,
    schema: PG_BOSS_SCHEMA,
    supervise: false,
    useListenNotify: false,
  });

  return Object.freeze({
    enqueueDurably: async (
      queue: QueueName,
      jobId: string,
      envelope: PrivateQueueEnvelopeV1,
    ): Promise<string | null> => {
      if (
        !(QUEUE_NAMES as readonly string[]).includes(queue) ||
        !isPrivateQueueEnvelopeV1(envelope) ||
        jobId !== envelope.outbox_event_id
      ) {
        throw new QueueInfrastructureValidationError();
      }
      try {
        return await boss.send(queue, envelope, { id: jobId });
      } catch (error) {
        const mapped = new QueueInfrastructureDatabaseError();
        queueInfrastructureDatabaseCauses.set(mapped, error);
        throw mapped;
      }
    },
    inspectExistingJobForReconciliation: async (
      jobId: string,
    ): Promise<readonly ExistingQueueJob[]> => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(jobId)) {
        throw new QueueInfrastructureValidationError();
      }
      try {
        const jobs = await Promise.all(
          QUEUE_NAMES.map(async (queue): Promise<ExistingQueueJob | undefined> => {
            const job = await boss.getJobById<unknown>(queue, jobId);
            return job === null ? undefined : Object.freeze({ data: job.data, id: job.id, queue });
          }),
        );
        return Object.freeze(jobs.filter((job): job is ExistingQueueJob => job !== undefined));
      } catch (error) {
        const mapped = new QueueInfrastructureDatabaseError();
        queueInfrastructureDatabaseCauses.set(mapped, error);
        throw mapped;
      }
    },
    registerWorker: async (
      queue: QueueName,
      handler: QueueWorkHandler,
    ): Promise<QueueWorkRegistration> => {
      if (!(QUEUE_NAMES as readonly string[]).includes(queue) || typeof handler !== "function") {
        throw new QueueInfrastructureValidationError();
      }
      try {
        const options = {
          batchSize: 1,
          includeMetadata: true,
          localConcurrency: 1,
          pollingIntervalSeconds: 1,
        } as const;
        const id = await boss.work<unknown, void, typeof options>(
          queue,
          options,
          async (jobs): Promise<void> => {
            const job = jobs[0];
            if (jobs.length !== 1 || job === undefined || job.name !== queue) {
              throw new QueueInfrastructureValidationError();
            }
            await handler(
              Object.freeze({
                data: job.data,
                id: job.id,
                queue,
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
              }),
            );
          },
        );
        return Object.freeze({ id, queue });
      } catch (error) {
        if (error instanceof QueueInfrastructureValidationError) throw error;
        const mapped = new QueueInfrastructureDatabaseError();
        queueInfrastructureDatabaseCauses.set(mapped, error);
        throw mapped;
      }
    },
    start: async (): Promise<void> => {
      await boss.start();
    },
    stop: async (): Promise<void> => {
      await boss.stop();
    },
    stopWorker: async (registration: QueueWorkRegistration): Promise<void> => {
      if (
        typeof registration !== "object" ||
        registration === null ||
        typeof registration.id !== "string" ||
        registration.id.length === 0 ||
        !(QUEUE_NAMES as readonly string[]).includes(registration.queue)
      ) {
        throw new QueueInfrastructureValidationError();
      }
      try {
        await boss.offWork(registration.queue, { id: registration.id, wait: true });
      } catch (error) {
        const mapped = new QueueInfrastructureDatabaseError();
        queueInfrastructureDatabaseCauses.set(mapped, error);
        throw mapped;
      }
    },
  });
};
