import type { QueueDatabaseRuntimeConfig } from "@lead-agent/config";
import { PgBoss } from "pg-boss";

import type {
  WorkerExecutionAcquisition,
  WorkerExecutionIdentityInput,
  WorkerReliabilityPersistencePort,
} from "./handler-reliability.js";
import { isPrivateQueueEnvelopeV1, type PrivateQueueEnvelopeV1 } from "./queue-envelope.js";
import { QUEUE_NAMES, type QueueName } from "./queue-names.js";
import {
  WORKER_ACTIVE_EXPIRATION_SECONDS,
  WORKER_HEARTBEAT_SECONDS,
  WORKER_HEARTBEAT_REFRESH_SECONDS,
  WORKER_MAX_EXECUTIONS,
  WORKER_MAX_GENERIC_AGE_MILLISECONDS,
  sampleFullJitterSeconds,
  type WorkerFailureCategory,
} from "./reliability-policy.js";

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
  createdOn: Date;
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

export type QueueWorkResult =
  | Readonly<{ status: "completed" }>
  | Readonly<{
      category: WorkerFailureCategory;
      status: "deadletter" | "failed";
    }>;

export type QueueWorkHandler = (job: QueueWorkItem) => Promise<QueueWorkResult>;

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

export type QueueInfrastructure = WorkerReliabilityPersistencePort &
  Readonly<{
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

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKER_EXECUTION_LEASE_SECONDS = WORKER_ACTIVE_EXPIRATION_SECONDS;

const isUnknownRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstDatabaseRow = (result: unknown): unknown => {
  if (!isUnknownRecord(result)) return undefined;
  const rows: unknown = result["rows"];
  if (!Array.isArray(rows)) return undefined;
  const values: readonly unknown[] = rows;
  return values[0];
};

export const deadLetterQueueFor = (queue: QueueName): `${QueueName}_dlq` => `${queue}_dlq`;

type QueueInfrastructureOptions = Readonly<{
  heartbeatRefreshSeconds?: number;
  random?: () => number;
  superviseIntervalSeconds?: number;
}>;

export const createQueueInfrastructure = (
  configuration: QueueDatabaseRuntimeConfig,
  options: QueueInfrastructureOptions = {},
): QueueInfrastructure => {
  const heartbeatRefreshSeconds =
    options.heartbeatRefreshSeconds ?? WORKER_HEARTBEAT_REFRESH_SECONDS;
  const superviseIntervalSeconds = options.superviseIntervalSeconds ?? 60;
  if (
    !Number.isFinite(heartbeatRefreshSeconds) ||
    heartbeatRefreshSeconds <= 0 ||
    heartbeatRefreshSeconds >= WORKER_HEARTBEAT_SECONDS ||
    !Number.isSafeInteger(superviseIntervalSeconds) ||
    superviseIntervalSeconds < 1 ||
    superviseIntervalSeconds > 60
  ) {
    throw new QueueInfrastructureValidationError();
  }
  const boss = new PgBoss({
    application_name: "lead-agent-worker-queue",
    connectionString: configuration.connectionString,
    connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
    createSchema: false,
    maintenanceIntervalSeconds: 24 * 60 * 60,
    max: configuration.maxConnections,
    migrate: false,
    monitorIntervalSeconds: superviseIntervalSeconds,
    monitorVacuum: false,
    persistQueueStats: false,
    persistWarnings: false,
    reindex: false,
    schedule: false,
    schema: PG_BOSS_SCHEMA,
    supervise: true,
    superviseIntervalSeconds,
    useListenNotify: false,
  });
  const random = options.random ?? Math.random;

  const databaseOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      const mapped = new QueueInfrastructureDatabaseError();
      queueInfrastructureDatabaseCauses.set(mapped, error);
      throw mapped;
    }
  };

  const requireExecutionIdentity = (input: WorkerExecutionIdentityInput): void => {
    if (
      !/^v[1-9][0-9]{0,5}$/u.test(input.handlerVersion) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        input.organizationId,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        input.outboxEventId,
      ) ||
      input.fingerprint.byteLength !== 32 ||
      !Number.isSafeInteger(input.executionNumber) ||
      input.executionNumber < 1 ||
      input.executionNumber > WORKER_MAX_EXECUTIONS
    ) {
      throw new QueueInfrastructureValidationError();
    }
  };

  return Object.freeze({
    acquireExecution: async (
      input: WorkerExecutionIdentityInput,
    ): Promise<WorkerExecutionAcquisition> => {
      requireExecutionIdentity(input);
      return databaseOperation(async () => {
        const result: unknown = await boss.getDb().executeSql(
          `select acquisition_state, execution_lease_token::text,
                  execution_lease_expires_at
             from app.acquire_worker_handler_execution(
               $1::uuid, $2::uuid, $3::varchar, $4::bytea, $5::integer, $6::integer
             )`,
          [
            input.organizationId,
            input.outboxEventId,
            input.handlerVersion,
            Buffer.from(input.fingerprint),
            input.executionNumber,
            WORKER_EXECUTION_LEASE_SECONDS,
          ],
        );
        const row = firstDatabaseRow(result);
        if (!isUnknownRecord(row)) {
          throw new QueueInfrastructureValidationError();
        }
        const state = row["acquisition_state"];
        const leaseToken = row["execution_lease_token"];
        const leaseExpiresAt = row["execution_lease_expires_at"];
        if (
          state === "acquired" &&
          typeof leaseToken === "string" &&
          UUID_V4_PATTERN.test(leaseToken)
        ) {
          return Object.freeze({ leaseToken, state });
        }
        if (state === "busy" && leaseExpiresAt instanceof Date) {
          return Object.freeze({ leaseExpiresAt, state });
        }
        if (
          state === "collision" ||
          state === "known_permanent_failure" ||
          state === "known_success" ||
          state === "reconciliation_required"
        ) {
          return Object.freeze({ state });
        }
        throw new QueueInfrastructureValidationError();
      });
    },
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
      return databaseOperation(() =>
        boss.send(queue, envelope, {
          deadLetter: deadLetterQueueFor(queue),
          deleteAfterSeconds: 7 * 24 * 60 * 60,
          expireInSeconds: WORKER_ACTIVE_EXPIRATION_SECONDS,
          heartbeatSeconds: WORKER_HEARTBEAT_SECONDS,
          id: jobId,
          retentionSeconds: WORKER_MAX_GENERIC_AGE_MILLISECONDS / 1_000,
          retryBackoff: false,
          retryDelay: sampleFullJitterSeconds(0, random),
          retryLimit: WORKER_MAX_EXECUTIONS - 1,
        }),
      );
    },
    finishExecution: async (input): Promise<boolean> => {
      requireExecutionIdentity(input);
      if (!UUID_V4_PATTERN.test(input.leaseToken)) {
        throw new QueueInfrastructureValidationError();
      }
      return databaseOperation(async () => {
        const result: unknown = await boss.getDb().executeSql(
          `select app.finish_worker_handler_execution(
             $1::uuid, $2::uuid, $3::varchar, $4::uuid,
             $5::varchar, $6::varchar
           ) as finished`,
          [
            input.organizationId,
            input.outboxEventId,
            input.handlerVersion,
            input.leaseToken,
            input.state,
            input.category,
          ],
        );
        const row = firstDatabaseRow(result);
        return isUnknownRecord(row) && row["finished"] === true;
      });
    },
    inspectExistingJobForReconciliation: async (
      jobId: string,
    ): Promise<readonly ExistingQueueJob[]> => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(jobId)) {
        throw new QueueInfrastructureValidationError();
      }
      return databaseOperation(async () => {
        const jobs = await Promise.all(
          QUEUE_NAMES.map(async (queue): Promise<ExistingQueueJob | undefined> => {
            const job = await boss.getJobById<unknown>(queue, jobId);
            return job === null ? undefined : Object.freeze({ data: job.data, id: job.id, queue });
          }),
        );
        return Object.freeze(jobs.filter((job): job is ExistingQueueJob => job !== undefined));
      });
    },
    prepareRetry: async ({ delaySeconds, physicalJobId, queue, retryCount }): Promise<boolean> => {
      if (
        !(QUEUE_NAMES as readonly string[]).includes(queue) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          physicalJobId,
        ) ||
        !Number.isSafeInteger(retryCount) ||
        retryCount < 0 ||
        retryCount >= WORKER_MAX_EXECUTIONS - 1 ||
        !Number.isSafeInteger(delaySeconds) ||
        delaySeconds < 0 ||
        delaySeconds > 300
      ) {
        throw new QueueInfrastructureValidationError();
      }
      return databaseOperation(async () => {
        const result: unknown = await boss.getDb().executeSql(
          `select app.prepare_worker_job_retry(
             $1::varchar, $2::uuid, $3::integer, $4::integer
           ) as prepared`,
          [queue, physicalJobId, retryCount, delaySeconds],
        );
        const row = firstDatabaseRow(result);
        return isUnknownRecord(row) && row["prepared"] === true;
      });
    },
    registerWorker: async (
      queue: QueueName,
      handler: QueueWorkHandler,
    ): Promise<QueueWorkRegistration> => {
      if (!(QUEUE_NAMES as readonly string[]).includes(queue) || typeof handler !== "function") {
        throw new QueueInfrastructureValidationError();
      }
      return databaseOperation(async () => {
        const options = {
          batchSize: 1,
          heartbeatRefreshSeconds,
          includeMetadata: true,
          localConcurrency: 1,
          perJobResults: true,
          pollingIntervalSeconds: 1,
        } as const;
        const id = await boss.work<
          unknown,
          Readonly<{ category?: WorkerFailureCategory }>,
          typeof options
        >(queue, options, async (jobs) => {
          const job = jobs[0];
          if (jobs.length !== 1 || job === undefined || job.name !== queue) {
            throw new QueueInfrastructureValidationError();
          }
          const disposition = await handler(
            Object.freeze({
              createdOn: job.createdOn,
              data: job.data,
              id: job.id,
              queue,
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
            }),
          );
          return [
            disposition.status === "completed"
              ? { id: job.id, status: "completed" as const }
              : {
                  id: job.id,
                  output: Object.freeze({ category: disposition.category }),
                  status: disposition.status,
                },
          ];
        });
        return Object.freeze({ id, queue });
      });
    },
    resolveReconciliation: async (input): Promise<boolean> => {
      requireExecutionIdentity(input);
      return databaseOperation(async () => {
        const result: unknown = await boss.getDb().executeSql(
          `select app.resolve_worker_handler_reconciliation(
             $1::uuid, $2::uuid, $3::varchar, $4::bytea, $5::varchar, $6::varchar
           ) as resolved`,
          [
            input.organizationId,
            input.outboxEventId,
            input.handlerVersion,
            Buffer.from(input.fingerprint),
            input.resolution,
            input.category,
          ],
        );
        const row = firstDatabaseRow(result);
        return isUnknownRecord(row) && row["resolved"] === true;
      });
    },
    resumeAfterReconciliation: async (input): Promise<string | null> => {
      requireExecutionIdentity(input);
      return databaseOperation(async () => {
        const result: unknown = await boss.getDb().executeSql(
          `select app.resume_worker_handler_execution(
             $1::uuid, $2::uuid, $3::varchar, $4::bytea, $5::integer, $6::integer
           )::text as lease_token`,
          [
            input.organizationId,
            input.outboxEventId,
            input.handlerVersion,
            Buffer.from(input.fingerprint),
            input.executionNumber,
            WORKER_EXECUTION_LEASE_SECONDS,
          ],
        );
        const row = firstDatabaseRow(result);
        const leaseToken = isUnknownRecord(row) ? row["lease_token"] : undefined;
        if (leaseToken === null) return null;
        if (typeof leaseToken !== "string" || !UUID_V4_PATTERN.test(leaseToken)) {
          throw new QueueInfrastructureValidationError();
        }
        return leaseToken;
      });
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
