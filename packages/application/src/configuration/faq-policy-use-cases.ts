import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  BusinessPolicyListFilterSchema,
  BusinessPolicySchema,
  ConfigurationIdempotencyKeySchema,
  ContentHashSchema,
  CorrelationIdSchema,
  CreateBusinessPolicyDraftInputSchema,
  CreateFaqDraftInputSchema,
  DomainEventSchemas,
  EventIdSchema,
  FaqListFilterSchema,
  FaqSchema,
  LocationIdSchema,
  OpaqueCursorSchema,
  PaginationRequestSchema,
  PublishBusinessPolicyInputSchema,
  PublishFaqInputSchema,
  RequestIdSchema,
  ResourceIdSchema,
  ResourceVersionSchema,
  RetireBusinessPolicyInputSchema,
  RetireFaqInputSchema,
  ServiceIdSchema,
  UpdateBusinessPolicyDraftInputSchema,
  UpdateFaqDraftInputSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type BusinessPolicy,
  type BusinessPolicyListFilter,
  type ConfigurationIdempotencyKey,
  type ContentHash,
  type CorrelationId,
  type CreateBusinessPolicyDraftInput,
  type CreateFaqDraftInput,
  type DomainEventFor,
  type EventId,
  type Faq,
  type LocationId,
  type OpaqueCursor,
  type RequestId,
  type ResourceId,
  type ResourceVersion,
  type ServiceId,
  type UpdateBusinessPolicyDraftInput,
  type UpdateFaqDraftInput,
  type UtcTimestamp,
  type VersionedConfigurationStatus,
} from "@lead-agent/contracts";
import {
  createSecurityIdentifierFactory,
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
  type SecurityIdentifierFactory,
} from "@lead-agent/security";

import type {
  BusinessPolicyConfigurationUseCases,
  ConfigurationMutation,
  ConfigurationResult,
  FaqConfigurationUseCases,
} from "./ports.js";

const IDEMPOTENCY_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_LOCK_MILLISECONDS = 5 * 60 * 1_000;
const CURSOR_SIGNATURE_BYTES = 32;

type FaqPublishedEvent = DomainEventFor<"faq.published">;
type BusinessPolicyPublishedEvent = DomainEventFor<"business_policy.published">;

export type FaqListPosition = Readonly<{ createdAt: UtcTimestamp; faqId: ResourceId }>;
export type PolicyListPosition = Readonly<{ createdAt: UtcTimestamp; policyId: ResourceId }>;

export type PreparedKnowledgeIdempotency = Readonly<{
  expiresAt: UtcTimestamp;
  id: ResourceId;
  keyHash: Uint8Array;
  lockedUntil: UtcTimestamp;
  principalIdHash: Uint8Array;
  requestHash: Uint8Array;
  scope: string;
}>;

export type PreparedKnowledgeOperation = Readonly<{
  auditId: ResourceId;
  authorization: AuthorizationContext;
  correlationId: CorrelationId;
  idempotency: PreparedKnowledgeIdempotency;
  occurredAt: UtcTimestamp;
  requestId: RequestId;
}>;

export type PreparedKnowledgeEventOperation = PreparedKnowledgeOperation &
  Readonly<{ eventId: EventId }>;

export interface FaqPolicyConfigurationStore {
  createFaqDraft(
    input: PreparedKnowledgeOperation &
      Readonly<{
        contentHash: ContentHash;
        faqId: ResourceId;
        value: CreateFaqDraftInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  updateFaqDraft(
    input: PreparedKnowledgeOperation &
      Readonly<{
        contentHash: ContentHash;
        expectedVersion: ResourceVersion;
        faqId: ResourceId;
        value: UpdateFaqDraftInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  publishFaq(
    input: PreparedKnowledgeEventOperation &
      Readonly<{ expectedVersion: ResourceVersion; faqId: ResourceId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  retireFaq(
    input: PreparedKnowledgeOperation &
      Readonly<{ expectedVersion: ResourceVersion; faqId: ResourceId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<Faq>>>;
  getFaq(
    input: Readonly<{
      authorization: AuthorizationContext;
      faqId: ResourceId;
      readAt: UtcTimestamp;
    }>,
  ): Promise<ConfigurationResult<Faq>>;
  listFaqs(
    input: Readonly<{
      after: FaqListPosition | null;
      authorization: AuthorizationContext;
      limit: number;
      locationId: LocationId | null;
      readAt: UtcTimestamp;
      serviceId: ServiceId | null;
      status: VersionedConfigurationStatus | null;
    }>,
  ): Promise<
    ConfigurationResult<Readonly<{ items: readonly Faq[]; next: FaqListPosition | null }>>
  >;
  createPolicyDraft(
    input: PreparedKnowledgeOperation &
      Readonly<{
        contentHash: ContentHash;
        policyId: ResourceId;
        value: CreateBusinessPolicyDraftInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  updatePolicyDraft(
    input: PreparedKnowledgeOperation &
      Readonly<{
        contentHash: ContentHash;
        expectedVersion: ResourceVersion;
        policyId: ResourceId;
        value: UpdateBusinessPolicyDraftInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  publishPolicy(
    input: PreparedKnowledgeEventOperation &
      Readonly<{ expectedVersion: ResourceVersion; policyId: ResourceId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  retirePolicy(
    input: PreparedKnowledgeOperation &
      Readonly<{ expectedVersion: ResourceVersion; policyId: ResourceId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<BusinessPolicy>>>;
  getPolicy(
    input: Readonly<{
      authorization: AuthorizationContext;
      policyId: ResourceId;
      readAt: UtcTimestamp;
    }>,
  ): Promise<ConfigurationResult<BusinessPolicy>>;
  listPolicies(
    input: Readonly<{
      after: PolicyListPosition | null;
      authorization: AuthorizationContext;
      limit: number;
      policyType: BusinessPolicyListFilter["policy_type"] | null;
      readAt: UtcTimestamp;
      status: VersionedConfigurationStatus | null;
    }>,
  ): Promise<
    ConfigurationResult<
      Readonly<{ items: readonly BusinessPolicy[]; next: PolicyListPosition | null }>
    >
  >;
}

type FaqCursorPayload = Readonly<{
  afterCreatedAt: UtcTimestamp;
  afterFaqId: ResourceId;
  kind: "faq";
  locationId: LocationId | null;
  organizationId: string;
  scopeHash: string;
  serviceId: ServiceId | null;
  status: VersionedConfigurationStatus | null;
  version: 1;
}>;

type PolicyCursorPayload = Readonly<{
  afterCreatedAt: UtcTimestamp;
  afterPolicyId: ResourceId;
  kind: "policy";
  organizationId: string;
  policyType: BusinessPolicyListFilter["policy_type"] | null;
  status: VersionedConfigurationStatus | null;
  version: 1;
}>;

export interface FaqPolicyCursorCodec {
  decodeFaq(cursor: OpaqueCursor): FaqCursorPayload | null;
  decodePolicy(cursor: OpaqueCursor): PolicyCursorPayload | null;
  encodeFaq(payload: FaqCursorPayload): OpaqueCursor;
  encodePolicy(payload: PolicyCursorPayload): OpaqueCursor;
}

export const isFaqPolicyMutationReplay = (
  value: unknown,
  resource: "faq" | "policy",
): value is ConfigurationMutation<BusinessPolicy | Faq> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (!Array.isArray(candidate["events"])) return false;
  if (
    !candidate["events"].every(
      (event) =>
        isSchemaValue(DomainEventSchemas["faq.published"], event) ||
        isSchemaValue(DomainEventSchemas["business_policy.published"], event),
    )
  ) {
    return false;
  }
  return resource === "faq"
    ? isSchemaValue(FaqSchema, candidate["resource"])
    : isSchemaValue(BusinessPolicySchema, candidate["resource"]);
};

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
};

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right));

const decodeCursorBody = (cursor: OpaqueCursor, signingKey: Uint8Array): unknown => {
  if (!isSchemaValue(OpaqueCursorSchema, cursor)) return null;
  const packed = Buffer.from(cursor, "base64url");
  if (packed.toString("base64url") !== cursor || packed.length <= CURSOR_SIGNATURE_BYTES) {
    return null;
  }
  const body = packed.subarray(0, -CURSOR_SIGNATURE_BYTES);
  const signature = packed.subarray(-CURSOR_SIGNATURE_BYTES);
  const expected = createHmac("sha256", signingKey).update(body).digest();
  if (!equalBytes(expected, signature)) return null;
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return null;
  }
};

const encodeCursorBody = (payload: unknown, signingKey: Uint8Array): OpaqueCursor => {
  const body = Buffer.from(stableJson(payload), "utf8");
  const signature = createHmac("sha256", signingKey).update(body).digest();
  const cursor = Buffer.concat([body, signature]).toString("base64url");
  if (!isSchemaValue(OpaqueCursorSchema, cursor)) {
    throw new TypeError("FAQ/policy configuration cursor exceeds canonical bounds");
  }
  return cursor;
};

const STATUSES = ["draft", "published", "retired"] as const;
const POLICY_TYPES = ["qualification", "booking", "handoff", "safety", "consent"] as const;

const oneOf = <Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] =>
  typeof value === "string" && values.some((candidate) => candidate === value);

export const createFaqPolicyCursorCodec = (signingKey: Uint8Array): FaqPolicyCursorCodec => {
  if (signingKey.byteLength < 32) {
    throw new TypeError("FAQ/policy cursor signing key must contain at least 32 bytes");
  }
  const codec: FaqPolicyCursorCodec = {
    decodeFaq: (cursor) => {
      const value = decodeCursorBody(cursor, signingKey);
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const candidate = value as Readonly<Record<string, unknown>>;
      if (
        candidate["kind"] !== "faq" ||
        candidate["version"] !== 1 ||
        typeof candidate["organizationId"] !== "string" ||
        typeof candidate["scopeHash"] !== "string" ||
        !isSchemaValue(UtcTimestampSchema, candidate["afterCreatedAt"]) ||
        !isSchemaValue(ResourceIdSchema, candidate["afterFaqId"]) ||
        (candidate["locationId"] !== null &&
          !isSchemaValue(LocationIdSchema, candidate["locationId"])) ||
        (candidate["serviceId"] !== null &&
          !isSchemaValue(ServiceIdSchema, candidate["serviceId"])) ||
        (candidate["status"] !== null && !oneOf(candidate["status"], STATUSES))
      ) {
        return null;
      }
      return Object.freeze({
        afterCreatedAt: candidate["afterCreatedAt"],
        afterFaqId: candidate["afterFaqId"],
        kind: "faq",
        locationId: candidate["locationId"],
        organizationId: candidate["organizationId"],
        scopeHash: candidate["scopeHash"],
        serviceId: candidate["serviceId"],
        status: candidate["status"],
        version: 1,
      });
    },
    decodePolicy: (cursor) => {
      const value = decodeCursorBody(cursor, signingKey);
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const candidate = value as Readonly<Record<string, unknown>>;
      if (
        candidate["kind"] !== "policy" ||
        candidate["version"] !== 1 ||
        typeof candidate["organizationId"] !== "string" ||
        !isSchemaValue(UtcTimestampSchema, candidate["afterCreatedAt"]) ||
        !isSchemaValue(ResourceIdSchema, candidate["afterPolicyId"]) ||
        (candidate["policyType"] !== null && !oneOf(candidate["policyType"], POLICY_TYPES)) ||
        (candidate["status"] !== null && !oneOf(candidate["status"], STATUSES))
      ) {
        return null;
      }
      return Object.freeze({
        afterCreatedAt: candidate["afterCreatedAt"],
        afterPolicyId: candidate["afterPolicyId"],
        kind: "policy",
        organizationId: candidate["organizationId"],
        policyType: candidate["policyType"],
        status: candidate["status"],
        version: 1,
      });
    },
    encodeFaq: (payload) => encodeCursorBody(payload, signingKey),
    encodePolicy: (payload) => encodeCursorBody(payload, signingKey),
  };
  return Object.freeze(codec);
};

const digest = (value: string): Uint8Array => createHash("sha256").update(value, "utf8").digest();

const asUtcTimestamp = (date: Date): UtcTimestamp => {
  const value = date.toISOString();
  if (!isSchemaValue(UtcTimestampSchema, value)) throw new TypeError("Clock returned invalid time");
  return value;
};

const issueResourceId = (factory: SecurityIdentifierFactory, now: Date): ResourceId => {
  const value = factory.issueResourceId(now);
  if (!isSchemaValue(ResourceIdSchema, value)) throw new TypeError("Invalid resource ID");
  return value;
};

const issueCorrelationId = (factory: SecurityIdentifierFactory, now: Date): CorrelationId => {
  const value = factory.issueResourceId(now);
  if (!isSchemaValue(CorrelationIdSchema, value)) throw new TypeError("Invalid correlation ID");
  return value;
};

const issueRequestId = (factory: SecurityIdentifierFactory, now: Date): RequestId => {
  const value = factory.issueResourceId(now);
  if (!isSchemaValue(RequestIdSchema, value)) throw new TypeError("Invalid request ID");
  return value;
};

const issueEventId = (factory: SecurityIdentifierFactory, now: Date): EventId => {
  const value = factory.issueResourceId(now);
  if (!isSchemaValue(EventIdSchema, value)) throw new TypeError("Invalid event ID");
  return value;
};

const preparedOperation = (
  authorization: AuthorizationContext,
  idempotencyKey: ConfigurationIdempotencyKey,
  scope: string,
  requestValue: unknown,
  clock: () => Date,
  identifiers: SecurityIdentifierFactory,
): PreparedKnowledgeOperation => {
  const now = clock();
  return Object.freeze({
    auditId: issueResourceId(identifiers, clock()),
    authorization,
    correlationId: issueCorrelationId(identifiers, clock()),
    idempotency: Object.freeze({
      expiresAt: asUtcTimestamp(new Date(now.getTime() + IDEMPOTENCY_LIFETIME_MILLISECONDS)),
      id: issueResourceId(identifiers, clock()),
      keyHash: digest(idempotencyKey),
      lockedUntil: asUtcTimestamp(new Date(now.getTime() + IDEMPOTENCY_LOCK_MILLISECONDS)),
      principalIdHash: digest(authorization.userId),
      requestHash: digest(stableJson(requestValue)),
      scope,
    }),
    occurredAt: asUtcTimestamp(now),
    requestId: issueRequestId(identifiers, clock()),
  });
};

const withEvent = (
  operation: PreparedKnowledgeOperation,
  clock: () => Date,
  identifiers: SecurityIdentifierFactory,
): PreparedKnowledgeEventOperation =>
  Object.freeze({ ...operation, eventId: issueEventId(identifiers, clock()) });

const configurationFailure = <Value>(
  code: "permission_denied" | "resource_not_found" | "validation_failed",
): ConfigurationResult<Value> => Object.freeze({ error: Object.freeze({ code }), ok: false });

const hasConfigurationPermission = (
  authorization: AuthorizationContext,
  permission: "configuration.publish" | "configuration.read" | "configuration.write",
): boolean =>
  isAuthorizationContext(authorization) && hasPermission(authorization.role, permission);

const validateCommandBase = (
  authorization: AuthorizationContext,
  idempotencyKey: unknown,
  permission: "configuration.publish" | "configuration.write",
): "permission_denied" | "validation_failed" | null => {
  if (!hasConfigurationPermission(authorization, permission)) return "permission_denied";
  return isSchemaValue(ConfigurationIdempotencyKeySchema, idempotencyKey)
    ? null
    : "validation_failed";
};

const scopeHashFor = (authorization: AuthorizationContext): string =>
  createHash("sha256")
    .update(
      authorization.locationScope === "all"
        ? "all"
        : `restricted:${[...authorization.allowedLocationIds].sort().join(",")}`,
      "utf8",
    )
    .digest("hex");

const locationAllowed = (authorization: AuthorizationContext, locationId: LocationId): boolean =>
  authorization.locationScope === "all" || authorization.allowedLocationIds.includes(locationId);

const copyLocalizedText = (
  value: Readonly<Partial<Record<"en" | "ru" | "uz", string>>>,
): Readonly<Partial<Record<"en" | "ru" | "uz", string>>> => Object.freeze({ ...value });

const copyFaqCreate = (value: CreateFaqDraftInput): CreateFaqDraftInput =>
  Object.freeze({
    answer_i18n: copyLocalizedText(value.answer_i18n),
    faq_key: value.faq_key,
    location_id: value.location_id,
    question_i18n: copyLocalizedText(value.question_i18n),
    service_id: value.service_id,
  });

const copyFaqUpdate = (value: UpdateFaqDraftInput): UpdateFaqDraftInput =>
  Object.freeze({
    answer_i18n: copyLocalizedText(value.answer_i18n),
    location_id: value.location_id,
    question_i18n: copyLocalizedText(value.question_i18n),
    service_id: value.service_id,
  });

const copyPolicyCreate = (value: CreateBusinessPolicyDraftInput): CreateBusinessPolicyDraftInput =>
  Object.freeze({
    policy_key: value.policy_key,
    policy_type: "qualification",
    rules: Object.freeze({
      ...value.rules,
      disqualification_reasons: copyDisqualificationReasons(),
    }),
    schema_version: 1,
  });

const copyPolicyUpdate = (value: UpdateBusinessPolicyDraftInput): UpdateBusinessPolicyDraftInput =>
  Object.freeze({
    policy_type: "qualification",
    rules: Object.freeze({
      ...value.rules,
      disqualification_reasons: copyDisqualificationReasons(),
    }),
    schema_version: 1,
  });

const copyDisqualificationReasons =
  (): CreateBusinessPolicyDraftInput["rules"]["disqualification_reasons"] => [
    "service_not_offered",
    "location_not_served",
    "not_interested",
    "outside_business_scope",
    "spam_or_abuse",
  ];

const contentHash = (value: unknown): ContentHash => {
  const hash = createHash("sha256").update(stableJson(value), "utf8").digest("hex");
  if (!isSchemaValue(ContentHashSchema, hash)) throw new TypeError("Invalid content hash");
  return hash;
};

type UseCaseOptions = Readonly<{
  clock?: () => Date;
  cursorCodec: FaqPolicyCursorCodec;
  identifierFactory?: SecurityIdentifierFactory;
}>;

export const createFaqConfigurationUseCases = (
  store: FaqPolicyConfigurationStore,
  options: UseCaseOptions,
): FaqConfigurationUseCases => {
  const clock = options.clock ?? (() => new Date());
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  const useCases: FaqConfigurationUseCases = {
    createFaqDraft: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (!isSchemaValue(CreateFaqDraftInputSchema, command.input)) {
        return configurationFailure("validation_failed");
      }
      if (
        command.input.location_id !== null &&
        !locationAllowed(command.authorization, command.input.location_id)
      ) {
        return configurationFailure("resource_not_found");
      }
      const value = copyFaqCreate(command.input);
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.faq.create",
        { input: value },
        clock,
        identifiers,
      );
      return store.createFaqDraft({
        ...operation,
        contentHash: contentHash(copyFaqUpdate(value)),
        faqId: issueResourceId(identifiers, clock()),
        value,
      });
    },
    updateFaqDraft: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(UpdateFaqDraftInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      if (
        command.input.location_id !== null &&
        !locationAllowed(command.authorization, command.input.location_id)
      ) {
        return configurationFailure("resource_not_found");
      }
      const value = copyFaqUpdate(command.input);
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.faq.update",
        { expectedVersion: command.expectedVersion, input: value, target: command.target },
        clock,
        identifiers,
      );
      return store.updateFaqDraft({
        ...operation,
        contentHash: contentHash(value),
        expectedVersion: command.expectedVersion,
        faqId: command.target,
        value,
      });
    },
    publishFaq: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(PublishFaqInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.faq.publish",
          { expectedVersion: command.expectedVersion, input: {}, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.publishFaq({
        ...operation,
        expectedVersion: command.expectedVersion,
        faqId: command.target,
      });
    },
    retireFaq: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(RetireFaqInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.faq.retire",
        { expectedVersion: command.expectedVersion, input: {}, target: command.target },
        clock,
        identifiers,
      );
      return store.retireFaq({
        ...operation,
        expectedVersion: command.expectedVersion,
        faqId: command.target,
      });
    },
    getFaq: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (!isSchemaValue(ResourceIdSchema, query.input.faqId)) {
        return configurationFailure("validation_failed");
      }
      return store.getFaq({
        authorization: query.authorization,
        faqId: query.input.faqId,
        readAt: asUtcTimestamp(clock()),
      });
    },
    listFaqs: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (
        !isSchemaValue(FaqListFilterSchema, query.input.filter) ||
        !isSchemaValue(PaginationRequestSchema, query.input.pagination)
      ) {
        return configurationFailure("validation_failed");
      }
      const locationId = query.input.filter.location_id ?? null;
      if (locationId !== null && !locationAllowed(query.authorization, locationId)) {
        return configurationFailure("resource_not_found");
      }
      const serviceId = query.input.filter.service_id ?? null;
      const status = query.input.filter.status ?? null;
      const scopeHash = scopeHashFor(query.authorization);
      const decoded =
        query.input.pagination.cursor === undefined
          ? null
          : options.cursorCodec.decodeFaq(query.input.pagination.cursor);
      if (
        query.input.pagination.cursor !== undefined &&
        (decoded === null ||
          decoded.organizationId !== query.authorization.organizationId ||
          decoded.scopeHash !== scopeHash ||
          decoded.locationId !== locationId ||
          decoded.serviceId !== serviceId ||
          decoded.status !== status)
      ) {
        return configurationFailure("validation_failed");
      }
      const result = await store.listFaqs({
        after:
          decoded === null
            ? null
            : { createdAt: decoded.afterCreatedAt, faqId: decoded.afterFaqId },
        authorization: query.authorization,
        limit: query.input.pagination.limit ?? 50,
        locationId,
        readAt: asUtcTimestamp(clock()),
        serviceId,
        status,
      });
      if (!result.ok) return result;
      const nextCursor =
        result.value.next === null
          ? null
          : options.cursorCodec.encodeFaq({
              afterCreatedAt: result.value.next.createdAt,
              afterFaqId: result.value.next.faqId,
              kind: "faq",
              locationId,
              organizationId: query.authorization.organizationId,
              scopeHash,
              serviceId,
              status,
              version: 1,
            });
      return Object.freeze({
        ok: true as const,
        value: Object.freeze({ items: result.value.items, nextCursor }),
      });
    },
  };
  return Object.freeze(useCases);
};

export const createBusinessPolicyConfigurationUseCases = (
  store: FaqPolicyConfigurationStore,
  options: UseCaseOptions,
): BusinessPolicyConfigurationUseCases => {
  const clock = options.clock ?? (() => new Date());
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  const useCases: BusinessPolicyConfigurationUseCases = {
    createPolicyDraft: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (command.authorization.locationScope !== "all") {
        return configurationFailure("resource_not_found");
      }
      if (!isSchemaValue(CreateBusinessPolicyDraftInputSchema, command.input)) {
        return configurationFailure("validation_failed");
      }
      const value = copyPolicyCreate(command.input);
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.business_policy.create",
        { input: value },
        clock,
        identifiers,
      );
      return store.createPolicyDraft({
        ...operation,
        contentHash: contentHash(copyPolicyUpdate(value)),
        policyId: issueResourceId(identifiers, clock()),
        value,
      });
    },
    updatePolicyDraft: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (command.authorization.locationScope !== "all") {
        return configurationFailure("resource_not_found");
      }
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(UpdateBusinessPolicyDraftInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const value = copyPolicyUpdate(command.input);
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.business_policy.update",
        { expectedVersion: command.expectedVersion, input: value, target: command.target },
        clock,
        identifiers,
      );
      return store.updatePolicyDraft({
        ...operation,
        contentHash: contentHash(value),
        expectedVersion: command.expectedVersion,
        policyId: command.target,
        value,
      });
    },
    publishPolicy: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (command.authorization.locationScope !== "all") {
        return configurationFailure("resource_not_found");
      }
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(PublishBusinessPolicyInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.business_policy.publish",
          { expectedVersion: command.expectedVersion, input: {}, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.publishPolicy({
        ...operation,
        expectedVersion: command.expectedVersion,
        policyId: command.target,
      });
    },
    retirePolicy: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (command.authorization.locationScope !== "all") {
        return configurationFailure("resource_not_found");
      }
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(RetireBusinessPolicyInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.business_policy.retire",
        { expectedVersion: command.expectedVersion, input: {}, target: command.target },
        clock,
        identifiers,
      );
      return store.retirePolicy({
        ...operation,
        expectedVersion: command.expectedVersion,
        policyId: command.target,
      });
    },
    getPolicy: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (query.authorization.locationScope !== "all") {
        return configurationFailure("resource_not_found");
      }
      if (!isSchemaValue(ResourceIdSchema, query.input.policyId)) {
        return configurationFailure("validation_failed");
      }
      return store.getPolicy({
        authorization: query.authorization,
        policyId: query.input.policyId,
        readAt: asUtcTimestamp(clock()),
      });
    },
    listPolicies: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (query.authorization.locationScope !== "all") {
        return configurationFailure("resource_not_found");
      }
      if (
        !isSchemaValue(BusinessPolicyListFilterSchema, query.input.filter) ||
        !isSchemaValue(PaginationRequestSchema, query.input.pagination)
      ) {
        return configurationFailure("validation_failed");
      }
      const policyType = query.input.filter.policy_type ?? null;
      const status = query.input.filter.status ?? null;
      const decoded =
        query.input.pagination.cursor === undefined
          ? null
          : options.cursorCodec.decodePolicy(query.input.pagination.cursor);
      if (
        query.input.pagination.cursor !== undefined &&
        (decoded === null ||
          decoded.organizationId !== query.authorization.organizationId ||
          decoded.policyType !== policyType ||
          decoded.status !== status)
      ) {
        return configurationFailure("validation_failed");
      }
      const result = await store.listPolicies({
        after:
          decoded === null
            ? null
            : { createdAt: decoded.afterCreatedAt, policyId: decoded.afterPolicyId },
        authorization: query.authorization,
        limit: query.input.pagination.limit ?? 50,
        policyType,
        readAt: asUtcTimestamp(clock()),
        status,
      });
      if (!result.ok) return result;
      const nextCursor =
        result.value.next === null
          ? null
          : options.cursorCodec.encodePolicy({
              afterCreatedAt: result.value.next.createdAt,
              afterPolicyId: result.value.next.policyId,
              kind: "policy",
              organizationId: query.authorization.organizationId,
              policyType,
              status,
              version: 1,
            });
      return Object.freeze({
        ok: true as const,
        value: Object.freeze({ items: result.value.items, nextCursor }),
      });
    },
  };
  return Object.freeze(useCases);
};

export const FAQ_POLICY_CONFIGURATION_EVENTS = Object.freeze([
  "faq.published",
  "business_policy.published",
] as const satisfies readonly (
  FaqPublishedEvent["event_type"] | BusinessPolicyPublishedEvent["event_type"]
)[]);
