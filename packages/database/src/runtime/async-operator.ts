import type { QueueDatabaseRuntimeConfig } from "@lead-agent/config";
import {
  DomainEventNameSchema,
  EventIdSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
  UuidV7Schema,
  isSchemaValue,
  type DomainEventName,
  type EventId,
  type OrganizationId,
  type SchemaVersion,
  type UuidV7,
} from "@lead-agent/contracts";
import { Pool, type PoolClient } from "pg";

const REQUIRED_ASYNC_OPERATOR_ROLE = "lead_agent_async_operator";
const WORKLOAD_QUEUES = Object.freeze([
  "inbound",
  "ai",
  "outbound_message",
  "staff_notification",
  "analytics",
  "maintenance",
] as const);
const HANDLER_VERSION_PATTERN = /^v[1-9][0-9]{0,5}$/u;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type AsyncWorkloadQueue = (typeof WORKLOAD_QUEUES)[number];

export type AsyncOperatorContext = Readonly<{
  approvalReference: string;
  auditEventId: UuidV7;
  operatorPrincipalId: UuidV7;
  reasonCode: string;
  requestId: string;
  sourceIpHash: Uint8Array;
}>;

export type WorkerDlqRedriveInput = AsyncOperatorContext &
  Readonly<{
    dlqJobId: string;
    eventType: DomainEventName;
    expectedState: "created";
    handlerVersion: string;
    outboxEventId: EventId;
    schemaVersion: SchemaVersion;
    sourceQueue: AsyncWorkloadQueue;
  }>;

export type DeadOutboxRequeueInput = AsyncOperatorContext &
  Readonly<{
    eventType: DomainEventName;
    expectedErrorCategory: string;
    expectedState: "dead_lettered";
    organizationId: OrganizationId;
    outboxEventId: EventId;
    schemaVersion: SchemaVersion;
  }>;

export type AsyncOperatorDatabaseRuntime = Readonly<{
  close: () => Promise<void>;
  redriveWorkerDlqJob: (input: WorkerDlqRedriveInput) => Promise<string>;
  requeueDeadOutboxEvent: (input: DeadOutboxRequeueInput) => Promise<void>;
}>;

export type AsyncOperatorDatabaseRuntimeObservability = Readonly<{
  onUnexpectedPoolError: (error: Error) => void;
}>;

export class AsyncOperatorRuntimeClosedError extends Error {
  readonly code = "async_operator_runtime_closed" as const;
  constructor() {
    super("Async operator database runtime is closed");
    this.name = "AsyncOperatorRuntimeClosedError";
  }
}

export class AsyncOperatorRoleError extends Error {
  readonly code = "async_operator_role_required" as const;
  constructor() {
    super("Async maintenance requires the dedicated platform operator role");
    this.name = "AsyncOperatorRoleError";
  }
}

export class AsyncOperatorValidationError extends Error {
  readonly code = "async_operator_validation_failed" as const;
  constructor() {
    super("Async operator maintenance input or result is invalid");
    this.name = "AsyncOperatorValidationError";
  }
}

export class AsyncOperatorDatabaseError extends Error {
  readonly code = "async_operator_database_error" as const;
  constructor() {
    super("Async operator database operation failed");
    this.name = "AsyncOperatorDatabaseError";
  }
}

const asyncOperatorDatabaseCauses = new WeakMap<AsyncOperatorDatabaseError, unknown>();

export const readAsyncOperatorDatabaseCause = (error: AsyncOperatorDatabaseError): unknown =>
  asyncOperatorDatabaseCauses.get(error);

const requireContext = (input: AsyncOperatorContext): void => {
  if (
    !isSchemaValue(UuidV7Schema, input.auditEventId) ||
    !isSchemaValue(UuidV7Schema, input.operatorPrincipalId) ||
    input.approvalReference.trim() !== input.approvalReference ||
    input.approvalReference.length < 1 ||
    input.approvalReference.length > 255 ||
    !REASON_CODE_PATTERN.test(input.reasonCode) ||
    input.reasonCode.length > 100 ||
    !REQUEST_ID_PATTERN.test(input.requestId) ||
    input.sourceIpHash.byteLength < 16 ||
    input.sourceIpHash.byteLength > 128
  ) {
    throw new AsyncOperatorValidationError();
  }
};

class AsyncOperatorDatabaseRuntimeImplementation implements AsyncOperatorDatabaseRuntime {
  readonly #pool: Pool;
  #closed = false;

  constructor(
    configuration: QueueDatabaseRuntimeConfig,
    observability: AsyncOperatorDatabaseRuntimeObservability,
  ) {
    this.#pool = new Pool({
      connectionString: configuration.connectionString,
      connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
      max: Math.min(configuration.maxConnections, 2),
    });
    this.#pool.on("error", observability.onUnexpectedPoolError);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pool.end();
  }

  async redriveWorkerDlqJob(input: WorkerDlqRedriveInput): Promise<string> {
    requireContext(input);
    if (
      !UUID_PATTERN.test(input.dlqJobId) ||
      !isSchemaValue(EventIdSchema, input.outboxEventId) ||
      !isSchemaValue(DomainEventNameSchema, input.eventType) ||
      !isSchemaValue(SchemaVersionSchema, input.schemaVersion) ||
      !HANDLER_VERSION_PATTERN.test(input.handlerVersion) ||
      !(WORKLOAD_QUEUES as readonly string[]).includes(input.sourceQueue) ||
      input.expectedState !== "created"
    ) {
      throw new AsyncOperatorValidationError();
    }
    return this.#withClient(async (client) => {
      const result = await client.query<{ redriven_job_id: string }>(
        `select app.operator_redrive_worker_dlq_job(
           $1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::varchar,
           $6::uuid, $7::varchar, $8::varchar, $9::varchar, $10::varchar,
           $11::varchar, $12::varchar, $13::bytea
         )::text as redriven_job_id`,
        [
          input.auditEventId,
          input.operatorPrincipalId,
          input.dlqJobId,
          input.sourceQueue,
          input.handlerVersion,
          input.outboxEventId,
          input.eventType,
          input.schemaVersion,
          input.expectedState,
          input.approvalReference,
          input.reasonCode,
          input.requestId,
          Buffer.from(input.sourceIpHash),
        ],
      );
      const jobId = result.rows[0]?.redriven_job_id;
      if (jobId === undefined || !UUID_PATTERN.test(jobId)) {
        throw new AsyncOperatorValidationError();
      }
      return jobId;
    });
  }

  async requeueDeadOutboxEvent(input: DeadOutboxRequeueInput): Promise<void> {
    requireContext(input);
    if (
      !isSchemaValue(OrganizationIdSchema, input.organizationId) ||
      !isSchemaValue(EventIdSchema, input.outboxEventId) ||
      !isSchemaValue(DomainEventNameSchema, input.eventType) ||
      !isSchemaValue(SchemaVersionSchema, input.schemaVersion) ||
      !REASON_CODE_PATTERN.test(input.expectedErrorCategory) ||
      input.expectedErrorCategory.length > 100 ||
      input.expectedState !== "dead_lettered"
    ) {
      throw new AsyncOperatorValidationError();
    }
    await this.#withClient(async (client) => {
      const result = await client.query<{ requeued: boolean }>(
        `select app.operator_requeue_dead_outbox_event(
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar,
           $6::varchar, $7::varchar, $8::varchar, $9::varchar,
           $10::varchar, $11::varchar, $12::bytea
         ) as requeued`,
        [
          input.auditEventId,
          input.operatorPrincipalId,
          input.organizationId,
          input.outboxEventId,
          input.eventType,
          input.schemaVersion,
          input.expectedState,
          input.expectedErrorCategory,
          input.approvalReference,
          input.reasonCode,
          input.requestId,
          Buffer.from(input.sourceIpHash),
        ],
      );
      if (result.rows[0]?.requeued !== true) throw new AsyncOperatorValidationError();
    });
  }

  async #withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.#closed) throw new AsyncOperatorRuntimeClosedError();
    const client = await this.#pool.connect().catch((error: unknown) => {
      const mapped = new AsyncOperatorDatabaseError();
      asyncOperatorDatabaseCauses.set(mapped, error);
      throw mapped;
    });
    try {
      const role = await client.query<{ database_role: string }>(
        "select current_user as database_role",
      );
      if (role.rows[0]?.database_role !== REQUIRED_ASYNC_OPERATOR_ROLE) {
        throw new AsyncOperatorRoleError();
      }
      return await operation(client);
    } catch (error) {
      if (
        error instanceof AsyncOperatorRoleError ||
        error instanceof AsyncOperatorRuntimeClosedError ||
        error instanceof AsyncOperatorValidationError
      ) {
        throw error;
      }
      const mapped = new AsyncOperatorDatabaseError();
      asyncOperatorDatabaseCauses.set(mapped, error);
      throw mapped;
    } finally {
      client.release();
    }
  }
}

export const createAsyncOperatorDatabaseRuntime = (
  configuration: QueueDatabaseRuntimeConfig,
  observability: AsyncOperatorDatabaseRuntimeObservability,
): AsyncOperatorDatabaseRuntime =>
  new AsyncOperatorDatabaseRuntimeImplementation(configuration, observability);
