import type { QueueDatabaseRuntimeConfig } from "@lead-agent/config";
import {
  CausationIdSchema,
  CorrelationIdSchema,
  DomainAggregateTypeSchema,
  DomainEventNameSchema,
  DomainEventSchemasByVersion,
  EventIdSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
  UuidV7Schema,
  isSchemaValue,
  type CausationId,
  type CorrelationId,
  type DomainAggregateType,
  type DomainEventName,
  type EventId,
  type OrganizationId,
  type SchemaVersion,
  type UuidV7,
} from "@lead-agent/contracts";
import { Pool, type PoolClient } from "pg";

const REQUIRED_OUTBOX_RELAY_ROLE = "lead_agent_queue_runtime";
const DISPATCHER_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const OUTBOX_RELAY_MAX_BATCH_SIZE = 50;
export const OUTBOX_RELAY_PER_TENANT_BATCH_CAP = 5;
export const OUTBOX_RELAY_DEFAULT_LEASE_SECONDS = 60;
export const OUTBOX_RELAY_MAX_LEASE_SECONDS = 300;

export const OUTBOX_RELAY_ERROR_CATEGORIES = Object.freeze([
  "transient",
  "ambiguous_delivery",
  "permanent",
  "unknown",
] as const);

export type OutboxRelayErrorCategory = (typeof OUTBOX_RELAY_ERROR_CATEGORIES)[number];
export type OutboxRetryErrorCategory = Exclude<OutboxRelayErrorCategory, "permanent">;
export type OutboxPublicationResult = "already_published" | "lease_lost" | "published";

declare const outboxDispatcherIdBrand: unique symbol;
declare const outboxLeaseTokenBrand: unique symbol;

export type OutboxDispatcherId = string & { readonly [outboxDispatcherIdBrand]: true };
export type OutboxLeaseToken = string & { readonly [outboxLeaseTokenBrand]: true };

export type OutboxRelayClaim = Readonly<{
  outboxEventId: EventId;
  organizationId: OrganizationId;
  eventType: DomainEventName;
  schemaVersion: SchemaVersion;
  aggregateType: DomainAggregateType;
  aggregateId: UuidV7;
  correlationId: CorrelationId;
  causationId: CausationId | null;
  leaseToken: OutboxLeaseToken;
  lockedUntil: Date;
  attemptNumber: number;
}>;

export type OutboxClaimBatchInput = Readonly<{
  dispatcherId: OutboxDispatcherId;
  batchSize?: number;
  leaseSeconds?: number;
}>;

export type OutboxLeaseInput = Readonly<{
  organizationId: OrganizationId;
  outboxEventId: EventId;
  leaseToken: OutboxLeaseToken;
}>;

export type OutboxLeaseRenewalInput = OutboxLeaseInput &
  Readonly<{
    leaseSeconds?: number;
  }>;

export type OutboxRetryReleaseInput = OutboxLeaseInput &
  Readonly<{
    availableAt: Date;
    errorCategory: OutboxRetryErrorCategory;
  }>;

export type OutboxDeadLetterInput = OutboxLeaseInput &
  Readonly<{
    errorCategory: OutboxRelayErrorCategory;
  }>;

export class OutboxRelayRuntimeClosedError extends Error {
  readonly code = "outbox_relay_runtime_closed" as const;

  constructor() {
    super("Outbox relay database runtime is closed");
    this.name = "OutboxRelayRuntimeClosedError";
  }
}

export class OutboxRelayRoleError extends Error {
  readonly code = "outbox_relay_role_required" as const;

  constructor() {
    super("Outbox relay persistence requires the configured queue runtime role");
    this.name = "OutboxRelayRoleError";
  }
}

export class OutboxRelayValidationError extends Error {
  readonly code = "outbox_relay_validation_failed" as const;

  constructor() {
    super("Invalid outbox relay persistence input or result");
    this.name = "OutboxRelayValidationError";
  }
}

export class OutboxRelayDatabaseError extends Error {
  readonly code = "outbox_relay_database_error" as const;

  constructor() {
    super("Outbox relay database operation failed");
    this.name = "OutboxRelayDatabaseError";
  }
}

const outboxRelayDatabaseCauses = new WeakMap<OutboxRelayDatabaseError, unknown>();

export const readOutboxRelayDatabaseCause = (error: OutboxRelayDatabaseError): unknown =>
  outboxRelayDatabaseCauses.get(error);

export type OutboxRelayDatabaseRuntimeObservability = Readonly<{
  onUnexpectedPoolError: (error: Error) => void;
}>;

export type OutboxRelayDatabaseRuntime = Readonly<{
  claimBatch: (input: OutboxClaimBatchInput) => Promise<readonly OutboxRelayClaim[]>;
  renewLease: (input: OutboxLeaseRenewalInput) => Promise<Date | null>;
  releaseForRetry: (input: OutboxRetryReleaseInput) => Promise<boolean>;
  markPublished: (input: OutboxLeaseInput) => Promise<OutboxPublicationResult>;
  markDeadLettered: (input: OutboxDeadLetterInput) => Promise<boolean>;
  close: () => Promise<void>;
}>;

type DatabaseRoleRow = { database_role: string };

type OutboxRelayClaimRow = {
  outbox_event_id: string;
  organization_id: string;
  event_type: string;
  schema_version: string;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  lease_token: string;
  locked_until: Date;
  attempt_number: number;
};

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

const requireBoundedInteger = (value: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new OutboxRelayValidationError();
  }
  return value;
};

const requireLeaseToken = (value: string): OutboxLeaseToken => {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new OutboxRelayValidationError();
  }
  return value as OutboxLeaseToken;
};

const requireLeaseInput = (input: OutboxLeaseInput): void => {
  if (
    !isSchemaValue(OrganizationIdSchema, input.organizationId) ||
    !isSchemaValue(EventIdSchema, input.outboxEventId) ||
    !UUID_V4_PATTERN.test(input.leaseToken)
  ) {
    throw new OutboxRelayValidationError();
  }
};

const isRelayErrorCategory = (value: unknown): value is OutboxRelayErrorCategory =>
  typeof value === "string" && (OUTBOX_RELAY_ERROR_CATEGORIES as readonly string[]).includes(value);

const isRetryErrorCategory = (value: unknown): value is OutboxRetryErrorCategory =>
  isRelayErrorCategory(value) && value !== "permanent";

const isKnownEventVersion = (eventType: DomainEventName, schemaVersion: string): boolean =>
  Object.hasOwn(DomainEventSchemasByVersion[eventType], schemaVersion);

const expectedAggregateType = (eventType: DomainEventName): DomainAggregateType =>
  DomainEventSchemasByVersion[eventType]["1"].properties.aggregate_type.const;

const mapClaim = (row: OutboxRelayClaimRow): OutboxRelayClaim => {
  if (
    !isSchemaValue(EventIdSchema, row.outbox_event_id) ||
    !isSchemaValue(OrganizationIdSchema, row.organization_id) ||
    !isSchemaValue(DomainEventNameSchema, row.event_type) ||
    !isSchemaValue(SchemaVersionSchema, row.schema_version) ||
    !isKnownEventVersion(row.event_type, row.schema_version) ||
    !isSchemaValue(DomainAggregateTypeSchema, row.aggregate_type) ||
    row.aggregate_type !== expectedAggregateType(row.event_type) ||
    !isSchemaValue(UuidV7Schema, row.aggregate_id) ||
    !isSchemaValue(CorrelationIdSchema, row.correlation_id) ||
    (row.causation_id !== null && !isSchemaValue(CausationIdSchema, row.causation_id)) ||
    !isValidDate(row.locked_until) ||
    !Number.isSafeInteger(row.attempt_number) ||
    row.attempt_number < 1
  ) {
    throw new OutboxRelayValidationError();
  }

  return Object.freeze({
    outboxEventId: row.outbox_event_id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    leaseToken: requireLeaseToken(row.lease_token),
    lockedUntil: row.locked_until,
    attemptNumber: row.attempt_number,
  });
};

export const createOutboxDispatcherId = (value: string): OutboxDispatcherId => {
  if (!DISPATCHER_ID_PATTERN.test(value)) {
    throw new OutboxRelayValidationError();
  }
  return value as OutboxDispatcherId;
};

const isExpectedRuntimeError = (
  error: unknown,
): error is OutboxRelayRoleError | OutboxRelayRuntimeClosedError | OutboxRelayValidationError =>
  error instanceof OutboxRelayRoleError ||
  error instanceof OutboxRelayRuntimeClosedError ||
  error instanceof OutboxRelayValidationError;

class OutboxRelayDatabaseRuntimeImplementation implements OutboxRelayDatabaseRuntime {
  readonly #pool: Pool;
  #closed = false;

  constructor(
    configuration: QueueDatabaseRuntimeConfig,
    observability: OutboxRelayDatabaseRuntimeObservability,
  ) {
    this.#pool = new Pool({
      connectionString: configuration.connectionString,
      connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
      max: configuration.maxConnections,
    });
    this.#pool.on("error", observability.onUnexpectedPoolError);
    Object.freeze(this);
  }

  async #withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.#closed) {
      throw new OutboxRelayRuntimeClosedError();
    }
    const client = await this.#pool.connect().catch((error: unknown) => {
      const mapped = new OutboxRelayDatabaseError();
      outboxRelayDatabaseCauses.set(mapped, error);
      throw mapped;
    });
    try {
      const role = await client.query<DatabaseRoleRow>("select current_user as database_role");
      if (role.rows[0]?.database_role !== REQUIRED_OUTBOX_RELAY_ROLE) {
        throw new OutboxRelayRoleError();
      }
      return await operation(client);
    } catch (error) {
      if (isExpectedRuntimeError(error) || error instanceof OutboxRelayDatabaseError) {
        throw error;
      }
      const mapped = new OutboxRelayDatabaseError();
      outboxRelayDatabaseCauses.set(mapped, error);
      throw mapped;
    } finally {
      client.release();
    }
  }

  async claimBatch(input: OutboxClaimBatchInput): Promise<readonly OutboxRelayClaim[]> {
    if (!DISPATCHER_ID_PATTERN.test(input.dispatcherId)) {
      throw new OutboxRelayValidationError();
    }
    const batchSize = requireBoundedInteger(
      input.batchSize ?? OUTBOX_RELAY_MAX_BATCH_SIZE,
      OUTBOX_RELAY_MAX_BATCH_SIZE,
    );
    const leaseSeconds = requireBoundedInteger(
      input.leaseSeconds ?? OUTBOX_RELAY_DEFAULT_LEASE_SECONDS,
      OUTBOX_RELAY_MAX_LEASE_SECONDS,
    );

    return await this.#withClient(async (client) => {
      const result = await client.query<OutboxRelayClaimRow>(
        "select * from app.claim_outbox_events($1::varchar, $2::integer, $3::integer)",
        [input.dispatcherId, batchSize, leaseSeconds],
      );
      return Object.freeze(result.rows.map(mapClaim));
    });
  }

  async renewLease(input: OutboxLeaseRenewalInput): Promise<Date | null> {
    requireLeaseInput(input);
    const leaseSeconds = requireBoundedInteger(
      input.leaseSeconds ?? OUTBOX_RELAY_DEFAULT_LEASE_SECONDS,
      OUTBOX_RELAY_MAX_LEASE_SECONDS,
    );
    return await this.#withClient(async (client) => {
      const result = await client.query<{ renewed_until: Date | null }>(
        `select app.renew_outbox_event_lease(
          $1::uuid, $2::uuid, $3::uuid, $4::integer
        ) as renewed_until`,
        [input.organizationId, input.outboxEventId, input.leaseToken, leaseSeconds],
      );
      const renewedUntil = result.rows[0]?.renewed_until;
      if (renewedUntil !== null && !isValidDate(renewedUntil)) {
        throw new OutboxRelayValidationError();
      }
      return renewedUntil ?? null;
    });
  }

  async releaseForRetry(input: OutboxRetryReleaseInput): Promise<boolean> {
    requireLeaseInput(input);
    if (!isValidDate(input.availableAt) || !isRetryErrorCategory(input.errorCategory)) {
      throw new OutboxRelayValidationError();
    }
    return await this.#withClient(async (client) => {
      const result = await client.query<{ released: boolean }>(
        `select app.release_outbox_event_for_retry(
          $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::varchar
        ) as released`,
        [
          input.organizationId,
          input.outboxEventId,
          input.leaseToken,
          input.availableAt,
          input.errorCategory,
        ],
      );
      return result.rows[0]?.released === true;
    });
  }

  async markPublished(input: OutboxLeaseInput): Promise<OutboxPublicationResult> {
    requireLeaseInput(input);
    return await this.#withClient(async (client) => {
      const result = await client.query<{ publication_result: string }>(
        `select app.mark_outbox_event_published(
          $1::uuid, $2::uuid, $3::uuid
        ) as publication_result`,
        [input.organizationId, input.outboxEventId, input.leaseToken],
      );
      const publicationResult = result.rows[0]?.publication_result;
      if (
        publicationResult !== "published" &&
        publicationResult !== "already_published" &&
        publicationResult !== "lease_lost"
      ) {
        throw new OutboxRelayValidationError();
      }
      return publicationResult;
    });
  }

  async markDeadLettered(input: OutboxDeadLetterInput): Promise<boolean> {
    requireLeaseInput(input);
    if (!isRelayErrorCategory(input.errorCategory)) {
      throw new OutboxRelayValidationError();
    }
    return await this.#withClient(async (client) => {
      const result = await client.query<{ dead_lettered: boolean }>(
        `select app.mark_outbox_event_dead_lettered(
          $1::uuid, $2::uuid, $3::uuid, $4::varchar
        ) as dead_lettered`,
        [input.organizationId, input.outboxEventId, input.leaseToken, input.errorCategory],
      );
      return result.rows[0]?.dead_lettered === true;
    });
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#pool.end();
  }
}

export const createOutboxRelayDatabaseRuntime = (
  configuration: QueueDatabaseRuntimeConfig,
  observability: OutboxRelayDatabaseRuntimeObservability,
): OutboxRelayDatabaseRuntime =>
  new OutboxRelayDatabaseRuntimeImplementation(configuration, observability);
