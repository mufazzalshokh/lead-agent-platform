import {
  AggregateVersionSchema,
  AppointmentRequestIdSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  CurrencyCodeSchema,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  PageSizeSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type AggregateVersion,
  type AppointmentRequestId,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type CurrencyCode,
  type HandoffId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type OrganizationId,
  type PageSize,
  type ResourceId,
  type ServiceId,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import type { QueryResultRow } from "pg";

import {
  TenantContextInitializationError,
  TenantContextMismatchError,
  TenantDatabaseRuntimeClosedError,
  TenantRuntimeRoleError,
  TenantSessionClosedError,
  TenantTransactionRollbackError,
  classifyPostgreSqlError,
  type PostgreSqlErrorClassification,
} from "../runtime/errors.js";
import {
  executeTenantQuery,
  type TenantDbSession,
  type TenantParameterizedQuery,
} from "../runtime/tenant.js";

export type RepositoryResource =
  | "appointment_request"
  | "business_policy"
  | "channel_connection"
  | "contact"
  | "conversation"
  | "handoff"
  | "lead"
  | "location"
  | "location_version"
  | "membership"
  | "notification"
  | "organization"
  | "retention_policy"
  | "service"
  | "service_version"
  | "widget_session";

export class RepositoryNotFoundError extends Error {
  readonly code = "repository_not_found" as const;
  readonly resource: RepositoryResource;

  constructor(resource: RepositoryResource) {
    super("Resource was not found in the current tenant");
    this.name = "RepositoryNotFoundError";
    this.resource = resource;
  }
}

export class InvalidRepositoryQueryError extends Error {
  readonly code = "invalid_repository_query" as const;

  constructor() {
    super("Repository query parameters are invalid");
    this.name = "InvalidRepositoryQueryError";
  }
}

export class RepositoryDataIntegrityError extends Error {
  readonly code = "repository_data_integrity_error" as const;

  constructor() {
    super("Persisted repository data is invalid");
    this.name = "RepositoryDataIntegrityError";
  }
}

export class RepositoryDatabaseError extends Error {
  readonly code = "repository_database_error" as const;
  readonly classification: PostgreSqlErrorClassification;

  constructor(classification: PostgreSqlErrorClassification) {
    super("Repository database operation failed");
    this.name = "RepositoryDatabaseError";
    this.classification = classification;
  }
}

const repositoryDatabaseCauses = new WeakMap<RepositoryDatabaseError, unknown>();

const isExpectedRepositoryError = (
  error: unknown,
): error is
  | InvalidRepositoryQueryError
  | RepositoryDataIntegrityError
  | RepositoryDatabaseError
  | RepositoryNotFoundError =>
  error instanceof InvalidRepositoryQueryError ||
  error instanceof RepositoryDataIntegrityError ||
  error instanceof RepositoryDatabaseError ||
  error instanceof RepositoryNotFoundError;

const isTenantRuntimeError = (
  error: unknown,
): error is
  | TenantContextInitializationError
  | TenantContextMismatchError
  | TenantDatabaseRuntimeClosedError
  | TenantRuntimeRoleError
  | TenantSessionClosedError
  | TenantTransactionRollbackError =>
  error instanceof TenantContextInitializationError ||
  error instanceof TenantContextMismatchError ||
  error instanceof TenantDatabaseRuntimeClosedError ||
  error instanceof TenantRuntimeRoleError ||
  error instanceof TenantSessionClosedError ||
  error instanceof TenantTransactionRollbackError;

const mapRepositoryFailure = (error: unknown): Error => {
  if (isExpectedRepositoryError(error) || isTenantRuntimeError(error)) {
    return error;
  }
  const mapped = new RepositoryDatabaseError(classifyPostgreSqlError(error));
  repositoryDatabaseCauses.set(mapped, error);
  return mapped;
};

/** Package-internal observability seam; raw database failures are never public error fields. */
export const readRepositoryDatabaseCause = (error: RepositoryDatabaseError): unknown =>
  repositoryDatabaseCauses.get(error);

const TENANT_QUALIFICATION_PATTERN = /\b(?:[a-z][a-z0-9_]*\.)?organization_id\s*=\s*\$1\b/i;
const TENANT_ROOT_QUALIFICATION_PATTERN = /\b(?:[a-z][a-z0-9_]*\.)?id\s*=\s*\$1\b/i;

const requireReadQuery = (query: TenantParameterizedQuery, tenantRoot: boolean): void => {
  if (!/^\s*select\b/i.test(query.text)) {
    throw new InvalidRepositoryQueryError();
  }
  const qualification = tenantRoot
    ? TENANT_ROOT_QUALIFICATION_PATTERN
    : TENANT_QUALIFICATION_PATTERN;
  if (!qualification.test(query.text)) {
    throw new InvalidRepositoryQueryError();
  }
};

const executeBoundRead = async <Row extends QueryResultRow>(
  session: TenantDbSession,
  tenantRoot: boolean,
  createQuery: (organizationId: OrganizationId) => TenantParameterizedQuery,
): Promise<readonly Row[]> => {
  try {
    const result = await executeTenantQuery<Row>(session, (organizationId) => {
      const query = createQuery(organizationId);
      requireReadQuery(query, tenantRoot);
      return query;
    });
    return result.rows;
  } catch (error) {
    throw mapRepositoryFailure(error);
  }
};

export const executeTenantRead = <Row extends QueryResultRow>(
  session: TenantDbSession,
  text: string,
  values: readonly unknown[] = [],
): Promise<readonly Row[]> =>
  executeBoundRead(session, false, (organizationId) => ({
    text,
    values: [organizationId, ...values],
  }));

export const executeTenantRootRead = <Row extends QueryResultRow>(
  session: TenantDbSession,
  text: string,
  values: readonly unknown[] = [],
): Promise<readonly Row[]> =>
  executeBoundRead(session, true, (organizationId) => ({
    text,
    values: [organizationId, ...values],
  }));

export const requireFound = <Row>(rows: readonly Row[], resource: RepositoryResource): Row => {
  const row = rows[0];
  if (row === undefined) {
    throw new RepositoryNotFoundError(resource);
  }
  return row;
};

export type RepositoryPageRequest<Cursor> = Readonly<{
  after?: Cursor;
  limit?: PageSize;
}>;

export type RepositoryPage<Item, Cursor> = Readonly<{
  items: readonly Item[];
  next: Cursor | null;
}>;

export const resolvePageLimit = (limit: PageSize | undefined): number => {
  const candidate = limit ?? 50;
  if (!isSchemaValue(PageSizeSchema, candidate)) {
    throw new InvalidRepositoryQueryError();
  }
  return candidate;
};

export const createRepositoryPage = <Row, Item, Cursor>(
  rows: readonly Row[],
  limit: number,
  mapRow: (row: Row) => Item,
  createCursor: (item: Item) => Cursor,
): RepositoryPage<Item, Cursor> => {
  const selected = rows.slice(0, limit).map(mapRow);
  const hasMore = rows.length > limit;
  const last = selected.at(-1);
  return Object.freeze({
    items: Object.freeze(selected),
    next: hasMore && last !== undefined ? Object.freeze(createCursor(last)) : null,
  });
};

const invalidPersistedData = (): never => {
  throw new RepositoryDataIntegrityError();
};

export const mapOrganizationId = (value: unknown): OrganizationId =>
  isSchemaValue(OrganizationIdSchema, value) ? value : invalidPersistedData();

export const mapResourceId = (value: unknown): ResourceId =>
  isSchemaValue(ResourceIdSchema, value) ? value : invalidPersistedData();

export const mapMembershipId = (value: unknown): MembershipId =>
  isSchemaValue(MembershipIdSchema, value) ? value : invalidPersistedData();

export const mapLocationId = (value: unknown): LocationId =>
  isSchemaValue(LocationIdSchema, value) ? value : invalidPersistedData();

export const mapServiceId = (value: unknown): ServiceId =>
  isSchemaValue(ServiceIdSchema, value) ? value : invalidPersistedData();

export const mapChannelConnectionId = (value: unknown): ChannelConnectionId =>
  isSchemaValue(ChannelConnectionIdSchema, value) ? value : invalidPersistedData();

export const mapContactId = (value: unknown): ContactId =>
  isSchemaValue(ContactIdSchema, value) ? value : invalidPersistedData();

export const mapLeadId = (value: unknown): LeadId =>
  isSchemaValue(LeadIdSchema, value) ? value : invalidPersistedData();

export const mapConversationId = (value: unknown): ConversationId =>
  isSchemaValue(ConversationIdSchema, value) ? value : invalidPersistedData();

export const mapMessageId = (value: unknown): MessageId =>
  isSchemaValue(MessageIdSchema, value) ? value : invalidPersistedData();

export const mapAppointmentRequestId = (value: unknown): AppointmentRequestId =>
  isSchemaValue(AppointmentRequestIdSchema, value) ? value : invalidPersistedData();

export const mapHandoffId = (value: unknown): HandoffId =>
  isSchemaValue(HandoffIdSchema, value) ? value : invalidPersistedData();

export const mapAggregateVersion = (value: unknown): AggregateVersion => {
  const candidate = mapSafeBigInt(value);
  return isSchemaValue(AggregateVersionSchema, candidate) ? candidate : invalidPersistedData();
};

export const mapPositiveInteger = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : invalidPersistedData();

export const mapNonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidPersistedData();

export const mapSafeBigInt = (value: unknown): number => {
  let candidate: unknown = value;
  if (typeof value === "bigint") {
    candidate = Number(value);
  } else if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    try {
      candidate = Number(BigInt(value));
    } catch {
      return invalidPersistedData();
    }
  }
  return typeof candidate === "number" && Number.isSafeInteger(candidate)
    ? candidate
    : invalidPersistedData();
};

export const mapUtcTimestamp = (value: unknown): UtcTimestamp => {
  const candidate = value instanceof Date ? value.toISOString() : value;
  return isSchemaValue(UtcTimestampSchema, candidate) ? candidate : invalidPersistedData();
};

export const mapNullableUtcTimestamp = (value: unknown): UtcTimestamp | null =>
  value === null ? null : mapUtcTimestamp(value);

export const mapCurrencyCode = (value: unknown): CurrencyCode =>
  isSchemaValue(CurrencyCodeSchema, value) ? value : invalidPersistedData();

export const mapBytes = (value: unknown): Uint8Array =>
  value instanceof Uint8Array ? Uint8Array.from(value) : invalidPersistedData();

export const mapNullableBytes = (value: unknown): Uint8Array | null =>
  value === null ? null : mapBytes(value);

export const mapString = (value: unknown): string =>
  typeof value === "string" ? value : invalidPersistedData();

export const mapBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidPersistedData();

export const mapEnum = <Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
): Values[number] => {
  const match = allowed.find((candidate) => candidate === value);
  return match ?? invalidPersistedData();
};

export const mapNullableString = (value: unknown): string | null =>
  value === null ? null : mapString(value);

export const mapNullableIdentifier = (value: unknown): ResourceId | null =>
  value === null ? null : mapResourceId(value);

export const mapJsonObject = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidPersistedData();
  }
  return Object.freeze({ ...value });
};

export type LocaleMap = Readonly<Partial<Record<"en" | "ru" | "uz", string>>>;

export const mapLocaleMap = (value: unknown): LocaleMap => {
  const mapped = mapJsonObject(value);
  for (const [key, entry] of Object.entries(mapped)) {
    if ((key !== "en" && key !== "ru" && key !== "uz") || typeof entry !== "string") {
      return invalidPersistedData();
    }
  }
  return mapped;
};

export const mapStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? Object.freeze([...value])
    : invalidPersistedData();

export const requireLookupHash = (value: Uint8Array): Uint8Array => {
  if (value.byteLength < 16 || value.byteLength > 128) {
    throw new InvalidRepositoryQueryError();
  }
  return Uint8Array.from(value);
};

export const requireLocalDateRange = (fromInclusive: string, toExclusive: string): void => {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const from = Date.parse(`${fromInclusive}T00:00:00Z`);
  const to = Date.parse(`${toExclusive}T00:00:00Z`);
  const maximumRangeMilliseconds = 366 * 24 * 60 * 60 * 1000;
  if (
    !pattern.test(fromInclusive) ||
    !pattern.test(toExclusive) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > maximumRangeMilliseconds
  ) {
    throw new InvalidRepositoryQueryError();
  }
};
