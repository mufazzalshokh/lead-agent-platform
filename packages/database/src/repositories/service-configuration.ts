import {
  isServicePricingMutationReplay,
  type ConfigurationFailureCode,
  type ConfigurationMutation,
  type ConfigurationResult,
  type PreparedServiceEventOperation,
  type PreparedServiceOperation,
  type PriceListPosition,
  type ServiceListPosition,
  type ServicePricingConfigurationStore,
} from "@lead-agent/application";
import {
  DomainEventSchemas,
  ServiceLocationRecordSchema,
  ServicePriceRecordSchema,
  ServiceRootSchema,
  isSchemaValue,
  type DomainEvent,
  type DomainEventFor,
  type LocationId,
  type ResourceId,
  type ResourceVersion,
  type ServiceId,
  type ServiceLocationRecord,
  type ServicePriceRecord,
  type ServicePriceTerms,
  type ServiceRoot,
} from "@lead-agent/contracts";
import { hasPermission, type AuthorizationContext } from "@lead-agent/security";
import type { QueryResultRow } from "pg";

import type { TenantDatabaseRuntime, TenantDbSession } from "../runtime/tenant.js";
import {
  RepositoryDatabaseError,
  RepositoryNotFoundError,
  RepositoryVersionConflictError,
  executeTenantRead,
  executeTenantRootRead,
  executeTenantWrite,
  mapAggregateVersion,
  mapCurrencyCode,
  mapEnum,
  mapLocaleMap,
  mapLocationId,
  mapNullableIdentifier,
  mapNullableUtcTimestamp,
  mapPositiveInteger,
  mapResourceId,
  mapSafeBigInt,
  mapServiceId,
  mapString,
  mapUtcTimestamp,
  readRepositoryDatabaseCause,
} from "./shared.js";

type ServicePublishedEvent = DomainEventFor<"service.published">;
type ServiceDeactivatedEvent = DomainEventFor<"service.deactivated">;
type ServicePricePublishedEvent = DomainEventFor<"service_price.published">;
type ServiceMutation = ConfigurationMutation<
  ServiceLocationRecord | ServicePriceRecord | ServiceRoot
>;
type StoreFailureCode = Exclude<ConfigurationFailureCode, "rate_limited">;

export interface ServiceConfigurationReplayProtector {
  /** Must provide authenticated encryption and bind ciphertext to the supplied operation scope. */
  protect(scope: string, plaintext: Uint8Array): Uint8Array;
  reveal(scope: string, ciphertext: Uint8Array): Uint8Array;
}

class ServiceConfigurationPermissionError extends Error {}
class ServiceConfigurationValidationError extends Error {}
class ServiceConfigurationBusinessRuleError extends Error {}
class ServiceConfigurationIdempotencyError extends Error {}
class ServiceConfigurationReplayError extends Error {}

const resultFailure = <Value>(code: StoreFailureCode): ConfigurationResult<Value> =>
  Object.freeze({ error: Object.freeze({ code }), ok: false });

const resultSuccess = <Value>(value: Value): ConfigurationResult<Value> =>
  Object.freeze({ ok: true, value });

const readConstraint = (error: RepositoryDatabaseError): string | undefined => {
  const cause = readRepositoryDatabaseCause(error);
  if (typeof cause !== "object" || cause === null) return undefined;
  const value = Reflect.get(cause, "constraint") as unknown;
  return typeof value === "string" ? value : undefined;
};

const BUSINESS_CONSTRAINTS = new Set([
  "services_organization_id_code_unique",
  "service_locations_no_active_overlap_excl",
  "service_locations_effective_interval_check",
  "service_prices_effective_interval_check",
  "service_prices_no_published_overlap_excl",
  "service_prices_scope_currency_version_unique",
]);

const mapExpectedFailure = <Value>(error: unknown): ConfigurationResult<Value> => {
  if (error instanceof ServiceConfigurationPermissionError)
    return resultFailure("permission_denied");
  if (error instanceof ServiceConfigurationValidationError)
    return resultFailure("validation_failed");
  if (error instanceof ServiceConfigurationBusinessRuleError) {
    return resultFailure("business_rule_failed");
  }
  if (error instanceof ServiceConfigurationIdempotencyError) {
    return resultFailure("idempotency_conflict");
  }
  if (error instanceof RepositoryNotFoundError) return resultFailure("resource_not_found");
  if (error instanceof RepositoryVersionConflictError) return resultFailure("version_conflict");
  if (error instanceof RepositoryDatabaseError) {
    const constraint = readConstraint(error);
    if (constraint !== undefined && BUSINESS_CONSTRAINTS.has(constraint)) {
      return resultFailure("business_rule_failed");
    }
    if (error.classification.code === "transaction_conflict") {
      return resultFailure("version_conflict");
    }
  }
  throw error;
};

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const requireCurrentActor = async (
  session: TenantDbSession,
  authorization: AuthorizationContext,
  permission: "configuration.publish" | "configuration.read" | "configuration.write",
): Promise<void> => {
  type ActorRow = QueryResultRow & {
    location_scope: unknown;
    role: unknown;
    status: unknown;
    user_id: unknown;
  };
  const rows = await executeTenantRead<ActorRow>(
    session,
    `select user_id, role, status, location_scope
       from memberships
      where organization_id = $1 and id = $2`,
    [authorization.membershipId],
  );
  const actor = rows[0];
  if (
    actor === undefined ||
    actor.user_id !== authorization.userId ||
    actor.status !== "active" ||
    actor.role !== authorization.role ||
    actor.location_scope !== authorization.locationScope ||
    !hasPermission(actor.role, permission)
  ) {
    throw new ServiceConfigurationPermissionError();
  }
  if (authorization.locationScope === "restricted") {
    type ScopeRow = QueryResultRow & { location_id: unknown };
    const scopeRows = await executeTenantRead<ScopeRow>(
      session,
      `select location_id::text as location_id
         from membership_location_scopes
        where organization_id = $1 and membership_id = $2
        order by location_id`,
      [authorization.membershipId],
    );
    const actual = scopeRows.map((row) => mapLocationId(row.location_id)).sort();
    const expected = [...authorization.allowedLocationIds].sort();
    if (!sameStrings(actual, expected)) throw new ServiceConfigurationPermissionError();
  }
};

type ServiceRow = QueryResultRow & {
  code: unknown;
  content_hash: unknown;
  current_version_id: unknown;
  description_i18n: unknown;
  disclaimer_i18n: unknown;
  duration_guidance_minutes: unknown;
  id: unknown;
  name_i18n: unknown;
  published_at: unknown;
  published_by_user_id: unknown;
  status: unknown;
  version: unknown;
  version_id: unknown;
  version_no: unknown;
};

const SERVICE_SELECT = `select s.id, s.code, s.status, s.current_version_id, s.version,
       sv.id as version_id, sv.version_no, sv.name_i18n, sv.description_i18n,
       sv.disclaimer_i18n, sv.duration_guidance_minutes, sv.published_at,
       sv.published_by_user_id, encode(sv.content_hash, 'hex') as content_hash
  from services s
  left join service_versions sv
    on sv.organization_id = s.organization_id
   and sv.service_id = s.id
   and sv.id = s.current_version_id`;

const serviceFromRow = (row: ServiceRow): ServiceRoot => {
  const serviceId = mapServiceId(row.id);
  const versionId = mapNullableIdentifier(row.version_id);
  const currentVersion =
    versionId === null
      ? null
      : Object.freeze({
          description_i18n: mapLocaleMap(row.description_i18n),
          disclaimer_i18n: mapLocaleMap(row.disclaimer_i18n),
          duration_guidance_minutes:
            row.duration_guidance_minutes === null
              ? null
              : mapPositiveInteger(row.duration_guidance_minutes),
          name_i18n: mapLocaleMap(row.name_i18n),
          provenance: Object.freeze({
            content_hash: mapString(row.content_hash),
            published_at: mapUtcTimestamp(row.published_at),
            published_by_user_id: mapResourceId(row.published_by_user_id),
            record_id: versionId,
            version_no: mapPositiveInteger(row.version_no),
          }),
          service_id: serviceId,
        });
  const value = Object.freeze({
    code: mapString(row.code),
    current_version: currentVersion,
    service_id: serviceId,
    status: mapEnum(row.status, ["active", "inactive"] as const),
    version: mapAggregateVersion(row.version),
  });
  if (!isSchemaValue(ServiceRootSchema, value)) throw new ServiceConfigurationReplayError();
  return value;
};

const loadService = async (
  session: TenantDbSession,
  serviceId: ServiceId,
  allowedLocationIds?: readonly LocationId[],
  readAt?: string,
): Promise<ServiceRoot> => {
  const scoped = allowedLocationIds !== undefined;
  const rows = await executeTenantRead<ServiceRow>(
    session,
    `${SERVICE_SELECT}
      where s.organization_id = $1 and s.id = $2
        and (not $3::boolean or exists (
          select 1 from service_locations sl
           where sl.organization_id = s.organization_id and sl.service_id = s.id
             and sl.location_id = any($4::uuid[]) and sl.status = 'active'
             and sl.effective_from <= $5::timestamptz
             and (sl.effective_to is null or sl.effective_to > $5::timestamptz)))`,
    [serviceId, scoped, allowedLocationIds ?? null, readAt ?? new Date(0).toISOString()],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("service");
  return serviceFromRow(row);
};

type PriceRow = QueryResultRow & {
  created_at: unknown;
  currency: unknown;
  display_text_i18n: unknown;
  effective_from: unknown;
  effective_to: unknown;
  id: unknown;
  location_id: unknown;
  max_amount_minor: unknown;
  min_amount_minor: unknown;
  price_type: unknown;
  published_by_user_id: unknown;
  service_id: unknown;
  status: unknown;
  version_no: unknown;
};

const PRICE_SELECT = `select sp.id, sp.service_id, sp.location_id, sp.price_type, sp.currency,
       sp.min_amount_minor, sp.max_amount_minor, sp.display_text_i18n,
       sp.effective_from, sp.effective_to, sp.status, sp.version_no,
       sp.published_by_user_id, sp.created_at
  from service_prices sp`;

const pricingFromRow = (row: PriceRow): ServicePriceTerms => {
  const priceType = mapEnum(row.price_type, ["fixed", "from", "range", "quote_required"] as const);
  const currency = mapCurrencyCode(row.currency);
  if (priceType === "quote_required") return Object.freeze({ currency, price_type: priceType });
  const minimum = mapSafeBigInt(row.min_amount_minor);
  if (priceType === "fixed") {
    return Object.freeze({
      amount: Object.freeze({ amount_minor: minimum, currency }),
      price_type: priceType,
    });
  }
  if (priceType === "from") {
    return Object.freeze({
      minimum: Object.freeze({ amount_minor: minimum, currency }),
      price_type: priceType,
    });
  }
  return Object.freeze({
    maximum: Object.freeze({ amount_minor: mapSafeBigInt(row.max_amount_minor), currency }),
    minimum: Object.freeze({ amount_minor: minimum, currency }),
    price_type: priceType,
  });
};

const priceFromRow = (row: PriceRow): ServicePriceRecord => {
  const value = Object.freeze({
    created_at: mapUtcTimestamp(row.created_at),
    display_text_i18n: mapLocaleMap(row.display_text_i18n),
    effective_from: mapNullableUtcTimestamp(row.effective_from),
    effective_to: mapNullableUtcTimestamp(row.effective_to),
    location_id: row.location_id === null ? null : mapLocationId(row.location_id),
    price_id: mapResourceId(row.id),
    pricing: pricingFromRow(row),
    published_by_user_id:
      row.published_by_user_id === null ? null : mapResourceId(row.published_by_user_id),
    service_id: mapServiceId(row.service_id),
    status: mapEnum(row.status, ["draft", "published", "retired"] as const),
    version_no: mapPositiveInteger(row.version_no),
  });
  if (!isSchemaValue(ServicePriceRecordSchema, value)) {
    throw new ServiceConfigurationReplayError();
  }
  return value;
};

const loadPrice = async (
  session: TenantDbSession,
  priceId: ResourceId,
  authorization?: AuthorizationContext,
  readAt?: string,
  lock = false,
): Promise<ServicePriceRecord> => {
  const restricted = authorization?.locationScope === "restricted";
  const allowed = restricted ? authorization.allowedLocationIds : null;
  const rows = await executeTenantRead<PriceRow>(
    session,
    `${PRICE_SELECT}
      where sp.organization_id = $1 and sp.id = $2
        and (not $3::boolean
          or sp.location_id = any($4::uuid[])
          or (sp.location_id is null and exists (
            select 1 from service_locations sl
             where sl.organization_id = sp.organization_id and sl.service_id = sp.service_id
               and sl.location_id = any($4::uuid[]) and sl.status = 'active'
               and sl.effective_from <= $5::timestamptz
               and (sl.effective_to is null or sl.effective_to > $5::timestamptz))))
      ${lock ? "for update" : ""}`,
    [priceId, restricted, allowed, readAt ?? new Date(0).toISOString()],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("service");
  return priceFromRow(row);
};

const loadServiceLocation = async (
  session: TenantDbSession,
  serviceId: ServiceId,
  locationId: LocationId,
  effectiveFrom: string,
): Promise<ServiceLocationRecord> => {
  type Row = QueryResultRow & {
    effective_from: unknown;
    effective_to: unknown;
    location_id: unknown;
    service_id: unknown;
    status: unknown;
  };
  const rows = await executeTenantRead<Row>(
    session,
    `select service_id, location_id, status, effective_from, effective_to
       from service_locations
      where organization_id = $1 and service_id = $2 and location_id = $3
        and effective_from = $4::timestamptz`,
    [serviceId, locationId, effectiveFrom],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("service");
  const value = Object.freeze({
    effective_from: mapUtcTimestamp(row.effective_from),
    effective_to: mapNullableUtcTimestamp(row.effective_to),
    location_id: mapLocationId(row.location_id),
    service_id: mapServiceId(row.service_id),
    status: mapEnum(row.status, ["active", "inactive"] as const),
  });
  if (!isSchemaValue(ServiceLocationRecordSchema, value)) {
    throw new ServiceConfigurationReplayError();
  }
  return value;
};

type ServiceLock = Readonly<{
  currentVersionId: ResourceId | null;
  status: "active" | "inactive";
  version: ResourceVersion;
}>;

const lockService = async (
  session: TenantDbSession,
  serviceId: ServiceId,
  expectedVersion: ResourceVersion,
): Promise<ServiceLock> => {
  type Row = QueryResultRow & {
    current_version_id: unknown;
    status: unknown;
    version: unknown;
  };
  const rows = await executeTenantRead<Row>(
    session,
    `select current_version_id, status, version
       from services
      where organization_id = $1 and id = $2
      for update`,
    [serviceId],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("service");
  const version = mapAggregateVersion(row.version);
  if (version !== expectedVersion) {
    throw new RepositoryVersionConflictError("service", version);
  }
  return Object.freeze({
    currentVersionId: mapNullableIdentifier(row.current_version_id),
    status: mapEnum(row.status, ["active", "inactive"] as const),
    version,
  });
};

const requireActiveLocation = async (
  session: TenantDbSession,
  locationId: LocationId,
): Promise<void> => {
  type Row = QueryResultRow & { current_version_id: unknown; status: unknown };
  const rows = await executeTenantRead<Row>(
    session,
    `select status, current_version_id
       from locations
      where organization_id = $1 and id = $2`,
    [locationId],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("location");
  if (row.status !== "active" || row.current_version_id === null) {
    throw new ServiceConfigurationBusinessRuleError();
  }
};

const defaultLocale = async (session: TenantDbSession): Promise<"en" | "ru" | "uz"> => {
  type Row = QueryResultRow & { default_locale: unknown };
  const rows = await executeTenantRootRead<Row>(
    session,
    "select default_locale from organizations where id = $1 and status = 'active'",
  );
  const row = rows[0];
  if (row === undefined) throw new ServiceConfigurationBusinessRuleError();
  return mapEnum(row.default_locale, ["en", "ru", "uz"] as const);
};

const requireLocale = (
  locale: "en" | "ru" | "uz",
  ...values: readonly Readonly<Partial<Record<"en" | "ru" | "uz", string>>>[]
): void => {
  if (values.some((value) => value[locale] === undefined)) {
    throw new ServiceConfigurationValidationError();
  }
};

const advanceServiceVersion = async (
  session: TenantDbSession,
  serviceId: ServiceId,
  expectedVersion: ResourceVersion,
  occurredAt: string,
): Promise<ResourceVersion> => {
  type Row = QueryResultRow & { version: unknown };
  const result = await executeTenantWrite<Row>(
    session,
    `update services
        set version = version + 1, updated_at = $3
      where organization_id = $1 and id = $2 and version = $4
      returning version`,
    [serviceId, occurredAt, expectedVersion],
  );
  const row = result.rows[0];
  if (row === undefined || result.rowCount !== 1) {
    throw new RepositoryVersionConflictError("service", expectedVersion);
  }
  return mapAggregateVersion(row.version);
};

const eventBase = (
  input: PreparedServiceEventOperation,
  serviceId: ServiceId,
  aggregateVersion: ResourceVersion,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    actor: Object.freeze({ actor_id: input.authorization.userId, actor_type: "member" as const }),
    aggregate_id: serviceId,
    aggregate_type: "service" as const,
    aggregate_version: aggregateVersion,
    causation_id: null,
    correlation_id: input.correlationId,
    event_id: input.eventId,
    occurred_at: input.occurredAt,
    organization_id: input.authorization.organizationId,
    request_id: input.requestId,
    schema_version: "1",
  });

const servicePublishedEvent = (
  input: PreparedServiceEventOperation,
  serviceId: ServiceId,
  aggregateVersion: ResourceVersion,
  serviceVersion: ResourceVersion,
): ServicePublishedEvent => {
  const event: unknown = Object.freeze({
    ...eventBase(input, serviceId, aggregateVersion),
    event_type: "service.published" as const,
    payload: Object.freeze({ service_version: serviceVersion }),
    schema_id: "ServicePublishedDomainEvent.v1",
  });
  if (!isSchemaValue(DomainEventSchemas["service.published"], event)) {
    throw new ServiceConfigurationReplayError();
  }
  return event;
};

const serviceDeactivatedEvent = (
  input: PreparedServiceEventOperation,
  serviceId: ServiceId,
  aggregateVersion: ResourceVersion,
): ServiceDeactivatedEvent => {
  const event: unknown = Object.freeze({
    ...eventBase(input, serviceId, aggregateVersion),
    event_type: "service.deactivated" as const,
    payload: Object.freeze({ reason_code: "no_longer_offered", service_active: false }),
    schema_id: "ServiceDeactivatedDomainEvent.v1",
  });
  if (!isSchemaValue(DomainEventSchemas["service.deactivated"], event)) {
    throw new ServiceConfigurationReplayError();
  }
  return event;
};

const servicePricePublishedEvent = (
  input: PreparedServiceEventOperation,
  price: ServicePriceRecord,
  aggregateVersion: ResourceVersion,
): ServicePricePublishedEvent => {
  const event: unknown = Object.freeze({
    ...eventBase(input, price.service_id, aggregateVersion),
    event_type: "service_price.published" as const,
    payload: Object.freeze({
      price_type: price.pricing.price_type,
      service_price_id: price.price_id,
    }),
    schema_id: "ServicePricePublishedDomainEvent.v1",
  });
  if (!isSchemaValue(DomainEventSchemas["service_price.published"], event)) {
    throw new ServiceConfigurationReplayError();
  }
  return event;
};

const insertAudit = async (
  session: TenantDbSession,
  input: PreparedServiceOperation,
  action: string,
  targetType: "service" | "service_location" | "service_price",
  targetId: ResourceId | ServiceId,
  metadata: Readonly<Record<string, unknown>>,
): Promise<void> => {
  await executeTenantWrite(
    session,
    `insert into audit_events
      (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,
       impersonation_session_id,support_grant_id,target_type,target_id,action,
       result,reason_code,request_id,trace_id,correlation_id,source_ip_prefix,
       user_agent_hash,metadata_redacted_jsonb,occurred_at)
     values ($1,$2,$3,'member',$4,$5,null,null,$6,$7,$3,'succeeded',null,$8,
       null,$9,null,null,$10::jsonb,$11)`,
    [
      input.auditId,
      action,
      input.authorization.userId,
      input.authorization.membershipId,
      targetType,
      targetId,
      input.requestId,
      input.correlationId,
      JSON.stringify(metadata),
      input.occurredAt,
    ],
  );
};

const insertOutbox = async (session: TenantDbSession, event: DomainEvent): Promise<void> => {
  await executeTenantWrite(
    session,
    `insert into outbox_events
      (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,
       aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,
       status,attempt_count,available_at,locked_by,locked_until,published_at,last_error_category)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'pending',0,$11,
       null,null,null,null)`,
    [
      event.event_id,
      event.event_type,
      event.schema_version,
      event.aggregate_type,
      event.aggregate_id,
      event.aggregate_version,
      JSON.stringify(event),
      event.correlation_id,
      event.causation_id,
      event.occurred_at,
    ],
  );
};

type IdempotencyRow = QueryResultRow & {
  request_hash: unknown;
  response_ciphertext: unknown;
  status: unknown;
};

const bytesEqual = (left: Uint8Array, right: unknown): boolean => {
  if (!(right instanceof Uint8Array) && !Buffer.isBuffer(right)) return false;
  return Buffer.from(left).equals(Buffer.from(right));
};

const reserveIdempotency = async (
  session: TenantDbSession,
  input: PreparedServiceOperation,
): Promise<IdempotencyRow | null> => {
  const inserted = await executeTenantWrite(
    session,
    `insert into idempotency_keys
      (organization_id,id,scope,key_hash,principal_type,principal_id_hash,
       request_hash,status,response_status,response_ciphertext,resource_type,
       resource_id,locked_until,expires_at,created_at,completed_at)
     values ($1,$2,$3,$4,'user',$5,$6,'in_progress',null,null,null,null,$7,$8,$9,null)
     on conflict (organization_id,principal_type,principal_id_hash,scope,key_hash)
     do nothing returning id`,
    [
      input.idempotency.id,
      input.idempotency.scope,
      Buffer.from(input.idempotency.keyHash),
      Buffer.from(input.idempotency.principalIdHash),
      Buffer.from(input.idempotency.requestHash),
      input.idempotency.lockedUntil,
      input.idempotency.expiresAt,
      input.occurredAt,
    ],
  );
  if (inserted.rowCount === 1) return null;
  const rows = await executeTenantRead<IdempotencyRow>(
    session,
    `select request_hash, status, response_ciphertext
       from idempotency_keys
      where organization_id = $1 and principal_type = 'user'
        and principal_id_hash = $2 and scope = $3 and key_hash = $4`,
    [
      Buffer.from(input.idempotency.principalIdHash),
      input.idempotency.scope,
      Buffer.from(input.idempotency.keyHash),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new ServiceConfigurationReplayError();
  if (!bytesEqual(input.idempotency.requestHash, row.request_hash)) {
    throw new ServiceConfigurationIdempotencyError();
  }
  return row;
};

const encodeMutation = (
  protector: ServiceConfigurationReplayProtector,
  scope: string,
  mutation: ServiceMutation,
): Uint8Array => {
  const protectedValue = protector.protect(
    scope,
    new TextEncoder().encode(JSON.stringify(mutation)),
  );
  if (protectedValue.byteLength < 1 || protectedValue.byteLength > 65_536) {
    throw new ServiceConfigurationReplayError();
  }
  return protectedValue;
};

const decodeMutation = (
  protector: ServiceConfigurationReplayProtector,
  scope: string,
  ciphertext: unknown,
  resource: "price" | "service" | "service_location",
): ServiceMutation => {
  if (!(ciphertext instanceof Uint8Array) && !Buffer.isBuffer(ciphertext)) {
    throw new ServiceConfigurationReplayError();
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        protector.reveal(scope, new Uint8Array(ciphertext)),
      ),
    ) as unknown;
  } catch {
    throw new ServiceConfigurationReplayError();
  }
  if (!isServicePricingMutationReplay(value, resource)) {
    throw new ServiceConfigurationReplayError();
  }
  return value;
};

const finalizeIdempotency = async (
  session: TenantDbSession,
  input: PreparedServiceOperation,
  resourceType: "service" | "service_location" | "service_price",
  resourceId: ResourceId | ServiceId,
  responseCiphertext: Uint8Array,
): Promise<void> => {
  const result = await executeTenantWrite(
    session,
    `update idempotency_keys
        set status = 'succeeded', response_status = 200,
            response_ciphertext = $3, resource_type = $4, resource_id = $5,
            locked_until = null, completed_at = $6
      where organization_id = $1 and id = $2 and status = 'in_progress'`,
    [
      input.idempotency.id,
      Buffer.from(responseCiphertext),
      resourceType,
      resourceId,
      input.occurredAt,
    ],
  );
  if (result.rowCount !== 1) throw new ServiceConfigurationReplayError();
};

const idempotentMutation = async <
  Value extends ServiceLocationRecord | ServicePriceRecord | ServiceRoot,
>(
  runtime: TenantDatabaseRuntime,
  protector: ServiceConfigurationReplayProtector,
  input: PreparedServiceOperation,
  permission: "configuration.publish" | "configuration.write",
  replayResource: "price" | "service" | "service_location",
  resourceType: "service" | "service_location" | "service_price",
  resourceId: ResourceId | ServiceId,
  action: (session: TenantDbSession) => Promise<ConfigurationMutation<Value>>,
): Promise<ConfigurationResult<ConfigurationMutation<Value>>> => {
  try {
    return await runtime.withTenantTransaction(
      input.authorization.organizationId,
      async (session) => {
        await requireCurrentActor(session, input.authorization, permission);
        const replay = await reserveIdempotency(session, input);
        if (replay !== null) {
          if (replay.status !== "succeeded") {
            throw new ServiceConfigurationIdempotencyError();
          }
          return resultSuccess(
            decodeMutation(
              protector,
              input.idempotency.scope,
              replay.response_ciphertext,
              replayResource,
            ) as ConfigurationMutation<Value>,
          );
        }
        const mutation = await action(session);
        const ciphertext = encodeMutation(protector, input.idempotency.scope, mutation);
        await finalizeIdempotency(session, input, resourceType, resourceId, ciphertext);
        return resultSuccess(mutation);
      },
    );
  } catch (error) {
    return mapExpectedFailure(error);
  }
};

const priceColumns = (
  pricing: ServicePriceTerms,
): Readonly<{ currency: string; maximum: number | null; minimum: number | null; type: string }> => {
  if (pricing.price_type === "fixed") {
    return Object.freeze({
      currency: pricing.amount.currency,
      maximum: pricing.amount.amount_minor,
      minimum: pricing.amount.amount_minor,
      type: pricing.price_type,
    });
  }
  if (pricing.price_type === "from") {
    return Object.freeze({
      currency: pricing.minimum.currency,
      maximum: null,
      minimum: pricing.minimum.amount_minor,
      type: pricing.price_type,
    });
  }
  if (pricing.price_type === "range") {
    return Object.freeze({
      currency: pricing.minimum.currency,
      maximum: pricing.maximum.amount_minor,
      minimum: pricing.minimum.amount_minor,
      type: pricing.price_type,
    });
  }
  return Object.freeze({
    currency: pricing.currency,
    maximum: null,
    minimum: null,
    type: pricing.price_type,
  });
};

const lockActiveService = async (
  session: TenantDbSession,
  serviceId: ServiceId,
): Promise<ResourceVersion> => {
  type Row = QueryResultRow & {
    current_version_id: unknown;
    status: unknown;
    version: unknown;
  };
  const rows = await executeTenantRead<Row>(
    session,
    `select status, current_version_id, version
       from services
      where organization_id = $1 and id = $2
      for update`,
    [serviceId],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("service");
  if (row.status !== "active" || row.current_version_id === null) {
    throw new ServiceConfigurationBusinessRuleError();
  }
  return mapAggregateVersion(row.version);
};

const requireActiveOffering = async (
  session: TenantDbSession,
  serviceId: ServiceId,
  locationId: LocationId,
  effectiveAt: string,
): Promise<void> => {
  type Row = QueryResultRow & { found: unknown };
  const rows = await executeTenantRead<Row>(
    session,
    `select true as found
       from service_locations
      where organization_id = $1 and service_id = $2 and location_id = $3
        and status = 'active' and effective_from <= $4::timestamptz
        and (effective_to is null or effective_to > $4::timestamptz)
      limit 1`,
    [serviceId, locationId, effectiveAt],
  );
  if (rows[0] === undefined) throw new ServiceConfigurationBusinessRuleError();
};

const nextPriceVersion = async (
  session: TenantDbSession,
  serviceId: ServiceId,
  locationId: LocationId | null,
  currency: string,
  minimum: number,
): Promise<ResourceVersion> => {
  type Row = QueryResultRow & { version_no: unknown };
  const rows = await executeTenantRead<Row>(
    session,
    `select greatest(coalesce(max(version_no), 0) + 1, $5::integer) as version_no
       from service_prices
      where organization_id = $1 and service_id = $2
        and location_id is not distinct from $3::uuid and currency = $4`,
    [serviceId, locationId, currency, minimum],
  );
  const row = rows[0];
  if (row === undefined) throw new ServiceConfigurationReplayError();
  return mapAggregateVersion(row.version_no);
};

export const createServicePricingConfigurationStore = (
  runtime: TenantDatabaseRuntime,
  replayProtector: ServiceConfigurationReplayProtector,
): ServicePricingConfigurationStore => {
  const store: ServicePricingConfigurationStore = {
    createService: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "service",
        "service",
        input.serviceId,
        async (session) => {
          await executeTenantWrite(
            session,
            `insert into services
              (organization_id,id,code,status,current_version_id,version,created_at,updated_at)
             values ($1,$2,$3,'inactive',null,1,$4,$4)`,
            [input.serviceId, input.value.code, input.occurredAt],
          );
          await insertAudit(session, input, "service.created", "service", input.serviceId, {
            code: input.value.code,
            version: 1,
          });
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadService(session, input.serviceId),
          });
        },
      ),

    publishService: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "service",
        "service",
        input.serviceId,
        async (session) => {
          await lockService(session, input.serviceId, input.expectedVersion);
          const locale = await defaultLocale(session);
          requireLocale(
            locale,
            input.value.name_i18n,
            input.value.description_i18n,
            input.value.disclaimer_i18n,
          );
          type VersionRow = QueryResultRow & { version_no: unknown };
          const versionRows = await executeTenantRead<VersionRow>(
            session,
            `select coalesce(max(version_no), 0) + 1 as version_no
               from service_versions
              where organization_id = $1 and service_id = $2`,
            [input.serviceId],
          );
          const versionRow = versionRows[0];
          if (versionRow === undefined) throw new ServiceConfigurationReplayError();
          const serviceVersion = mapAggregateVersion(versionRow.version_no);
          await executeTenantWrite(
            session,
            `insert into service_versions
              (organization_id,id,service_id,version_no,name_i18n,description_i18n,
               duration_guidance_minutes,disclaimer_i18n,content_hash,published_at,
               published_by_user_id,created_at)
             values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$10)`,
            [
              input.versionId,
              input.serviceId,
              serviceVersion,
              JSON.stringify(input.value.name_i18n),
              JSON.stringify(input.value.description_i18n),
              input.value.duration_guidance_minutes,
              JSON.stringify(input.value.disclaimer_i18n),
              Buffer.from(input.contentHash, "hex"),
              input.occurredAt,
              input.authorization.userId,
            ],
          );
          type RootRow = QueryResultRow & { version: unknown };
          const rootResult = await executeTenantWrite<RootRow>(
            session,
            `update services
                set current_version_id = $3, status = 'active', version = version + 1,
                    updated_at = $4
              where organization_id = $1 and id = $2 and version = $5
              returning version`,
            [input.serviceId, input.versionId, input.occurredAt, input.expectedVersion],
          );
          const rootRow = rootResult.rows[0];
          if (rootRow === undefined || rootResult.rowCount !== 1) {
            throw new RepositoryVersionConflictError("service", input.expectedVersion);
          }
          const aggregateVersion = mapAggregateVersion(rootRow.version);
          const event = servicePublishedEvent(
            input,
            input.serviceId,
            aggregateVersion,
            serviceVersion,
          );
          await insertAudit(session, input, "service.published", "service", input.serviceId, {
            expected_version: input.expectedVersion,
            service_version: serviceVersion,
          });
          await insertOutbox(session, event);
          return Object.freeze({
            events: Object.freeze([event]),
            resource: await loadService(session, input.serviceId),
          });
        },
      ),

    deactivateService: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "service",
        "service",
        input.serviceId,
        async (session) => {
          const root = await lockService(session, input.serviceId, input.expectedVersion);
          if (root.status !== "active" || root.currentVersionId === null) {
            throw new ServiceConfigurationBusinessRuleError();
          }
          const aggregateVersion = await advanceServiceVersion(
            session,
            input.serviceId,
            input.expectedVersion,
            input.occurredAt,
          );
          const update = await executeTenantWrite(
            session,
            `update services set status = 'inactive'
              where organization_id = $1 and id = $2 and version = $3`,
            [input.serviceId, aggregateVersion],
          );
          if (update.rowCount !== 1) {
            throw new RepositoryVersionConflictError("service", aggregateVersion);
          }
          const event = serviceDeactivatedEvent(input, input.serviceId, aggregateVersion);
          await insertAudit(session, input, "service.deactivated", "service", input.serviceId, {
            expected_version: input.expectedVersion,
            reason_code: "no_longer_offered",
          });
          await insertOutbox(session, event);
          return Object.freeze({
            events: Object.freeze([event]),
            resource: await loadService(session, input.serviceId),
          });
        },
      ),

    changeServiceLocation: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "service_location",
        "service_location",
        input.serviceId,
        async (session) => {
          const root = await lockService(session, input.serviceId, input.expectedVersion);
          if (root.status !== "active" || root.currentVersionId === null) {
            throw new ServiceConfigurationBusinessRuleError();
          }
          await requireActiveLocation(session, input.value.location_id);
          type RelationRow = QueryResultRow & { effective_from: unknown };
          const activeRows = await executeTenantRead<RelationRow>(
            session,
            `select effective_from
               from service_locations
              where organization_id = $1 and service_id = $2 and location_id = $3
                and status = 'active' and effective_to is null
              for update`,
            [input.serviceId, input.value.location_id],
          );
          const active = activeRows[0];
          if (input.value.status === "active") {
            if (active !== undefined) {
              return Object.freeze({
                events: Object.freeze([]),
                resource: await loadServiceLocation(
                  session,
                  input.serviceId,
                  input.value.location_id,
                  mapUtcTimestamp(active.effective_from),
                ),
              });
            }
            await executeTenantWrite(
              session,
              `insert into service_locations
                (organization_id,service_id,location_id,status,effective_from,effective_to,created_at)
               values ($1,$2,$3,'active',$4,null,$4)`,
              [input.serviceId, input.value.location_id, input.occurredAt],
            );
          } else {
            if (active === undefined) throw new ServiceConfigurationBusinessRuleError();
            const result = await executeTenantWrite(
              session,
              `update service_locations
                  set status = 'inactive', effective_to = $4
                where organization_id = $1 and service_id = $2 and location_id = $3
                  and effective_from = $5::timestamptz and status = 'active'`,
              [
                input.serviceId,
                input.value.location_id,
                input.occurredAt,
                mapUtcTimestamp(active.effective_from),
              ],
            );
            if (result.rowCount !== 1) throw new ServiceConfigurationBusinessRuleError();
          }
          const aggregateVersion = await advanceServiceVersion(
            session,
            input.serviceId,
            input.expectedVersion,
            input.occurredAt,
          );
          await insertAudit(
            session,
            input,
            "service.location_changed",
            "service_location",
            input.serviceId,
            {
              expected_version: input.expectedVersion,
              location_id: input.value.location_id,
              new_version: aggregateVersion,
              status: input.value.status,
            },
          );
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadServiceLocation(
              session,
              input.serviceId,
              input.value.location_id,
              input.value.status === "active"
                ? input.occurredAt
                : mapUtcTimestamp(active?.effective_from),
            ),
          });
        },
      ),

    createPriceDraft: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "price",
        "service_price",
        input.priceId,
        async (session) => {
          const root = await lockService(session, input.serviceId, input.expectedServiceVersion);
          if (root.status !== "active" || root.currentVersionId === null) {
            throw new ServiceConfigurationBusinessRuleError();
          }
          if (input.value.location_id !== null) {
            await requireActiveLocation(session, input.value.location_id);
            await requireActiveOffering(
              session,
              input.serviceId,
              input.value.location_id,
              input.occurredAt,
            );
          }
          const locale = await defaultLocale(session);
          requireLocale(locale, input.value.display_text_i18n);
          const columns = priceColumns(input.value.pricing);
          const version = await nextPriceVersion(
            session,
            input.serviceId,
            input.value.location_id,
            columns.currency,
            1,
          );
          await executeTenantWrite(
            session,
            `insert into service_prices
              (organization_id,id,service_id,location_id,price_type,currency,
               min_amount_minor,max_amount_minor,display_text_i18n,effective_from,
               effective_to,status,version_no,published_by_user_id,created_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,null,null,'draft',$10,null,$11)`,
            [
              input.priceId,
              input.serviceId,
              input.value.location_id,
              columns.type,
              columns.currency,
              columns.minimum,
              columns.maximum,
              JSON.stringify(input.value.display_text_i18n),
              version,
              input.occurredAt,
            ],
          );
          await insertAudit(
            session,
            input,
            "service_price.draft_created",
            "service_price",
            input.priceId,
            {
              expected_service_version: input.expectedServiceVersion,
              location_id: input.value.location_id,
              price_type: input.value.pricing.price_type,
              version,
            },
          );
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadPrice(session, input.priceId),
          });
        },
      ),

    updatePriceDraft: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "price",
        "service_price",
        input.priceId,
        async (session) => {
          const initial = await loadPrice(session, input.priceId);
          await lockActiveService(session, initial.service_id);
          const current = await loadPrice(session, input.priceId, undefined, undefined, true);
          if (current.version_no !== input.expectedVersion) {
            throw new RepositoryVersionConflictError("service", current.version_no);
          }
          if (current.status !== "draft") throw new ServiceConfigurationBusinessRuleError();
          if (input.value.location_id !== null) {
            await requireActiveLocation(session, input.value.location_id);
            await requireActiveOffering(
              session,
              current.service_id,
              input.value.location_id,
              input.occurredAt,
            );
          }
          const locale = await defaultLocale(session);
          requireLocale(locale, input.value.display_text_i18n);
          const columns = priceColumns(input.value.pricing);
          const version = await nextPriceVersion(
            session,
            current.service_id,
            input.value.location_id,
            columns.currency,
            current.version_no + 1,
          );
          const result = await executeTenantWrite(
            session,
            `update service_prices
                set location_id = $3, price_type = $4, currency = $5,
                    min_amount_minor = $6, max_amount_minor = $7,
                    display_text_i18n = $8::jsonb, version_no = $9
              where organization_id = $1 and id = $2 and status = 'draft'
                and version_no = $10`,
            [
              input.priceId,
              input.value.location_id,
              columns.type,
              columns.currency,
              columns.minimum,
              columns.maximum,
              JSON.stringify(input.value.display_text_i18n),
              version,
              input.expectedVersion,
            ],
          );
          if (result.rowCount !== 1) {
            throw new RepositoryVersionConflictError("service", current.version_no);
          }
          await insertAudit(
            session,
            input,
            "service_price.draft_updated",
            "service_price",
            input.priceId,
            { expected_version: input.expectedVersion, new_version: version },
          );
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadPrice(session, input.priceId),
          });
        },
      ),

    publishPrice: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "price",
        "service_price",
        input.priceId,
        async (session) => {
          const initial = await loadPrice(session, input.priceId);
          const serviceVersion = await lockActiveService(session, initial.service_id);
          const current = await loadPrice(session, input.priceId, undefined, undefined, true);
          if (current.version_no !== input.expectedVersion) {
            throw new RepositoryVersionConflictError("service", current.version_no);
          }
          if (current.status !== "draft") throw new ServiceConfigurationBusinessRuleError();
          if (current.location_id !== null) {
            await requireActiveLocation(session, current.location_id);
            await requireActiveOffering(
              session,
              current.service_id,
              current.location_id,
              input.occurredAt,
            );
          }
          const locale = await defaultLocale(session);
          requireLocale(locale, current.display_text_i18n);
          const currency =
            current.pricing.price_type === "quote_required"
              ? current.pricing.currency
              : current.pricing.price_type === "fixed"
                ? current.pricing.amount.currency
                : current.pricing.minimum.currency;
          type PriorPriceRow = QueryResultRow & { effective_from: unknown };
          const priorRows = await executeTenantRead<PriorPriceRow>(
            session,
            `select effective_from
               from service_prices
              where organization_id = $1 and service_id = $2
                and location_id is not distinct from $3::uuid and currency = $4
                and status = 'published'
              for update`,
            [current.service_id, current.location_id, currency],
          );
          const prior = priorRows[0];
          if (
            prior !== undefined &&
            new Date(mapUtcTimestamp(prior.effective_from)).getTime() >=
              new Date(input.occurredAt).getTime()
          ) {
            throw new ServiceConfigurationBusinessRuleError();
          }
          await executeTenantWrite(
            session,
            `update service_prices
                set status = 'retired', effective_to = $5
              where organization_id = $1 and service_id = $2
                and location_id is not distinct from $3::uuid and currency = $4
                and status = 'published'`,
            [current.service_id, current.location_id, currency, input.occurredAt],
          );
          const published = await executeTenantWrite(
            session,
            `update service_prices
                set status = 'published', effective_from = $3, effective_to = null,
                    published_by_user_id = $4
              where organization_id = $1 and id = $2 and status = 'draft'
                and version_no = $5`,
            [input.priceId, input.occurredAt, input.authorization.userId, input.expectedVersion],
          );
          if (published.rowCount !== 1) {
            throw new RepositoryVersionConflictError("service", current.version_no);
          }
          const aggregateVersion = await advanceServiceVersion(
            session,
            current.service_id,
            serviceVersion,
            input.occurredAt,
          );
          const resource = await loadPrice(session, input.priceId);
          const event = servicePricePublishedEvent(input, resource, aggregateVersion);
          await insertAudit(
            session,
            input,
            "service_price.published",
            "service_price",
            input.priceId,
            {
              location_id: resource.location_id,
              price_type: resource.pricing.price_type,
              service_version: aggregateVersion,
              version: resource.version_no,
            },
          );
          await insertOutbox(session, event);
          return Object.freeze({ events: Object.freeze([event]), resource });
        },
      ),

    retirePrice: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "price",
        "service_price",
        input.priceId,
        async (session) => {
          const initial = await loadPrice(session, input.priceId);
          await lockActiveService(session, initial.service_id);
          const current = await loadPrice(session, input.priceId, undefined, undefined, true);
          if (current.version_no !== input.expectedVersion) {
            throw new RepositoryVersionConflictError("service", current.version_no);
          }
          if (current.status === "retired") {
            return Object.freeze({ events: Object.freeze([]), resource: current });
          }
          if (current.status !== "published") throw new ServiceConfigurationBusinessRuleError();
          const result = await executeTenantWrite(
            session,
            `update service_prices
                set status = 'retired', effective_to = $3
              where organization_id = $1 and id = $2 and status = 'published'
                and version_no = $4`,
            [input.priceId, input.occurredAt, input.expectedVersion],
          );
          if (result.rowCount !== 1) throw new ServiceConfigurationBusinessRuleError();
          await insertAudit(
            session,
            input,
            "service_price.retired",
            "service_price",
            input.priceId,
            { version: input.expectedVersion },
          );
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadPrice(session, input.priceId),
          });
        },
      ),

    getService: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            const allowed =
              input.authorization.locationScope === "restricted"
                ? input.authorization.allowedLocationIds
                : undefined;
            return resultSuccess(
              await loadService(session, input.serviceId, allowed, input.readAt),
            );
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },

    listServices: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
              throw new ServiceConfigurationValidationError();
            }
            const restricted = input.authorization.locationScope === "restricted";
            const allowed = restricted ? input.authorization.allowedLocationIds : null;
            if (restricted && allowed?.length === 0) {
              return resultSuccess(Object.freeze({ items: Object.freeze([]), next: null }));
            }
            const rows = await executeTenantRead<ServiceRow>(
              session,
              `${SERVICE_SELECT}
                where s.organization_id = $1
                  and ($2::text is null or s.status = $2)
                  and ($3::text is null or (s.code, s.id) > ($3, $4::uuid))
                  and ($5::uuid is null or exists (
                    select 1 from service_locations sl
                     where sl.organization_id = s.organization_id and sl.service_id = s.id
                       and sl.location_id = $5 and sl.status = 'active'
                       and sl.effective_from <= $6::timestamptz
                       and (sl.effective_to is null or sl.effective_to > $6::timestamptz)))
                  and (not $7::boolean or exists (
                    select 1 from service_locations sl
                     where sl.organization_id = s.organization_id and sl.service_id = s.id
                       and sl.location_id = any($8::uuid[]) and sl.status = 'active'
                       and sl.effective_from <= $6::timestamptz
                       and (sl.effective_to is null or sl.effective_to > $6::timestamptz)))
                order by s.code, s.id
                limit $9`,
              [
                input.status,
                input.after?.code ?? null,
                input.after?.serviceId ?? null,
                input.locationId,
                input.readAt,
                restricted,
                allowed,
                input.limit + 1,
              ],
            );
            const selected = rows.slice(0, input.limit);
            const items = Object.freeze(selected.map((row) => serviceFromRow(row)));
            const last = items.at(-1);
            const next: ServiceListPosition | null =
              rows.length > input.limit && last !== undefined
                ? Object.freeze({ code: last.code, serviceId: last.service_id })
                : null;
            return resultSuccess(Object.freeze({ items, next }));
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },

    getPrice: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            return resultSuccess(
              await loadPrice(session, input.priceId, input.authorization, input.readAt),
            );
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },

    listPrices: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
              throw new ServiceConfigurationValidationError();
            }
            const restricted = input.authorization.locationScope === "restricted";
            const allowed = restricted ? input.authorization.allowedLocationIds : null;
            if (restricted && allowed?.length === 0) {
              return resultSuccess(Object.freeze({ items: Object.freeze([]), next: null }));
            }
            const rows = await executeTenantRead<PriceRow>(
              session,
              `${PRICE_SELECT}
                where sp.organization_id = $1
                  and ($2::text is null or sp.status = $2)
                  and ($3::text is null or sp.price_type = $3)
                  and ($4::timestamptz is null
                    or (sp.created_at, sp.id) < ($4, $5::uuid))
                  and ($6::uuid is null
                    or sp.location_id = $6
                    or (sp.location_id is null and exists (
                      select 1 from service_locations sl
                       where sl.organization_id = sp.organization_id
                         and sl.service_id = sp.service_id and sl.location_id = $6
                         and sl.status = 'active' and sl.effective_from <= $7::timestamptz
                         and (sl.effective_to is null or sl.effective_to > $7::timestamptz))))
                  and (not $8::boolean
                    or sp.location_id = any($9::uuid[])
                    or (sp.location_id is null and exists (
                      select 1 from service_locations sl
                       where sl.organization_id = sp.organization_id
                         and sl.service_id = sp.service_id
                         and sl.location_id = any($9::uuid[]) and sl.status = 'active'
                         and sl.effective_from <= $7::timestamptz
                         and (sl.effective_to is null or sl.effective_to > $7::timestamptz))))
                order by sp.created_at desc, sp.id desc
                limit $10`,
              [
                input.status,
                input.priceType,
                input.after?.createdAt ?? null,
                input.after?.priceId ?? null,
                input.locationId,
                input.readAt,
                restricted,
                allowed,
                input.limit + 1,
              ],
            );
            const selected = rows.slice(0, input.limit);
            const items = Object.freeze(selected.map((row) => priceFromRow(row)));
            const last = items.at(-1);
            const next: PriceListPosition | null =
              rows.length > input.limit && last !== undefined
                ? Object.freeze({
                    createdAt: mapUtcTimestamp(last.created_at),
                    priceId: last.price_id,
                  })
                : null;
            return resultSuccess(Object.freeze({ items, next }));
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },
  };
  return Object.freeze(store);
};
