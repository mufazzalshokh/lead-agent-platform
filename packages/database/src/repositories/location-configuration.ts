import {
  isLocationMutationReplay,
  type LocationConfigurationStore,
  type LocationListPosition,
  type PreparedLocationEventOperation,
  type PreparedLocationOperation,
  type ConfigurationFailureCode,
  type ConfigurationMutation,
  type ConfigurationResult,
} from "@lead-agent/application";
import {
  DomainEventSchemas,
  LocationClosureRecordSchema,
  LocationRootSchema,
  isSchemaValue,
  type DomainEventFor,
  type LocationClosureRecord,
  type LocationId,
  type LocationRoot,
  type ResourceId,
  type ResourceVersion,
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
  mapEnum,
  mapJsonObject,
  mapLocaleMap,
  mapLocationId,
  mapNullableIdentifier,
  mapPositiveInteger,
  mapResourceId,
  mapString,
  mapUtcTimestamp,
  readRepositoryDatabaseCause,
} from "./shared.js";

type LocationChangedEvent = DomainEventFor<"location.changed">;
type LocationMutation = ConfigurationMutation<LocationRoot | LocationClosureRecord>;
type StoreFailureCode = Exclude<ConfigurationFailureCode, "rate_limited">;

export interface LocationConfigurationReplayProtector {
  /** Must provide authenticated encryption and bind ciphertext to the supplied operation scope. */
  protect(scope: string, plaintext: Uint8Array): Uint8Array;
  reveal(scope: string, ciphertext: Uint8Array): Uint8Array;
}

class LocationConfigurationPermissionError extends Error {}
class LocationConfigurationValidationError extends Error {}
class LocationConfigurationBusinessRuleError extends Error {}
class LocationConfigurationIdempotencyError extends Error {}
class LocationConfigurationReplayError extends Error {}

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

const mapExpectedFailure = <Value>(error: unknown): ConfigurationResult<Value> => {
  if (error instanceof LocationConfigurationPermissionError) {
    return resultFailure("permission_denied");
  }
  if (error instanceof LocationConfigurationValidationError) {
    return resultFailure("validation_failed");
  }
  if (error instanceof LocationConfigurationBusinessRuleError) {
    return resultFailure("business_rule_failed");
  }
  if (error instanceof LocationConfigurationIdempotencyError) {
    return resultFailure("idempotency_conflict");
  }
  if (error instanceof RepositoryNotFoundError) {
    return resultFailure("resource_not_found");
  }
  if (error instanceof RepositoryVersionConflictError) {
    return resultFailure("version_conflict");
  }
  if (error instanceof RepositoryDatabaseError) {
    const constraint = readConstraint(error);
    if (
      constraint === "locations_organization_id_code_unique" ||
      constraint === "location_closures_one_active_per_local_date_unique"
    ) {
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
    throw new LocationConfigurationPermissionError();
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
    if (!sameStrings(actual, expected)) throw new LocationConfigurationPermissionError();
  }
};

type LocationRow = QueryResultRow & {
  address_i18n: unknown;
  code: unknown;
  content_hash: unknown;
  current_version_id: unknown;
  id: unknown;
  name_i18n: unknown;
  public_contact_jsonb: unknown;
  published_at: unknown;
  published_by_user_id: unknown;
  status: unknown;
  time_zone: unknown;
  version: unknown;
  version_id: unknown;
  version_no: unknown;
};

type HourRow = QueryResultRow & {
  closes_at_local: unknown;
  day_of_week: unknown;
  opens_at_local: unknown;
  sequence_no: unknown;
};

const LOCATION_SELECT = `select l.id, l.code, l.status, l.current_version_id, l.version,
       lv.id as version_id, lv.version_no, lv.name_i18n, lv.address_i18n,
       lv.public_contact_jsonb, lv.time_zone, lv.published_at,
       lv.published_by_user_id, encode(lv.content_hash, 'hex') as content_hash
  from locations l
  left join location_versions lv
    on lv.organization_id = l.organization_id
   and lv.location_id = l.id
   and lv.id = l.current_version_id`;

const locationFromRow = async (
  session: TenantDbSession,
  row: LocationRow,
): Promise<LocationRoot> => {
  const locationId = mapLocationId(row.id);
  const versionId = mapNullableIdentifier(row.version_id);
  let currentVersion: unknown = null;
  if (versionId !== null) {
    const hours = await executeTenantRead<HourRow>(
      session,
      `select day_of_week, opens_at_local::text, closes_at_local::text, sequence_no
         from location_business_hours
        where organization_id = $1 and location_version_id = $2
        order by day_of_week, sequence_no, id`,
      [versionId],
    );
    currentVersion = Object.freeze({
      address_i18n: mapLocaleMap(row.address_i18n),
      business_hours: Object.freeze({
        intervals: hours.map((hour) =>
          Object.freeze({
            closes_at_local: mapString(hour.closes_at_local),
            day_of_week: mapPositiveInteger(hour.day_of_week),
            opens_at_local: mapString(hour.opens_at_local),
            sequence_no: mapPositiveInteger(hour.sequence_no),
          }),
        ),
      }),
      location_id: locationId,
      name_i18n: mapLocaleMap(row.name_i18n),
      provenance: Object.freeze({
        content_hash: mapString(row.content_hash),
        published_at: mapUtcTimestamp(row.published_at),
        published_by_user_id: mapResourceId(row.published_by_user_id),
        record_id: versionId,
        version_no: mapPositiveInteger(row.version_no),
      }),
      public_contact: mapJsonObject(row.public_contact_jsonb),
      time_zone: mapString(row.time_zone),
    });
  }
  const value = Object.freeze({
    code: mapString(row.code),
    current_version: currentVersion,
    location_id: locationId,
    status: mapEnum(row.status, ["active", "inactive"] as const),
    version: mapAggregateVersion(row.version),
  });
  if (!isSchemaValue(LocationRootSchema, value)) {
    throw new LocationConfigurationReplayError();
  }
  return value;
};

const loadLocation = async (
  session: TenantDbSession,
  locationId: LocationId,
  allowedLocationIds?: readonly LocationId[],
): Promise<LocationRoot> => {
  const rows = await executeTenantRead<LocationRow>(
    session,
    `${LOCATION_SELECT}
      where l.organization_id = $1 and l.id = $2
        and ($3::uuid[] is null or l.id = any($3::uuid[]))`,
    [locationId, allowedLocationIds ?? null],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("location");
  return locationFromRow(session, row);
};

type ClosureRow = QueryResultRow & {
  closes_at_local: unknown;
  created_at: unknown;
  created_by_user_id: unknown;
  id: unknown;
  kind: unknown;
  local_date: unknown;
  location_id: unknown;
  opens_at_local: unknown;
  reason_i18n: unknown;
  status: unknown;
  supersedes_id: unknown;
};

const closureFromRow = (row: ClosureRow): LocationClosureRecord => {
  const kind = mapEnum(row.kind, ["closed", "override"] as const);
  const details =
    kind === "closed"
      ? Object.freeze({
          kind,
          local_date: mapString(row.local_date),
          reason_i18n: mapLocaleMap(row.reason_i18n),
        })
      : Object.freeze({
          closes_at_local: mapString(row.closes_at_local),
          kind,
          local_date: mapString(row.local_date),
          opens_at_local: mapString(row.opens_at_local),
          reason_i18n: mapLocaleMap(row.reason_i18n),
        });
  const value = Object.freeze({
    closure_id: mapResourceId(row.id),
    created_at: mapUtcTimestamp(row.created_at),
    created_by_user_id: mapResourceId(row.created_by_user_id),
    details,
    location_id: mapLocationId(row.location_id),
    status: mapEnum(row.status, ["active", "superseded", "cancelled"] as const),
    supersedes_id: mapNullableIdentifier(row.supersedes_id),
  });
  if (!isSchemaValue(LocationClosureRecordSchema, value)) {
    throw new LocationConfigurationReplayError();
  }
  return value;
};

const CLOSURE_SELECT = `select id, location_id, local_date::text, kind,
       opens_at_local::text, closes_at_local::text, reason_i18n, status,
       supersedes_id, created_by_user_id, created_at
  from location_closures`;

const loadClosure = async (
  session: TenantDbSession,
  locationId: LocationId,
  closureId: ResourceId,
  forUpdate = false,
): Promise<LocationClosureRecord> => {
  const rows = await executeTenantRead<ClosureRow>(
    session,
    `${CLOSURE_SELECT}
      where organization_id = $1 and location_id = $2 and id = $3
      ${forUpdate ? "for update" : ""}`,
    [locationId, closureId],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("location");
  return closureFromRow(row);
};

type RootLockRow = QueryResultRow & {
  current_version_id: unknown;
  status: unknown;
  version: unknown;
};

const lockLocation = async (
  session: TenantDbSession,
  locationId: LocationId,
  expectedVersion: ResourceVersion,
): Promise<Readonly<{ currentVersionId: ResourceId | null; status: "active" | "inactive" }>> => {
  const rows = await executeTenantRead<RootLockRow>(
    session,
    `select status, current_version_id, version
       from locations
      where organization_id = $1 and id = $2
      for update`,
    [locationId],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("location");
  const currentVersion = mapAggregateVersion(row.version);
  if (currentVersion !== expectedVersion) {
    throw new RepositoryVersionConflictError("location", currentVersion);
  }
  return Object.freeze({
    currentVersionId: mapNullableIdentifier(row.current_version_id),
    status: mapEnum(row.status, ["active", "inactive"] as const),
  });
};

const defaultLocale = async (session: TenantDbSession): Promise<"en" | "ru" | "uz"> => {
  type Row = QueryResultRow & { default_locale: unknown };
  const rows = await executeTenantRootRead<Row>(
    session,
    "select default_locale from organizations where id = $1 and status = 'active'",
  );
  const row = rows[0];
  if (row === undefined) throw new LocationConfigurationBusinessRuleError();
  return mapEnum(row.default_locale, ["en", "ru", "uz"] as const);
};

const requireLocale = (
  locale: "en" | "ru" | "uz",
  ...values: readonly Readonly<Partial<Record<"en" | "ru" | "uz", string>>>[]
): void => {
  if (values.some((value) => value[locale] === undefined)) {
    throw new LocationConfigurationValidationError();
  }
};

const locationEvent = (
  input: PreparedLocationEventOperation,
  locationId: LocationId,
  aggregateVersion: ResourceVersion,
  changedFields: readonly ("business_hours" | "closures" | "details" | "status" | "time_zone")[],
): LocationChangedEvent => {
  const event: unknown = Object.freeze({
    actor: Object.freeze({
      actor_id: input.authorization.userId,
      actor_type: "member" as const,
    }),
    aggregate_id: locationId,
    aggregate_type: "location" as const,
    aggregate_version: aggregateVersion,
    causation_id: null,
    correlation_id: input.correlationId,
    event_id: input.eventId,
    event_type: "location.changed" as const,
    occurred_at: input.occurredAt,
    organization_id: input.authorization.organizationId,
    payload: Object.freeze({ changed_location_fields: Object.freeze([...changedFields]) }),
    request_id: input.requestId,
    schema_id: "LocationChangedDomainEvent.v1",
    schema_version: "1",
  });
  if (!isSchemaValue(DomainEventSchemas["location.changed"], event)) {
    throw new LocationConfigurationReplayError();
  }
  return event;
};

const insertAudit = async (
  session: TenantDbSession,
  input: PreparedLocationOperation,
  action: string,
  targetType: "location" | "location_closure",
  targetId: ResourceId | LocationId,
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

const insertOutbox = async (
  session: TenantDbSession,
  event: LocationChangedEvent,
): Promise<void> => {
  await executeTenantWrite(
    session,
    `insert into outbox_events
      (organization_id,id,event_type,schema_version,aggregate_type,aggregate_id,
       aggregate_version,payload_jsonb,correlation_id,causation_id,occurred_at,
       status,attempt_count,available_at,locked_by,locked_until,published_at,
       last_error_category)
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
  input: PreparedLocationOperation,
): Promise<IdempotencyRow | null> => {
  const inserted = await executeTenantWrite(
    session,
    `insert into idempotency_keys
      (organization_id,id,scope,key_hash,principal_type,principal_id_hash,
       request_hash,status,response_status,response_ciphertext,resource_type,
       resource_id,locked_until,expires_at,created_at,completed_at)
     values ($1,$2,$3,$4,'user',$5,$6,'in_progress',null,null,null,null,$7,$8,$9,null)
     on conflict (organization_id,principal_type,principal_id_hash,scope,key_hash)
     do nothing
     returning id`,
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
  if (row === undefined) throw new LocationConfigurationReplayError();
  if (!bytesEqual(input.idempotency.requestHash, row.request_hash)) {
    throw new LocationConfigurationIdempotencyError();
  }
  return row;
};

const encodeMutation = (
  protector: LocationConfigurationReplayProtector,
  scope: string,
  mutation: LocationMutation,
): Uint8Array => {
  const plaintext = new TextEncoder().encode(JSON.stringify(mutation));
  const protectedValue = protector.protect(scope, plaintext);
  if (protectedValue.byteLength < 1 || protectedValue.byteLength > 65_536) {
    throw new LocationConfigurationReplayError();
  }
  return protectedValue;
};

const decodeMutation = (
  protector: LocationConfigurationReplayProtector,
  scope: string,
  ciphertext: unknown,
  resource: "closure" | "location",
): LocationMutation => {
  if (!(ciphertext instanceof Uint8Array) && !Buffer.isBuffer(ciphertext)) {
    throw new LocationConfigurationReplayError();
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        protector.reveal(scope, new Uint8Array(ciphertext)),
      ),
    ) as unknown;
  } catch {
    throw new LocationConfigurationReplayError();
  }
  if (!isLocationMutationReplay(value, resource)) throw new LocationConfigurationReplayError();
  return value;
};

const finalizeIdempotency = async (
  session: TenantDbSession,
  input: PreparedLocationOperation,
  resourceType: "location" | "location_closure",
  resourceId: ResourceId | LocationId,
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
  if (result.rowCount !== 1) throw new LocationConfigurationReplayError();
};

const idempotentMutation = async <Value extends LocationRoot | LocationClosureRecord>(
  runtime: TenantDatabaseRuntime,
  protector: LocationConfigurationReplayProtector,
  input: PreparedLocationOperation,
  permission: "configuration.publish" | "configuration.write",
  replayResource: "closure" | "location",
  resourceType: "location" | "location_closure",
  action: (session: TenantDbSession) => Promise<ConfigurationMutation<Value>>,
): Promise<ConfigurationResult<ConfigurationMutation<Value>>> => {
  try {
    return await runtime.withTenantTransaction(
      input.authorization.organizationId,
      async (session) => {
        await requireCurrentActor(session, input.authorization, permission);
        const replay = await reserveIdempotency(session, input);
        if (replay !== null) {
          if (replay.status !== "succeeded") throw new LocationConfigurationIdempotencyError();
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
        const resourceId =
          "closure_id" in mutation.resource
            ? mutation.resource.closure_id
            : mutation.resource.location_id;
        await finalizeIdempotency(session, input, resourceType, resourceId, ciphertext);
        return resultSuccess(mutation);
      },
    );
  } catch (error) {
    return mapExpectedFailure(error);
  }
};

const advanceLocationVersion = async (
  session: TenantDbSession,
  locationId: LocationId,
  expectedVersion: ResourceVersion,
  occurredAt: string,
): Promise<ResourceVersion> => {
  type Row = QueryResultRow & { version: unknown };
  const updated = await executeTenantWrite<Row>(
    session,
    `update locations
        set version = version + 1, updated_at = $3
      where organization_id = $1 and id = $2 and version = $4
      returning version`,
    [locationId, occurredAt, expectedVersion],
  );
  const row = updated.rows[0];
  if (row === undefined || updated.rowCount !== 1) {
    throw new RepositoryVersionConflictError("location", expectedVersion);
  }
  return mapAggregateVersion(row.version);
};

export const createLocationConfigurationStore = (
  runtime: TenantDatabaseRuntime,
  replayProtector: LocationConfigurationReplayProtector,
): LocationConfigurationStore => {
  const store: LocationConfigurationStore = {
    createLocation: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "location",
        "location",
        async (session) => {
          await executeTenantWrite(
            session,
            `insert into locations
              (organization_id,id,code,status,current_version_id,created_at,updated_at,version)
             values ($1,$2,$3,'inactive',null,$4,$4,1)`,
            [input.locationId, input.value.code, input.occurredAt],
          );
          await insertAudit(session, input, "location.created", "location", input.locationId, {
            code: input.value.code,
            initial_status: "inactive",
          });
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadLocation(session, input.locationId),
          });
        },
      ),

    publishLocation: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "location",
        "location",
        async (session) => {
          const root = await lockLocation(session, input.locationId, input.expectedVersion);
          const locale = await defaultLocale(session);
          requireLocale(locale, input.value.name_i18n, input.value.address_i18n);
          type VersionRow = QueryResultRow & { version_no: unknown };
          const versionRows = await executeTenantRead<VersionRow>(
            session,
            `select (coalesce(max(version_no), 0) + 1)::integer as version_no
               from location_versions
              where organization_id = $1 and location_id = $2`,
            [input.locationId],
          );
          const versionNo = mapPositiveInteger(versionRows[0]?.version_no);
          await executeTenantWrite(
            session,
            `insert into location_versions
              (organization_id,id,location_id,version_no,name_i18n,address_i18n,
               public_contact_jsonb,time_zone,published_at,published_by_user_id,
               content_hash,created_at)
             values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$9)`,
            [
              input.versionId,
              input.locationId,
              versionNo,
              JSON.stringify(input.value.name_i18n),
              JSON.stringify(input.value.address_i18n),
              JSON.stringify(input.value.public_contact),
              input.value.time_zone,
              input.occurredAt,
              input.authorization.userId,
              Buffer.from(input.contentHash, "hex"),
            ],
          );
          for (const [index, interval] of input.value.business_hours.intervals.entries()) {
            const hourId = input.hourIds[index];
            if (hourId === undefined) throw new LocationConfigurationValidationError();
            await executeTenantWrite(
              session,
              `insert into location_business_hours
                (organization_id,id,location_version_id,day_of_week,opens_at_local,
                 closes_at_local,sequence_no,created_at)
               values ($1,$2,$3,$4,$5::time,$6::time,$7,$8)`,
              [
                hourId,
                input.versionId,
                interval.day_of_week,
                interval.opens_at_local,
                interval.closes_at_local,
                interval.sequence_no,
                input.occurredAt,
              ],
            );
          }
          if (input.hourIds.length !== input.value.business_hours.intervals.length) {
            throw new LocationConfigurationValidationError();
          }
          type UpdatedRow = QueryResultRow & { version: unknown };
          const updated = await executeTenantWrite<UpdatedRow>(
            session,
            `update locations
                set status = 'active', current_version_id = $3,
                    version = version + 1, updated_at = $4
              where organization_id = $1 and id = $2 and version = $5
              returning version`,
            [input.locationId, input.versionId, input.occurredAt, input.expectedVersion],
          );
          const nextVersion = mapAggregateVersion(updated.rows[0]?.version);
          if (updated.rowCount !== 1) {
            throw new RepositoryVersionConflictError("location", input.expectedVersion);
          }
          const changedFields = [
            "details",
            "business_hours",
            "time_zone",
            ...(root.status === "inactive" ? (["status"] as const) : []),
          ] as const;
          const event = locationEvent(input, input.locationId, nextVersion, changedFields);
          await insertAudit(session, input, "location.published", "location", input.locationId, {
            expected_version: input.expectedVersion,
            location_version_id: input.versionId,
            new_version: nextVersion,
          });
          await insertOutbox(session, event);
          return Object.freeze({
            events: Object.freeze([event]),
            resource: await loadLocation(session, input.locationId),
          });
        },
      ),

    deactivateLocation: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "location",
        "location",
        async (session) => {
          const root = await lockLocation(session, input.locationId, input.expectedVersion);
          if (root.status === "inactive") throw new LocationConfigurationBusinessRuleError();
          type Row = QueryResultRow & { version: unknown };
          const updated = await executeTenantWrite<Row>(
            session,
            `update locations
                set status = 'inactive', version = version + 1, updated_at = $3
              where organization_id = $1 and id = $2 and version = $4
              returning version`,
            [input.locationId, input.occurredAt, input.expectedVersion],
          );
          if (updated.rowCount !== 1) {
            throw new RepositoryVersionConflictError("location", input.expectedVersion);
          }
          const nextVersion = mapAggregateVersion(updated.rows[0]?.version);
          const event = locationEvent(input, input.locationId, nextVersion, ["status"]);
          await insertAudit(session, input, "location.deactivated", "location", input.locationId, {
            expected_version: input.expectedVersion,
            new_version: nextVersion,
          });
          await insertOutbox(session, event);
          return Object.freeze({
            events: Object.freeze([event]),
            resource: await loadLocation(session, input.locationId),
          });
        },
      ),

    createClosure: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "closure",
        "location_closure",
        async (session) => {
          const root = await lockLocation(session, input.locationId, input.expectedVersion);
          if (root.status !== "active" || root.currentVersionId === null) {
            throw new LocationConfigurationBusinessRuleError();
          }
          const locale = await defaultLocale(session);
          requireLocale(locale, input.value.reason_i18n);
          await executeTenantWrite(
            session,
            `insert into location_closures
              (organization_id,id,location_id,local_date,kind,opens_at_local,
               closes_at_local,reason_i18n,status,supersedes_id,created_by_user_id,created_at)
             values ($1,$2,$3,$4::date,$5,$6::time,$7::time,$8::jsonb,'active',null,$9,$10)`,
            [
              input.closureId,
              input.locationId,
              input.value.local_date,
              input.value.kind,
              input.value.kind === "override" ? input.value.opens_at_local : null,
              input.value.kind === "override" ? input.value.closes_at_local : null,
              JSON.stringify(input.value.reason_i18n),
              input.authorization.userId,
              input.occurredAt,
            ],
          );
          const nextVersion = await advanceLocationVersion(
            session,
            input.locationId,
            input.expectedVersion,
            input.occurredAt,
          );
          const event = locationEvent(input, input.locationId, nextVersion, ["closures"]);
          await insertAudit(
            session,
            input,
            "location.closure_created",
            "location_closure",
            input.closureId,
            { expected_version: input.expectedVersion, local_date: input.value.local_date },
          );
          await insertOutbox(session, event);
          return Object.freeze({
            events: Object.freeze([event]),
            resource: await loadClosure(session, input.locationId, input.closureId),
          });
        },
      ),

    supersedeClosure: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "closure",
        "location_closure",
        async (session) => {
          const root = await lockLocation(session, input.locationId, input.expectedVersion);
          if (root.status !== "active" || root.currentVersionId === null) {
            throw new LocationConfigurationBusinessRuleError();
          }
          const current = await loadClosure(session, input.locationId, input.closureId, true);
          if (
            current.status !== "active" ||
            current.details.local_date !== input.value.local_date
          ) {
            throw new LocationConfigurationBusinessRuleError();
          }
          const locale = await defaultLocale(session);
          requireLocale(locale, input.value.reason_i18n);
          const transitioned = await executeTenantWrite(
            session,
            `update location_closures
                set status = 'superseded'
              where organization_id = $1 and id = $2 and location_id = $3 and status = 'active'`,
            [input.closureId, input.locationId],
          );
          if (transitioned.rowCount !== 1) throw new LocationConfigurationBusinessRuleError();
          await executeTenantWrite(
            session,
            `insert into location_closures
              (organization_id,id,location_id,local_date,kind,opens_at_local,
               closes_at_local,reason_i18n,status,supersedes_id,created_by_user_id,created_at)
             values ($1,$2,$3,$4::date,$5,$6::time,$7::time,$8::jsonb,'active',$9,$10,$11)`,
            [
              input.replacementId,
              input.locationId,
              input.value.local_date,
              input.value.kind,
              input.value.kind === "override" ? input.value.opens_at_local : null,
              input.value.kind === "override" ? input.value.closes_at_local : null,
              JSON.stringify(input.value.reason_i18n),
              input.closureId,
              input.authorization.userId,
              input.occurredAt,
            ],
          );
          const nextVersion = await advanceLocationVersion(
            session,
            input.locationId,
            input.expectedVersion,
            input.occurredAt,
          );
          const event = locationEvent(input, input.locationId, nextVersion, ["closures"]);
          await insertAudit(
            session,
            input,
            "location.closure_superseded",
            "location_closure",
            input.replacementId,
            {
              expected_version: input.expectedVersion,
              local_date: input.value.local_date,
              supersedes_id: input.closureId,
            },
          );
          await insertOutbox(session, event);
          return Object.freeze({
            events: Object.freeze([event]),
            resource: await loadClosure(session, input.locationId, input.replacementId),
          });
        },
      ),

    cancelClosure: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "closure",
        "location_closure",
        async (session) => {
          await lockLocation(session, input.locationId, input.expectedVersion);
          const current = await loadClosure(session, input.locationId, input.closureId, true);
          if (current.status === "cancelled") {
            return Object.freeze({ events: Object.freeze([]), resource: current });
          }
          if (current.status !== "active") throw new LocationConfigurationBusinessRuleError();
          const updated = await executeTenantWrite(
            session,
            `update location_closures
                set status = 'cancelled'
              where organization_id = $1 and id = $2 and location_id = $3 and status = 'active'`,
            [input.closureId, input.locationId],
          );
          if (updated.rowCount !== 1) throw new LocationConfigurationBusinessRuleError();
          const nextVersion = await advanceLocationVersion(
            session,
            input.locationId,
            input.expectedVersion,
            input.occurredAt,
          );
          const event = locationEvent(input, input.locationId, nextVersion, ["closures"]);
          await insertAudit(
            session,
            input,
            "location.closure_cancelled",
            "location_closure",
            input.closureId,
            { expected_version: input.expectedVersion },
          );
          await insertOutbox(session, event);
          return Object.freeze({
            events: Object.freeze([event]),
            resource: await loadClosure(session, input.locationId, input.closureId),
          });
        },
      ),

    getLocation: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            const allowed =
              input.authorization.locationScope === "restricted"
                ? input.authorization.allowedLocationIds
                : undefined;
            return resultSuccess(await loadLocation(session, input.locationId, allowed));
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },

    listLocations: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
              throw new LocationConfigurationValidationError();
            }
            const allowed =
              input.authorization.locationScope === "restricted"
                ? input.authorization.allowedLocationIds
                : null;
            if (allowed?.length === 0) {
              return resultSuccess(Object.freeze({ items: Object.freeze([]), next: null }));
            }
            const rows = await executeTenantRead<LocationRow>(
              session,
              `${LOCATION_SELECT}
                where l.organization_id = $1
                  and ($2::text is null or l.status = $2)
                  and ($3::uuid[] is null or l.id = any($3::uuid[]))
                  and ($4::text is null or (l.code, l.id) > ($4, $5::uuid))
                order by l.code, l.id
                limit $6`,
              [
                input.status,
                allowed,
                input.after?.code ?? null,
                input.after?.locationId ?? null,
                input.limit + 1,
              ],
            );
            const selected = rows.slice(0, input.limit);
            const items: LocationRoot[] = [];
            for (const row of selected) items.push(await locationFromRow(session, row));
            const last = items.at(-1);
            const next: LocationListPosition | null =
              rows.length > input.limit && last !== undefined
                ? Object.freeze({ code: last.code, locationId: last.location_id })
                : null;
            return resultSuccess(Object.freeze({ items: Object.freeze(items), next }));
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },
  };
  return Object.freeze(store);
};
