import {
  DomainEventNameSchema,
  DomainEventSchemasByVersion,
  EventIdSchema,
  OrganizationIdSchema,
  SchemaVersionSchema,
  isSchemaValue,
  type DomainEvent,
  type EventId,
  type LeadReopenedDomainEventV2,
} from "@lead-agent/contracts";
import type { QueryResultRow } from "pg";

import { executeTenantRead } from "./shared.js";
import {
  withTenantTransaction,
  type TenantDatabaseRuntime,
  type TenantDbSession,
} from "../runtime/tenant.js";

export type CanonicalOutboxEvent = DomainEvent | LeadReopenedDomainEventV2;

export type TenantCanonicalOutboxEventSource = Readonly<{
  loadCanonicalEvent: (
    organizationId: string,
    outboxEventId: string,
  ) => Promise<CanonicalOutboxEvent>;
}>;

export class CanonicalOutboxEventNotFoundError extends Error {
  readonly code = "canonical_outbox_event_not_found" as const;

  constructor() {
    super("Canonical outbox event was not found in the current tenant");
    this.name = "CanonicalOutboxEventNotFoundError";
  }
}

export class CanonicalOutboxEventIntegrityError extends Error {
  readonly code = "canonical_outbox_event_integrity_error" as const;

  constructor() {
    super("Persisted canonical outbox event failed integrity validation");
    this.name = "CanonicalOutboxEventIntegrityError";
  }
}

type CanonicalOutboxEventRow = QueryResultRow & {
  aggregate_id: unknown;
  aggregate_type: unknown;
  aggregate_version: unknown;
  causation_id: unknown;
  correlation_id: unknown;
  event_type: unknown;
  id: unknown;
  occurred_at: unknown;
  organization_id: unknown;
  payload_jsonb: unknown;
  schema_version: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeBigInt = (value: unknown): bigint | undefined => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^[1-9][0-9]*$/u.test(value)) return BigInt(value);
  return undefined;
};

const asCanonicalEvent = (row: CanonicalOutboxEventRow): CanonicalOutboxEvent => {
  if (
    !isSchemaValue(EventIdSchema, row.id) ||
    !isSchemaValue(DomainEventNameSchema, row.event_type) ||
    !isSchemaValue(SchemaVersionSchema, row.schema_version) ||
    !isRecord(row.payload_jsonb)
  ) {
    throw new CanonicalOutboxEventIntegrityError();
  }

  const schema: unknown = Reflect.get(
    DomainEventSchemasByVersion[row.event_type],
    row.schema_version,
  );
  if (typeof schema !== "object" || schema === null || !isSchemaValue(schema, row.payload_jsonb)) {
    throw new CanonicalOutboxEventIntegrityError();
  }

  const event = row.payload_jsonb;
  const aggregateVersion = normalizeBigInt(row.aggregate_version);
  const eventAggregateVersion = normalizeBigInt(event["aggregate_version"]);
  const eventOccurredAt = new Date(String(event["occurred_at"]));
  if (
    event["event_id"] !== row.id ||
    event["organization_id"] !== row.organization_id ||
    event["event_type"] !== row.event_type ||
    event["schema_version"] !== row.schema_version ||
    event["aggregate_type"] !== row.aggregate_type ||
    event["aggregate_id"] !== row.aggregate_id ||
    aggregateVersion === undefined ||
    eventAggregateVersion === undefined ||
    eventAggregateVersion !== aggregateVersion ||
    event["correlation_id"] !== row.correlation_id ||
    event["causation_id"] !== row.causation_id ||
    !(row.occurred_at instanceof Date) ||
    !Number.isFinite(eventOccurredAt.getTime()) ||
    eventOccurredAt.getTime() !== row.occurred_at.getTime()
  ) {
    throw new CanonicalOutboxEventIntegrityError();
  }

  return Object.freeze(event) as CanonicalOutboxEvent;
};

/**
 * Loads one canonical event through a tenant-bound transaction. This is not a
 * relay discovery/listing API; cross-tenant IDs deliberately look absent.
 */
export const loadCanonicalOutboxEvent = async (
  session: TenantDbSession,
  outboxEventId: EventId,
): Promise<CanonicalOutboxEvent> => {
  if (!isSchemaValue(EventIdSchema, outboxEventId)) {
    throw new CanonicalOutboxEventIntegrityError();
  }

  const rows = await executeTenantRead<CanonicalOutboxEventRow>(
    session,
    `select id, organization_id, event_type, schema_version, aggregate_type,
            aggregate_id, aggregate_version, payload_jsonb, correlation_id,
            causation_id, occurred_at
       from outbox_events
      where organization_id = $1
        and id = $2`,
    [outboxEventId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new CanonicalOutboxEventNotFoundError();
  }
  if (rows.length !== 1) {
    throw new CanonicalOutboxEventIntegrityError();
  }
  return asCanonicalEvent(row);
};

export const createTenantCanonicalOutboxEventSource = (
  runtime: TenantDatabaseRuntime,
): TenantCanonicalOutboxEventSource =>
  Object.freeze({
    loadCanonicalEvent: async (
      organizationId: string,
      outboxEventId: string,
    ): Promise<CanonicalOutboxEvent> => {
      if (
        !isSchemaValue(OrganizationIdSchema, organizationId) ||
        !isSchemaValue(EventIdSchema, outboxEventId)
      ) {
        throw new CanonicalOutboxEventIntegrityError();
      }
      return await withTenantTransaction(runtime, organizationId, (session) =>
        loadCanonicalOutboxEvent(session, outboxEventId),
      );
    },
  });
