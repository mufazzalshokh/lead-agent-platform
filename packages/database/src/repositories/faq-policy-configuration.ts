import {
  isFaqPolicyMutationReplay,
  type ConfigurationFailureCode,
  type ConfigurationMutation,
  type ConfigurationResult,
  type FaqListPosition,
  type FaqPolicyConfigurationStore,
  type PolicyListPosition,
  type PreparedKnowledgeEventOperation,
  type PreparedKnowledgeOperation,
} from "@lead-agent/application";
import {
  BusinessPolicySchema,
  DomainEventSchemas,
  FaqSchema,
  QualificationPolicyV1RulesSchema,
  isSchemaValue,
  type BusinessPolicy,
  type BusinessPolicyType,
  type DomainEvent,
  type DomainEventFor,
  type Faq,
  type LocationId,
  type ResourceId,
  type ResourceVersion,
  type ServiceId,
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
  mapLocaleMap,
  mapLocationId,
  mapNullableUtcTimestamp,
  mapPositiveInteger,
  mapResourceId,
  mapServiceId,
  mapString,
  mapUtcTimestamp,
  readRepositoryDatabaseCause,
} from "./shared.js";

type FaqPublishedEvent = DomainEventFor<"faq.published">;
type BusinessPolicyPublishedEvent = DomainEventFor<"business_policy.published">;
type KnowledgeMutation = ConfigurationMutation<BusinessPolicy | Faq>;
type StoreFailureCode = Exclude<ConfigurationFailureCode, "rate_limited">;

export interface FaqPolicyConfigurationReplayProtector {
  /** Must provide authenticated encryption and bind ciphertext to the supplied operation scope. */
  protect(scope: string, plaintext: Uint8Array): Uint8Array;
  reveal(scope: string, ciphertext: Uint8Array): Uint8Array;
}

class KnowledgeConfigurationPermissionError extends Error {}
class KnowledgeConfigurationValidationError extends Error {}
class KnowledgeConfigurationBusinessRuleError extends Error {}
class KnowledgeConfigurationIdempotencyError extends Error {}
class KnowledgeConfigurationReplayError extends Error {}

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
  "faqs_organization_key_version_unique",
  "faqs_one_published_per_key_scope_unique",
  "faqs_effective_interval_check",
  "business_policies_organization_key_version_unique",
  "business_policies_one_published_per_key_type_unique",
  "business_policies_effective_interval_check",
]);

const mapExpectedFailure = <Value>(error: unknown): ConfigurationResult<Value> => {
  if (error instanceof KnowledgeConfigurationPermissionError) {
    return resultFailure("permission_denied");
  }
  if (error instanceof KnowledgeConfigurationValidationError) {
    return resultFailure("validation_failed");
  }
  if (error instanceof KnowledgeConfigurationBusinessRuleError) {
    return resultFailure("business_rule_failed");
  }
  if (error instanceof KnowledgeConfigurationIdempotencyError) {
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
    throw new KnowledgeConfigurationPermissionError();
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
    if (!sameStrings(actual, expected)) throw new KnowledgeConfigurationPermissionError();
  }
};

type FaqRow = QueryResultRow & {
  answer_i18n: unknown;
  content_hash: unknown;
  created_at: unknown;
  effective_from: unknown;
  effective_to: unknown;
  faq_key: unknown;
  id: unknown;
  location_id: unknown;
  published_by_user_id: unknown;
  question_i18n: unknown;
  service_id: unknown;
  status: unknown;
  version_no: unknown;
};

const FAQ_SELECT = `select f.id, f.faq_key, f.version_no, f.service_id, f.location_id,
       f.question_i18n, f.answer_i18n, f.status, f.effective_from, f.effective_to,
       encode(f.content_hash, 'hex') as content_hash, f.published_by_user_id, f.created_at
  from faqs f`;

const faqFromRow = (row: FaqRow): Faq => {
  const value = Object.freeze({
    answer_i18n: mapLocaleMap(row.answer_i18n),
    content_hash: mapString(row.content_hash),
    created_at: mapUtcTimestamp(row.created_at),
    effective_from: mapNullableUtcTimestamp(row.effective_from),
    effective_to: mapNullableUtcTimestamp(row.effective_to),
    faq_id: mapResourceId(row.id),
    faq_key: mapString(row.faq_key),
    location_id: row.location_id === null ? null : mapLocationId(row.location_id),
    published_by_user_id:
      row.published_by_user_id === null ? null : mapResourceId(row.published_by_user_id),
    question_i18n: mapLocaleMap(row.question_i18n),
    service_id: row.service_id === null ? null : mapServiceId(row.service_id),
    status: mapEnum(row.status, ["draft", "published", "retired"] as const),
    version_no: mapPositiveInteger(row.version_no),
  });
  if (!isSchemaValue(FaqSchema, value)) throw new KnowledgeConfigurationReplayError();
  return value;
};

type PolicyRow = QueryResultRow & {
  content_hash: unknown;
  created_at: unknown;
  effective_from: unknown;
  effective_to: unknown;
  id: unknown;
  policy_key: unknown;
  policy_type: unknown;
  published_by_user_id: unknown;
  rules_jsonb: unknown;
  schema_version: unknown;
  status: unknown;
  version_no: unknown;
};

const POLICY_SELECT = `select bp.id, bp.policy_key, bp.version_no, bp.policy_type,
       bp.schema_version, bp.rules_jsonb, bp.status, bp.effective_from, bp.effective_to,
       encode(bp.content_hash, 'hex') as content_hash, bp.published_by_user_id, bp.created_at
  from business_policies bp`;

const QUALIFICATION_V1_RULES_JSON = JSON.stringify({
  disqualification_reasons: [
    "service_not_offered",
    "location_not_served",
    "not_interested",
    "outside_business_scope",
    "spam_or_abuse",
  ],
  require_budget: false,
  require_contactability: true,
  require_medical_eligibility: false,
  require_positive_next_step_intent: true,
  require_preferred_time: false,
  require_service_interest: true,
  require_supported_service_location: true,
});

const policyFromRow = (row: PolicyRow): BusinessPolicy => {
  if (
    row.policy_type !== "qualification" ||
    row.schema_version !== 1 ||
    !isSchemaValue(QualificationPolicyV1RulesSchema, row.rules_jsonb)
  ) {
    throw new KnowledgeConfigurationBusinessRuleError();
  }
  const value = Object.freeze({
    content_hash: mapString(row.content_hash),
    created_at: mapUtcTimestamp(row.created_at),
    effective_from: mapNullableUtcTimestamp(row.effective_from),
    effective_to: mapNullableUtcTimestamp(row.effective_to),
    policy_id: mapResourceId(row.id),
    policy_key: mapString(row.policy_key),
    policy_type: "qualification" as const,
    published_by_user_id:
      row.published_by_user_id === null ? null : mapResourceId(row.published_by_user_id),
    rules: Object.freeze({
      ...row.rules_jsonb,
      disqualification_reasons: Object.freeze([...row.rules_jsonb.disqualification_reasons]),
    }),
    schema_version: 1 as const,
    status: mapEnum(row.status, ["draft", "published", "retired"] as const),
    version_no: mapPositiveInteger(row.version_no),
  });
  if (!isSchemaValue(BusinessPolicySchema, value)) {
    throw new KnowledgeConfigurationReplayError();
  }
  return value;
};

const faqVisibilitySql = `and (not $3::boolean
  or (f.location_id is not null and f.location_id = any($4::uuid[]))
  or (f.location_id is null and f.service_id is not null and exists (
    select 1 from service_locations sl
     where sl.organization_id = f.organization_id and sl.service_id = f.service_id
       and sl.location_id = any($4::uuid[]) and sl.status = 'active'
       and sl.effective_from <= $5::timestamptz
       and (sl.effective_to is null or sl.effective_to > $5::timestamptz))))`;

const loadFaq = async (
  session: TenantDbSession,
  faqId: ResourceId,
  authorization?: AuthorizationContext,
  readAt?: string,
  lock = false,
): Promise<Faq> => {
  const restricted = authorization?.locationScope === "restricted";
  const allowed = restricted ? authorization.allowedLocationIds : null;
  const rows = await executeTenantRead<FaqRow>(
    session,
    `${FAQ_SELECT}
      where f.organization_id = $1 and f.id = $2
      ${authorization === undefined ? "" : faqVisibilitySql}
      ${lock ? "for update" : ""}`,
    authorization === undefined
      ? [faqId]
      : [faqId, restricted, allowed, readAt ?? new Date(0).toISOString()],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("faq");
  return faqFromRow(row);
};

const loadPolicy = async (
  session: TenantDbSession,
  policyId: ResourceId,
  lock = false,
): Promise<BusinessPolicy> => {
  const rows = await executeTenantRead<PolicyRow>(
    session,
    `${POLICY_SELECT}
      where bp.organization_id = $1 and bp.id = $2
        and bp.policy_type = 'qualification' and bp.schema_version = 1
        and bp.rules_jsonb = $3::jsonb
      ${lock ? "for update" : ""}`,
    [policyId, QUALIFICATION_V1_RULES_JSON],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("business_policy");
  return policyFromRow(row);
};

const requireSupportedPolicyTarget = async (
  session: TenantDbSession,
  policyId: ResourceId,
): Promise<void> => {
  type Row = QueryResultRow & {
    policy_type: unknown;
    rules_jsonb: unknown;
    schema_version: unknown;
  };
  const rows = await executeTenantRead<Row>(
    session,
    `select policy_type, schema_version, rules_jsonb
       from business_policies
      where organization_id = $1 and id = $2`,
    [policyId],
  );
  const row = rows[0];
  if (row === undefined) throw new RepositoryNotFoundError("business_policy");
  if (
    row.policy_type !== "qualification" ||
    row.schema_version !== 1 ||
    !isSchemaValue(QualificationPolicyV1RulesSchema, row.rules_jsonb)
  ) {
    throw new KnowledgeConfigurationBusinessRuleError();
  }
};

const advisoryLock = async (
  session: TenantDbSession,
  kind: "faq" | "policy",
  key: string,
): Promise<void> => {
  await executeTenantRootRead(
    session,
    `select pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended($1::text || pg_catalog.chr(31) || $2::text ||
         pg_catalog.chr(31) || $3::text, 77004))
       from organizations
      where id = $1::uuid and id = app.current_organization_id()`,
    [kind, key],
  );
};

const nextFaqVersion = async (
  session: TenantDbSession,
  faqKey: string,
  minimum = 1,
): Promise<ResourceVersion> => {
  type Row = QueryResultRow & { version_no: unknown };
  const rows = await executeTenantRead<Row>(
    session,
    `select greatest(coalesce(max(version_no), 0) + 1, $3::integer) as version_no
       from faqs
      where organization_id = $1 and faq_key = $2`,
    [faqKey, minimum],
  );
  const row = rows[0];
  if (row === undefined) throw new KnowledgeConfigurationReplayError();
  return mapAggregateVersion(row.version_no);
};

const nextPolicyVersion = async (
  session: TenantDbSession,
  policyKey: string,
  minimum = 1,
): Promise<ResourceVersion> => {
  type Row = QueryResultRow & { version_no: unknown };
  const rows = await executeTenantRead<Row>(
    session,
    `select greatest(coalesce(max(version_no), 0) + 1, $3::integer) as version_no
       from business_policies
      where organization_id = $1 and policy_key = $2`,
    [policyKey, minimum],
  );
  const row = rows[0];
  if (row === undefined) throw new KnowledgeConfigurationReplayError();
  return mapAggregateVersion(row.version_no);
};

const requireFaqScopeTargets = async (
  session: TenantDbSession,
  authorization: AuthorizationContext,
  serviceId: ServiceId | null,
  locationId: LocationId | null,
  effectiveAt: string,
  publication: boolean,
): Promise<void> => {
  if (locationId !== null) {
    if (
      authorization.locationScope === "restricted" &&
      !authorization.allowedLocationIds.includes(locationId)
    ) {
      throw new RepositoryNotFoundError("faq");
    }
    type LocationRow = QueryResultRow & { current_version_id: unknown; status: unknown };
    const locations = await executeTenantRead<LocationRow>(
      session,
      `select status, current_version_id from locations
        where organization_id = $1 and id = $2`,
      [locationId],
    );
    const location = locations[0];
    if (location === undefined) throw new RepositoryNotFoundError("location");
    if (publication && (location.status !== "active" || location.current_version_id === null)) {
      throw new KnowledgeConfigurationBusinessRuleError();
    }
  }

  if (serviceId !== null) {
    type ServiceRow = QueryResultRow & { current_version_id: unknown; status: unknown };
    const services = await executeTenantRead<ServiceRow>(
      session,
      `select status, current_version_id from services
        where organization_id = $1 and id = $2`,
      [serviceId],
    );
    const service = services[0];
    if (service === undefined) throw new RepositoryNotFoundError("service");
    if (publication && (service.status !== "active" || service.current_version_id === null)) {
      throw new KnowledgeConfigurationBusinessRuleError();
    }
  }

  const offeringLocations =
    locationId === null && authorization.locationScope === "restricted"
      ? authorization.allowedLocationIds
      : locationId === null
        ? null
        : [locationId];
  if (serviceId === null && authorization.locationScope === "restricted" && locationId === null) {
    throw new RepositoryNotFoundError("faq");
  }
  if (
    serviceId !== null &&
    offeringLocations !== null &&
    (publication || authorization.locationScope === "restricted")
  ) {
    type OfferingRow = QueryResultRow & { found: unknown };
    const rows = await executeTenantRead<OfferingRow>(
      session,
      `select true as found from service_locations
        where organization_id = $1 and service_id = $2
          and location_id = any($3::uuid[]) and status = 'active'
          and effective_from <= $4::timestamptz
          and (effective_to is null or effective_to > $4::timestamptz)
        limit 1`,
      [serviceId, offeringLocations, effectiveAt],
    );
    if (rows[0] === undefined) throw new KnowledgeConfigurationBusinessRuleError();
  }
};

const defaultLocale = async (session: TenantDbSession): Promise<"en" | "ru" | "uz"> => {
  type Row = QueryResultRow & { default_locale: unknown };
  const rows = await executeTenantRootRead<Row>(
    session,
    "select default_locale from organizations where id = $1 and status = 'active'",
  );
  const row = rows[0];
  if (row === undefined) throw new KnowledgeConfigurationBusinessRuleError();
  return mapEnum(row.default_locale, ["en", "ru", "uz"] as const);
};

const requireFaqLocale = (faq: Faq, locale: "en" | "ru" | "uz"): void => {
  if (faq.question_i18n[locale] === undefined || faq.answer_i18n[locale] === undefined) {
    throw new KnowledgeConfigurationValidationError();
  }
};

const eventBase = (
  input: PreparedKnowledgeEventOperation,
  aggregateId: ResourceId,
  aggregateType: "business_policy" | "faq",
  aggregateVersion: ResourceVersion,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    actor: Object.freeze({ actor_id: input.authorization.userId, actor_type: "member" as const }),
    aggregate_id: aggregateId,
    aggregate_type: aggregateType,
    aggregate_version: aggregateVersion,
    causation_id: null,
    correlation_id: input.correlationId,
    event_id: input.eventId,
    occurred_at: input.occurredAt,
    organization_id: input.authorization.organizationId,
    request_id: input.requestId,
    schema_version: "1",
  });

const faqPublishedEvent = (input: PreparedKnowledgeEventOperation, faq: Faq): FaqPublishedEvent => {
  const event: unknown = Object.freeze({
    ...eventBase(input, faq.faq_id, "faq", faq.version_no),
    event_type: "faq.published" as const,
    payload: Object.freeze({ faq_version: faq.version_no }),
    schema_id: "FaqPublishedDomainEvent.v1",
  });
  if (!isSchemaValue(DomainEventSchemas["faq.published"], event)) {
    throw new KnowledgeConfigurationReplayError();
  }
  return event;
};

const businessPolicyPublishedEvent = (
  input: PreparedKnowledgeEventOperation,
  policy: BusinessPolicy,
): BusinessPolicyPublishedEvent => {
  const event: unknown = Object.freeze({
    ...eventBase(input, policy.policy_id, "business_policy", policy.version_no),
    event_type: "business_policy.published" as const,
    payload: Object.freeze({ business_policy_version: policy.version_no }),
    schema_id: "BusinessPolicyPublishedDomainEvent.v1",
  });
  if (!isSchemaValue(DomainEventSchemas["business_policy.published"], event)) {
    throw new KnowledgeConfigurationReplayError();
  }
  return event;
};

const insertAudit = async (
  session: TenantDbSession,
  input: PreparedKnowledgeOperation,
  action: string,
  targetType: "business_policy" | "faq",
  targetId: ResourceId,
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
  input: PreparedKnowledgeOperation,
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
  if (row === undefined) throw new KnowledgeConfigurationReplayError();
  if (!bytesEqual(input.idempotency.requestHash, row.request_hash)) {
    throw new KnowledgeConfigurationIdempotencyError();
  }
  return row;
};

const encodeMutation = (
  protector: FaqPolicyConfigurationReplayProtector,
  scope: string,
  mutation: KnowledgeMutation,
): Uint8Array => {
  const protectedValue = protector.protect(
    scope,
    new TextEncoder().encode(JSON.stringify(mutation)),
  );
  if (protectedValue.byteLength < 1 || protectedValue.byteLength > 65_536) {
    throw new KnowledgeConfigurationReplayError();
  }
  return protectedValue;
};

const decodeMutation = (
  protector: FaqPolicyConfigurationReplayProtector,
  scope: string,
  ciphertext: unknown,
  resource: "faq" | "policy",
): KnowledgeMutation => {
  if (!(ciphertext instanceof Uint8Array) && !Buffer.isBuffer(ciphertext)) {
    throw new KnowledgeConfigurationReplayError();
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        protector.reveal(scope, new Uint8Array(ciphertext)),
      ),
    ) as unknown;
  } catch {
    throw new KnowledgeConfigurationReplayError();
  }
  if (!isFaqPolicyMutationReplay(value, resource)) {
    throw new KnowledgeConfigurationReplayError();
  }
  return value;
};

const finalizeIdempotency = async (
  session: TenantDbSession,
  input: PreparedKnowledgeOperation,
  resourceType: "business_policy" | "faq",
  resourceId: ResourceId,
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
  if (result.rowCount !== 1) throw new KnowledgeConfigurationReplayError();
};

const idempotentMutation = async <Value extends BusinessPolicy | Faq>(
  runtime: TenantDatabaseRuntime,
  protector: FaqPolicyConfigurationReplayProtector,
  input: PreparedKnowledgeOperation,
  permission: "configuration.publish" | "configuration.write",
  replayResource: "faq" | "policy",
  resourceType: "business_policy" | "faq",
  resourceId: ResourceId,
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
            throw new KnowledgeConfigurationIdempotencyError();
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

const requireQualificationInput = (value: unknown): void => {
  if (
    typeof value !== "object" ||
    value === null ||
    Reflect.get(value, "policy_type") !== "qualification" ||
    Reflect.get(value, "schema_version") !== 1 ||
    !isSchemaValue(QualificationPolicyV1RulesSchema, Reflect.get(value, "rules"))
  ) {
    throw new KnowledgeConfigurationValidationError();
  }
};

const lockFaqForMutation = async (
  session: TenantDbSession,
  faqId: ResourceId,
  expectedVersion: ResourceVersion,
): Promise<Faq> => {
  const initial = await loadFaq(session, faqId);
  await advisoryLock(session, "faq", initial.faq_key);
  const current = await loadFaq(session, faqId, undefined, undefined, true);
  if (current.version_no !== expectedVersion) {
    throw new RepositoryVersionConflictError("faq", current.version_no);
  }
  return current;
};

const lockPolicyForMutation = async (
  session: TenantDbSession,
  policyId: ResourceId,
  expectedVersion: ResourceVersion,
): Promise<BusinessPolicy> => {
  await requireSupportedPolicyTarget(session, policyId);
  const initial = await loadPolicy(session, policyId);
  await advisoryLock(session, "policy", initial.policy_key);
  const current = await loadPolicy(session, policyId, true);
  if (current.version_no !== expectedVersion) {
    throw new RepositoryVersionConflictError("business_policy", current.version_no);
  }
  return current;
};

export const createFaqPolicyConfigurationStore = (
  runtime: TenantDatabaseRuntime,
  replayProtector: FaqPolicyConfigurationReplayProtector,
): FaqPolicyConfigurationStore => {
  const store: FaqPolicyConfigurationStore = {
    createFaqDraft: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "faq",
        "faq",
        input.faqId,
        async (session) => {
          await advisoryLock(session, "faq", input.value.faq_key);
          await requireFaqScopeTargets(
            session,
            input.authorization,
            input.value.service_id,
            input.value.location_id,
            input.occurredAt,
            false,
          );
          const version = await nextFaqVersion(session, input.value.faq_key);
          await executeTenantWrite(
            session,
            `insert into faqs
              (organization_id,id,faq_key,version_no,service_id,location_id,
               question_i18n,answer_i18n,status,effective_from,effective_to,
               content_hash,published_by_user_id,created_at)
             values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'draft',null,null,$9,null,$10)`,
            [
              input.faqId,
              input.value.faq_key,
              version,
              input.value.service_id,
              input.value.location_id,
              JSON.stringify(input.value.question_i18n),
              JSON.stringify(input.value.answer_i18n),
              Buffer.from(input.contentHash, "hex"),
              input.occurredAt,
            ],
          );
          await insertAudit(session, input, "faq.draft_created", "faq", input.faqId, {
            faq_key: input.value.faq_key,
            location_id: input.value.location_id,
            service_id: input.value.service_id,
            version,
          });
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadFaq(session, input.faqId),
          });
        },
      ),

    updateFaqDraft: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "faq",
        "faq",
        input.faqId,
        async (session) => {
          const current = await lockFaqForMutation(session, input.faqId, input.expectedVersion);
          if (current.status !== "draft") throw new KnowledgeConfigurationBusinessRuleError();
          await requireFaqScopeTargets(
            session,
            input.authorization,
            input.value.service_id,
            input.value.location_id,
            input.occurredAt,
            false,
          );
          const version = await nextFaqVersion(session, current.faq_key, current.version_no + 1);
          const result = await executeTenantWrite(
            session,
            `update faqs
                set service_id = $3, location_id = $4, question_i18n = $5::jsonb,
                    answer_i18n = $6::jsonb, content_hash = $7, version_no = $8
              where organization_id = $1 and id = $2 and status = 'draft'
                and version_no = $9`,
            [
              input.faqId,
              input.value.service_id,
              input.value.location_id,
              JSON.stringify(input.value.question_i18n),
              JSON.stringify(input.value.answer_i18n),
              Buffer.from(input.contentHash, "hex"),
              version,
              input.expectedVersion,
            ],
          );
          if (result.rowCount !== 1) {
            throw new RepositoryVersionConflictError("faq", current.version_no);
          }
          await insertAudit(session, input, "faq.draft_updated", "faq", input.faqId, {
            expected_version: input.expectedVersion,
            new_version: version,
          });
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadFaq(session, input.faqId),
          });
        },
      ),

    publishFaq: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "faq",
        "faq",
        input.faqId,
        async (session) => {
          const current = await lockFaqForMutation(session, input.faqId, input.expectedVersion);
          if (current.status !== "draft") throw new KnowledgeConfigurationBusinessRuleError();
          await requireFaqScopeTargets(
            session,
            input.authorization,
            current.service_id,
            current.location_id,
            input.occurredAt,
            true,
          );
          requireFaqLocale(current, await defaultLocale(session));
          type PriorRow = QueryResultRow & { effective_from: unknown; version_no: unknown };
          const priorRows = await executeTenantRead<PriorRow>(
            session,
            `select version_no, effective_from from faqs
              where organization_id = $1 and faq_key = $2
                and service_id is not distinct from $3::uuid
                and location_id is not distinct from $4::uuid
                and status = 'published'
              for update`,
            [current.faq_key, current.service_id, current.location_id],
          );
          const prior = priorRows[0];
          if (
            prior !== undefined &&
            (mapAggregateVersion(prior.version_no) >= current.version_no ||
              new Date(mapUtcTimestamp(prior.effective_from)).getTime() >=
                new Date(input.occurredAt).getTime())
          ) {
            throw new KnowledgeConfigurationBusinessRuleError();
          }
          await executeTenantWrite(
            session,
            `update faqs set status = 'retired', effective_to = $5
              where organization_id = $1 and faq_key = $2
                and service_id is not distinct from $3::uuid
                and location_id is not distinct from $4::uuid
                and status = 'published'`,
            [current.faq_key, current.service_id, current.location_id, input.occurredAt],
          );
          const published = await executeTenantWrite(
            session,
            `update faqs
                set status = 'published', effective_from = $3, effective_to = null,
                    published_by_user_id = $4
              where organization_id = $1 and id = $2 and status = 'draft'
                and version_no = $5`,
            [input.faqId, input.occurredAt, input.authorization.userId, input.expectedVersion],
          );
          if (published.rowCount !== 1) {
            throw new RepositoryVersionConflictError("faq", current.version_no);
          }
          const resource = await loadFaq(session, input.faqId);
          const event = faqPublishedEvent(input, resource);
          await insertAudit(session, input, "faq.published", "faq", input.faqId, {
            faq_key: resource.faq_key,
            location_id: resource.location_id,
            service_id: resource.service_id,
            version: resource.version_no,
          });
          await insertOutbox(session, event);
          return Object.freeze({ events: Object.freeze([event]), resource });
        },
      ),

    retireFaq: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "faq",
        "faq",
        input.faqId,
        async (session) => {
          const current = await lockFaqForMutation(session, input.faqId, input.expectedVersion);
          if (current.status === "retired") {
            return Object.freeze({ events: Object.freeze([]), resource: current });
          }
          if (current.status !== "published" || current.effective_from === null) {
            throw new KnowledgeConfigurationBusinessRuleError();
          }
          if (new Date(input.occurredAt).getTime() <= new Date(current.effective_from).getTime()) {
            throw new KnowledgeConfigurationBusinessRuleError();
          }
          const result = await executeTenantWrite(
            session,
            `update faqs set status = 'retired', effective_to = $3
              where organization_id = $1 and id = $2 and status = 'published'
                and version_no = $4`,
            [input.faqId, input.occurredAt, input.expectedVersion],
          );
          if (result.rowCount !== 1) throw new KnowledgeConfigurationBusinessRuleError();
          await insertAudit(session, input, "faq.retired", "faq", input.faqId, {
            version: input.expectedVersion,
          });
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadFaq(session, input.faqId),
          });
        },
      ),

    getFaq: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            return resultSuccess(
              await loadFaq(session, input.faqId, input.authorization, input.readAt),
            );
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },

    listFaqs: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
              throw new KnowledgeConfigurationValidationError();
            }
            const restricted = input.authorization.locationScope === "restricted";
            const allowed = restricted ? input.authorization.allowedLocationIds : null;
            if (restricted && allowed?.length === 0) {
              return resultSuccess(Object.freeze({ items: Object.freeze([]), next: null }));
            }
            const rows = await executeTenantRead<FaqRow>(
              session,
              `${FAQ_SELECT}
                where f.organization_id = $1
                  and ($2::text is null or f.status = $2)
                  and ($3::uuid is null or f.location_id = $3)
                  and ($4::uuid is null or f.service_id = $4)
                  and ($5::timestamptz is null or (f.created_at, f.id) < ($5, $6::uuid))
                  and (not $7::boolean
                    or (f.location_id is not null and f.location_id = any($8::uuid[]))
                    or (f.location_id is null and f.service_id is not null and exists (
                      select 1 from service_locations sl
                       where sl.organization_id = f.organization_id
                         and sl.service_id = f.service_id
                         and sl.location_id = any($8::uuid[]) and sl.status = 'active'
                         and sl.effective_from <= $9::timestamptz
                         and (sl.effective_to is null or sl.effective_to > $9::timestamptz))))
                order by f.created_at desc, f.id desc
                limit $10`,
              [
                input.status,
                input.locationId,
                input.serviceId,
                input.after?.createdAt ?? null,
                input.after?.faqId ?? null,
                restricted,
                allowed,
                input.readAt,
                input.limit + 1,
              ],
            );
            const selected = rows.slice(0, input.limit);
            const items = Object.freeze(selected.map((row) => faqFromRow(row)));
            const last = selected.at(-1);
            const next: FaqListPosition | null =
              rows.length > input.limit && last !== undefined
                ? Object.freeze({
                    createdAt: mapUtcTimestamp(last.created_at),
                    faqId: mapResourceId(last.id),
                  })
                : null;
            return resultSuccess(Object.freeze({ items, next }));
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },

    createPolicyDraft: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "policy",
        "business_policy",
        input.policyId,
        async (session) => {
          if (input.authorization.locationScope !== "all") {
            throw new RepositoryNotFoundError("business_policy");
          }
          requireQualificationInput(input.value);
          await advisoryLock(session, "policy", input.value.policy_key);
          const version = await nextPolicyVersion(session, input.value.policy_key);
          await executeTenantWrite(
            session,
            `insert into business_policies
              (organization_id,id,policy_key,version_no,policy_type,schema_version,
               rules_jsonb,status,effective_from,effective_to,content_hash,
               published_by_user_id,created_at)
             values ($1,$2,$3,$4,'qualification',1,$5::jsonb,'draft',null,null,$6,null,$7)`,
            [
              input.policyId,
              input.value.policy_key,
              version,
              JSON.stringify(input.value.rules),
              Buffer.from(input.contentHash, "hex"),
              input.occurredAt,
            ],
          );
          await insertAudit(
            session,
            input,
            "business_policy.draft_created",
            "business_policy",
            input.policyId,
            { policy_key: input.value.policy_key, policy_type: "qualification", version },
          );
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadPolicy(session, input.policyId),
          });
        },
      ),

    updatePolicyDraft: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.write",
        "policy",
        "business_policy",
        input.policyId,
        async (session) => {
          if (input.authorization.locationScope !== "all") {
            throw new RepositoryNotFoundError("business_policy");
          }
          requireQualificationInput(input.value);
          const current = await lockPolicyForMutation(
            session,
            input.policyId,
            input.expectedVersion,
          );
          if (current.status !== "draft") throw new KnowledgeConfigurationBusinessRuleError();
          const version = await nextPolicyVersion(
            session,
            current.policy_key,
            current.version_no + 1,
          );
          const result = await executeTenantWrite(
            session,
            `update business_policies
                set rules_jsonb = $3::jsonb, content_hash = $4, version_no = $5
              where organization_id = $1 and id = $2 and status = 'draft'
                and policy_type = 'qualification' and schema_version = 1
                and version_no = $6`,
            [
              input.policyId,
              JSON.stringify(input.value.rules),
              Buffer.from(input.contentHash, "hex"),
              version,
              input.expectedVersion,
            ],
          );
          if (result.rowCount !== 1) {
            throw new RepositoryVersionConflictError("business_policy", current.version_no);
          }
          await insertAudit(
            session,
            input,
            "business_policy.draft_updated",
            "business_policy",
            input.policyId,
            { expected_version: input.expectedVersion, new_version: version },
          );
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadPolicy(session, input.policyId),
          });
        },
      ),

    publishPolicy: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "policy",
        "business_policy",
        input.policyId,
        async (session) => {
          if (input.authorization.locationScope !== "all") {
            throw new RepositoryNotFoundError("business_policy");
          }
          const current = await lockPolicyForMutation(
            session,
            input.policyId,
            input.expectedVersion,
          );
          if (current.status !== "draft") throw new KnowledgeConfigurationBusinessRuleError();
          type PriorRow = QueryResultRow & { effective_from: unknown; version_no: unknown };
          const priorRows = await executeTenantRead<PriorRow>(
            session,
            `select version_no, effective_from from business_policies
              where organization_id = $1 and policy_key = $2
                and policy_type = 'qualification' and status = 'published'
              for update`,
            [current.policy_key],
          );
          const prior = priorRows[0];
          if (
            prior !== undefined &&
            (mapAggregateVersion(prior.version_no) >= current.version_no ||
              new Date(mapUtcTimestamp(prior.effective_from)).getTime() >=
                new Date(input.occurredAt).getTime())
          ) {
            throw new KnowledgeConfigurationBusinessRuleError();
          }
          await executeTenantWrite(
            session,
            `update business_policies set status = 'retired', effective_to = $3
              where organization_id = $1 and policy_key = $2
                and policy_type = 'qualification' and status = 'published'`,
            [current.policy_key, input.occurredAt],
          );
          const published = await executeTenantWrite(
            session,
            `update business_policies
                set status = 'published', effective_from = $3, effective_to = null,
                    published_by_user_id = $4
              where organization_id = $1 and id = $2 and status = 'draft'
                and policy_type = 'qualification' and schema_version = 1
                and version_no = $5`,
            [input.policyId, input.occurredAt, input.authorization.userId, input.expectedVersion],
          );
          if (published.rowCount !== 1) {
            throw new RepositoryVersionConflictError("business_policy", current.version_no);
          }
          const resource = await loadPolicy(session, input.policyId);
          const event = businessPolicyPublishedEvent(input, resource);
          await insertAudit(
            session,
            input,
            "business_policy.published",
            "business_policy",
            input.policyId,
            { policy_type: "qualification", schema_version: 1, version: resource.version_no },
          );
          await insertOutbox(session, event);
          return Object.freeze({ events: Object.freeze([event]), resource });
        },
      ),

    retirePolicy: async (input) =>
      idempotentMutation(
        runtime,
        replayProtector,
        input,
        "configuration.publish",
        "policy",
        "business_policy",
        input.policyId,
        async (session) => {
          if (input.authorization.locationScope !== "all") {
            throw new RepositoryNotFoundError("business_policy");
          }
          const current = await lockPolicyForMutation(
            session,
            input.policyId,
            input.expectedVersion,
          );
          if (current.status === "retired") {
            return Object.freeze({ events: Object.freeze([]), resource: current });
          }
          if (current.status !== "published" || current.effective_from === null) {
            throw new KnowledgeConfigurationBusinessRuleError();
          }
          if (new Date(input.occurredAt).getTime() <= new Date(current.effective_from).getTime()) {
            throw new KnowledgeConfigurationBusinessRuleError();
          }
          const result = await executeTenantWrite(
            session,
            `update business_policies set status = 'retired', effective_to = $3
              where organization_id = $1 and id = $2 and status = 'published'
                and policy_type = 'qualification' and schema_version = 1
                and version_no = $4`,
            [input.policyId, input.occurredAt, input.expectedVersion],
          );
          if (result.rowCount !== 1) throw new KnowledgeConfigurationBusinessRuleError();
          await insertAudit(
            session,
            input,
            "business_policy.retired",
            "business_policy",
            input.policyId,
            { policy_type: "qualification", version: input.expectedVersion },
          );
          return Object.freeze({
            events: Object.freeze([]),
            resource: await loadPolicy(session, input.policyId),
          });
        },
      ),

    getPolicy: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            if (input.authorization.locationScope !== "all") {
              throw new RepositoryNotFoundError("business_policy");
            }
            return resultSuccess(await loadPolicy(session, input.policyId));
          },
        );
      } catch (error) {
        return mapExpectedFailure(error);
      }
    },

    listPolicies: async (input) => {
      try {
        return await runtime.withTenantTransaction(
          input.authorization.organizationId,
          async (session) => {
            await requireCurrentActor(session, input.authorization, "configuration.read");
            if (input.authorization.locationScope !== "all") {
              throw new RepositoryNotFoundError("business_policy");
            }
            if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
              throw new KnowledgeConfigurationValidationError();
            }
            if (input.policyType !== null && input.policyType !== "qualification") {
              return resultSuccess(Object.freeze({ items: Object.freeze([]), next: null }));
            }
            const rows = await executeTenantRead<PolicyRow>(
              session,
              `${POLICY_SELECT}
                where bp.organization_id = $1
                  and bp.policy_type = 'qualification' and bp.schema_version = 1
                  and bp.rules_jsonb = $2::jsonb
                  and ($3::text is null or bp.status = $3)
                  and ($4::timestamptz is null or (bp.created_at, bp.id) < ($4, $5::uuid))
                order by bp.created_at desc, bp.id desc
                limit $6`,
              [
                QUALIFICATION_V1_RULES_JSON,
                input.status,
                input.after?.createdAt ?? null,
                input.after?.policyId ?? null,
                input.limit + 1,
              ],
            );
            const selected = rows.slice(0, input.limit);
            const items = Object.freeze(selected.map((row) => policyFromRow(row)));
            const last = selected.at(-1);
            const next: PolicyListPosition | null =
              rows.length > input.limit && last !== undefined
                ? Object.freeze({
                    createdAt: mapUtcTimestamp(last.created_at),
                    policyId: mapResourceId(last.id),
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

export const SUPPORTED_MUTABLE_BUSINESS_POLICY_TYPES = Object.freeze([
  "qualification",
] as const satisfies readonly BusinessPolicyType[]);
