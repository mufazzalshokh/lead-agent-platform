import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  ChangeServiceLocationInputSchema,
  ConfigurationIdempotencyKeySchema,
  ContentHashSchema,
  CorrelationIdSchema,
  CreateServiceInputSchema,
  CreateServicePriceDraftInputSchema,
  DeactivateServiceInputSchema,
  DomainEventSchemas,
  EventIdSchema,
  LocationIdSchema,
  OpaqueCursorSchema,
  PaginationRequestSchema,
  PublishServiceInputSchema,
  PublishServicePriceInputSchema,
  RequestIdSchema,
  ResourceIdSchema,
  ResourceVersionSchema,
  RetireServicePriceInputSchema,
  ServiceIdSchema,
  ServiceListFilterSchema,
  ServiceLocationRecordSchema,
  ServicePriceListFilterSchema,
  ServicePriceRecordSchema,
  ServiceRootSchema,
  UpdateServicePriceDraftInputSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ChangeServiceLocationInput,
  type ConfigurationIdempotencyKey,
  type ConfigurationRootStatus,
  type ContentHash,
  type CorrelationId,
  type CreateServiceInput,
  type CreateServicePriceDraftInput,
  type DomainEventFor,
  type EventId,
  type LocationId,
  type OpaqueCursor,
  type PublishServiceInput,
  type RequestId,
  type ResourceId,
  type ResourceVersion,
  type ServiceId,
  type ServiceLocationRecord,
  type ServicePriceRecord,
  type ServicePriceTerms,
  type ServiceRoot,
  type UpdateServicePriceDraftInput,
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
  ConfigurationMutation,
  ConfigurationResult,
  PriceConfigurationUseCases,
  ServiceConfigurationUseCases,
} from "./ports.js";

const IDEMPOTENCY_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_LOCK_MILLISECONDS = 5 * 60 * 1_000;
const CURSOR_SIGNATURE_BYTES = 32;

type ServicePublishedEvent = DomainEventFor<"service.published">;
type ServiceDeactivatedEvent = DomainEventFor<"service.deactivated">;
type ServicePricePublishedEvent = DomainEventFor<"service_price.published">;

export type ServiceListPosition = Readonly<{ code: string; serviceId: ServiceId }>;
export type PriceListPosition = Readonly<{ createdAt: UtcTimestamp; priceId: ResourceId }>;

export type PreparedServiceIdempotency = Readonly<{
  expiresAt: UtcTimestamp;
  id: ResourceId;
  keyHash: Uint8Array;
  lockedUntil: UtcTimestamp;
  principalIdHash: Uint8Array;
  requestHash: Uint8Array;
  scope: string;
}>;

export type PreparedServiceOperation = Readonly<{
  auditId: ResourceId;
  authorization: AuthorizationContext;
  correlationId: CorrelationId;
  idempotency: PreparedServiceIdempotency;
  occurredAt: UtcTimestamp;
  requestId: RequestId;
}>;

export type PreparedServiceEventOperation = PreparedServiceOperation &
  Readonly<{ eventId: EventId }>;

export interface ServicePricingConfigurationStore {
  createService(
    input: PreparedServiceOperation & Readonly<{ serviceId: ServiceId; value: CreateServiceInput }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceRoot>>>;
  publishService(
    input: PreparedServiceEventOperation &
      Readonly<{
        contentHash: ContentHash;
        expectedVersion: ResourceVersion;
        serviceId: ServiceId;
        value: PublishServiceInput;
        versionId: ResourceId;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceRoot>>>;
  deactivateService(
    input: PreparedServiceEventOperation &
      Readonly<{ expectedVersion: ResourceVersion; serviceId: ServiceId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceRoot>>>;
  changeServiceLocation(
    input: PreparedServiceOperation &
      Readonly<{
        expectedVersion: ResourceVersion;
        serviceId: ServiceId;
        value: ChangeServiceLocationInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServiceLocationRecord>>>;
  createPriceDraft(
    input: PreparedServiceOperation &
      Readonly<{
        expectedServiceVersion: ResourceVersion;
        priceId: ResourceId;
        serviceId: ServiceId;
        value: CreateServicePriceDraftInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  updatePriceDraft(
    input: PreparedServiceOperation &
      Readonly<{
        expectedVersion: ResourceVersion;
        priceId: ResourceId;
        value: UpdateServicePriceDraftInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  publishPrice(
    input: PreparedServiceEventOperation &
      Readonly<{ expectedVersion: ResourceVersion; priceId: ResourceId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  retirePrice(
    input: PreparedServiceOperation &
      Readonly<{ expectedVersion: ResourceVersion; priceId: ResourceId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<ServicePriceRecord>>>;
  getService(
    input: Readonly<{
      authorization: AuthorizationContext;
      readAt: UtcTimestamp;
      serviceId: ServiceId;
    }>,
  ): Promise<ConfigurationResult<ServiceRoot>>;
  listServices(
    input: Readonly<{
      after: ServiceListPosition | null;
      authorization: AuthorizationContext;
      limit: number;
      locationId: LocationId | null;
      readAt: UtcTimestamp;
      status: ConfigurationRootStatus | null;
    }>,
  ): Promise<
    ConfigurationResult<
      Readonly<{ items: readonly ServiceRoot[]; next: ServiceListPosition | null }>
    >
  >;
  getPrice(
    input: Readonly<{
      authorization: AuthorizationContext;
      priceId: ResourceId;
      readAt: UtcTimestamp;
    }>,
  ): Promise<ConfigurationResult<ServicePriceRecord>>;
  listPrices(
    input: Readonly<{
      after: PriceListPosition | null;
      authorization: AuthorizationContext;
      limit: number;
      locationId: LocationId | null;
      priceType: ServicePriceTerms["price_type"] | null;
      readAt: UtcTimestamp;
      status: VersionedConfigurationStatus | null;
    }>,
  ): Promise<
    ConfigurationResult<
      Readonly<{ items: readonly ServicePriceRecord[]; next: PriceListPosition | null }>
    >
  >;
}

type ServiceCursorPayload = Readonly<{
  afterCode: string;
  afterServiceId: ServiceId;
  kind: "service";
  locationId: LocationId | null;
  organizationId: string;
  scopeHash: string;
  status: ConfigurationRootStatus | null;
  version: 1;
}>;

type PriceCursorPayload = Readonly<{
  afterCreatedAt: UtcTimestamp;
  afterPriceId: ResourceId;
  kind: "price";
  locationId: LocationId | null;
  organizationId: string;
  priceType: ServicePriceTerms["price_type"] | null;
  scopeHash: string;
  status: VersionedConfigurationStatus | null;
  version: 1;
}>;

export interface ServicePricingCursorCodec {
  decodePrice(cursor: OpaqueCursor): PriceCursorPayload | null;
  decodeService(cursor: OpaqueCursor): ServiceCursorPayload | null;
  encodePrice(payload: PriceCursorPayload): OpaqueCursor;
  encodeService(payload: ServiceCursorPayload): OpaqueCursor;
}

export const isServicePricingMutationReplay = (
  value: unknown,
  resource: "price" | "service" | "service_location",
): value is ConfigurationMutation<ServicePriceRecord | ServiceLocationRecord | ServiceRoot> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (!Array.isArray(candidate["events"])) return false;
  if (
    !candidate["events"].every(
      (event) =>
        isSchemaValue(DomainEventSchemas["service.published"], event) ||
        isSchemaValue(DomainEventSchemas["service.deactivated"], event) ||
        isSchemaValue(DomainEventSchemas["service_price.published"], event),
    )
  ) {
    return false;
  }
  if (resource === "service") return isSchemaValue(ServiceRootSchema, candidate["resource"]);
  if (resource === "service_location") {
    return isSchemaValue(ServiceLocationRecordSchema, candidate["resource"]);
  }
  return isSchemaValue(ServicePriceRecordSchema, candidate["resource"]);
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
  if (packed.toString("base64url") !== cursor || packed.length <= CURSOR_SIGNATURE_BYTES)
    return null;
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
    throw new TypeError("Service configuration cursor exceeds canonical bounds");
  }
  return cursor;
};

const ROOT_STATUSES = ["active", "inactive"] as const;
const PRICE_STATUSES = ["draft", "published", "retired"] as const;
const PRICE_TYPES = ["fixed", "from", "range", "quote_required"] as const;

const oneOf = <Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] =>
  typeof value === "string" && values.some((candidate) => candidate === value);

export const createServicePricingCursorCodec = (
  signingKey: Uint8Array,
): ServicePricingCursorCodec => {
  if (signingKey.byteLength < 32) {
    throw new TypeError("Service configuration cursor signing key must contain at least 32 bytes");
  }
  const codec: ServicePricingCursorCodec = {
    decodePrice: (cursor: OpaqueCursor): PriceCursorPayload | null => {
      const value = decodeCursorBody(cursor, signingKey);
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const candidate = value as Readonly<Record<string, unknown>>;
      if (
        candidate["kind"] !== "price" ||
        candidate["version"] !== 1 ||
        typeof candidate["organizationId"] !== "string" ||
        typeof candidate["scopeHash"] !== "string" ||
        !isSchemaValue(UtcTimestampSchema, candidate["afterCreatedAt"]) ||
        !isSchemaValue(ResourceIdSchema, candidate["afterPriceId"]) ||
        (candidate["locationId"] !== null &&
          !isSchemaValue(LocationIdSchema, candidate["locationId"])) ||
        (candidate["priceType"] !== null && !oneOf(candidate["priceType"], PRICE_TYPES)) ||
        (candidate["status"] !== null && !oneOf(candidate["status"], PRICE_STATUSES))
      ) {
        return null;
      }
      return Object.freeze({
        afterCreatedAt: candidate["afterCreatedAt"],
        afterPriceId: candidate["afterPriceId"],
        kind: "price",
        locationId: candidate["locationId"],
        organizationId: candidate["organizationId"],
        priceType: candidate["priceType"],
        scopeHash: candidate["scopeHash"],
        status: candidate["status"],
        version: 1,
      });
    },
    decodeService: (cursor: OpaqueCursor): ServiceCursorPayload | null => {
      const value = decodeCursorBody(cursor, signingKey);
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const candidate = value as Readonly<Record<string, unknown>>;
      if (
        candidate["kind"] !== "service" ||
        candidate["version"] !== 1 ||
        typeof candidate["organizationId"] !== "string" ||
        typeof candidate["scopeHash"] !== "string" ||
        typeof candidate["afterCode"] !== "string" ||
        !isSchemaValue(ServiceIdSchema, candidate["afterServiceId"]) ||
        (candidate["locationId"] !== null &&
          !isSchemaValue(LocationIdSchema, candidate["locationId"])) ||
        (candidate["status"] !== null && !oneOf(candidate["status"], ROOT_STATUSES))
      ) {
        return null;
      }
      return Object.freeze({
        afterCode: candidate["afterCode"],
        afterServiceId: candidate["afterServiceId"],
        kind: "service",
        locationId: candidate["locationId"],
        organizationId: candidate["organizationId"],
        scopeHash: candidate["scopeHash"],
        status: candidate["status"],
        version: 1,
      });
    },
    encodePrice: (payload) => encodeCursorBody(payload, signingKey),
    encodeService: (payload) => encodeCursorBody(payload, signingKey),
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
const issueServiceId = (factory: SecurityIdentifierFactory, now: Date): ServiceId => {
  const value = factory.issueResourceId(now);
  if (!isSchemaValue(ServiceIdSchema, value)) throw new TypeError("Invalid Service ID");
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
): PreparedServiceOperation => {
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
  operation: PreparedServiceOperation,
  clock: () => Date,
  identifiers: SecurityIdentifierFactory,
): PreparedServiceEventOperation =>
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

const cloneLocalizedText = <Value extends Readonly<Partial<Record<"en" | "ru" | "uz", string>>>>(
  value: Value,
): Value => Object.freeze({ ...value });

const copyServicePublication = (value: PublishServiceInput): PublishServiceInput =>
  Object.freeze({
    description_i18n: cloneLocalizedText(value.description_i18n),
    disclaimer_i18n: cloneLocalizedText(value.disclaimer_i18n),
    duration_guidance_minutes: value.duration_guidance_minutes,
    name_i18n: cloneLocalizedText(value.name_i18n),
  });

const copyPricing = (pricing: ServicePriceTerms): ServicePriceTerms => {
  if (pricing.price_type === "fixed") {
    return Object.freeze({ amount: Object.freeze({ ...pricing.amount }), price_type: "fixed" });
  }
  if (pricing.price_type === "from") {
    return Object.freeze({ minimum: Object.freeze({ ...pricing.minimum }), price_type: "from" });
  }
  if (pricing.price_type === "range") {
    return Object.freeze({
      maximum: Object.freeze({ ...pricing.maximum }),
      minimum: Object.freeze({ ...pricing.minimum }),
      price_type: "range",
    });
  }
  return Object.freeze({ currency: pricing.currency, price_type: "quote_required" });
};

const copyPriceCandidate = (value: CreateServicePriceDraftInput): CreateServicePriceDraftInput =>
  Object.freeze({
    display_text_i18n: cloneLocalizedText(value.display_text_i18n),
    location_id: value.location_id,
    pricing: copyPricing(value.pricing),
  });

type UseCaseOptions = Readonly<{
  clock?: () => Date;
  cursorCodec: ServicePricingCursorCodec;
  identifierFactory?: SecurityIdentifierFactory;
}>;

export const createServiceConfigurationUseCases = (
  store: ServicePricingConfigurationStore,
  options: UseCaseOptions,
): ServiceConfigurationUseCases => {
  const clock = options.clock ?? (() => new Date());
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  const useCases: ServiceConfigurationUseCases = {
    createService: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (!isSchemaValue(CreateServiceInputSchema, command.input)) {
        return configurationFailure("validation_failed");
      }
      const value = Object.freeze({ code: command.input.code });
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.service.create",
        { input: value },
        clock,
        identifiers,
      );
      return store.createService({
        ...operation,
        serviceId: issueServiceId(identifiers, clock()),
        value,
      });
    },
    publishService: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ServiceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(PublishServiceInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const value = copyServicePublication(command.input);
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.service.publish",
          { expectedVersion: command.expectedVersion, input: value, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      const hash = createHash("sha256").update(stableJson(value), "utf8").digest("hex");
      if (!isSchemaValue(ContentHashSchema, hash)) throw new TypeError("Invalid content hash");
      return store.publishService({
        ...operation,
        contentHash: hash,
        expectedVersion: command.expectedVersion,
        serviceId: command.target,
        value,
        versionId: issueResourceId(identifiers, clock()),
      });
    },
    deactivateService: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ServiceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(DeactivateServiceInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.service.deactivate",
          { expectedVersion: command.expectedVersion, input: {}, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.deactivateService({
        ...operation,
        expectedVersion: command.expectedVersion,
        serviceId: command.target,
      });
    },
    changeServiceLocation: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ServiceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(ChangeServiceLocationInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      if (!locationAllowed(command.authorization, command.input.location_id)) {
        return configurationFailure("resource_not_found");
      }
      const value = Object.freeze({ ...command.input });
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.service.location.change",
        { expectedVersion: command.expectedVersion, input: value, target: command.target },
        clock,
        identifiers,
      );
      return store.changeServiceLocation({
        ...operation,
        expectedVersion: command.expectedVersion,
        serviceId: command.target,
        value,
      });
    },
    getService: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (!isSchemaValue(ServiceIdSchema, query.input.serviceId)) {
        return configurationFailure("validation_failed");
      }
      return store.getService({
        authorization: query.authorization,
        readAt: asUtcTimestamp(clock()),
        serviceId: query.input.serviceId,
      });
    },
    listServices: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (
        !isSchemaValue(ServiceListFilterSchema, query.input.filter) ||
        !isSchemaValue(PaginationRequestSchema, query.input.pagination)
      ) {
        return configurationFailure("validation_failed");
      }
      const locationId = query.input.filter.location_id ?? null;
      if (locationId !== null && !locationAllowed(query.authorization, locationId)) {
        return configurationFailure("resource_not_found");
      }
      const status = query.input.filter.status ?? null;
      const scopeHash = scopeHashFor(query.authorization);
      const decoded =
        query.input.pagination.cursor === undefined
          ? null
          : options.cursorCodec.decodeService(query.input.pagination.cursor);
      if (
        query.input.pagination.cursor !== undefined &&
        (decoded === null ||
          decoded.organizationId !== query.authorization.organizationId ||
          decoded.scopeHash !== scopeHash ||
          decoded.status !== status ||
          decoded.locationId !== locationId)
      ) {
        return configurationFailure("validation_failed");
      }
      const result = await store.listServices({
        after:
          decoded === null ? null : { code: decoded.afterCode, serviceId: decoded.afterServiceId },
        authorization: query.authorization,
        limit: query.input.pagination.limit ?? 50,
        locationId,
        readAt: asUtcTimestamp(clock()),
        status,
      });
      if (!result.ok) return result;
      const nextCursor =
        result.value.next === null
          ? null
          : options.cursorCodec.encodeService({
              afterCode: result.value.next.code,
              afterServiceId: result.value.next.serviceId,
              kind: "service",
              locationId,
              organizationId: query.authorization.organizationId,
              scopeHash,
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

export const createPriceConfigurationUseCases = (
  store: ServicePricingConfigurationStore,
  options: UseCaseOptions,
): PriceConfigurationUseCases => {
  const clock = options.clock ?? (() => new Date());
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();
  const useCases: PriceConfigurationUseCases = {
    createPriceDraft: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ServiceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(CreateServicePriceDraftInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      if (
        command.input.location_id !== null &&
        !locationAllowed(command.authorization, command.input.location_id)
      ) {
        return configurationFailure("resource_not_found");
      }
      const value = copyPriceCandidate(command.input);
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.service.price.create",
        { expectedVersion: command.expectedVersion, input: value, target: command.target },
        clock,
        identifiers,
      );
      return store.createPriceDraft({
        ...operation,
        expectedServiceVersion: command.expectedVersion,
        priceId: issueResourceId(identifiers, clock()),
        serviceId: command.target,
        value,
      });
    },
    updatePriceDraft: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(UpdateServicePriceDraftInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      if (
        command.input.location_id !== null &&
        !locationAllowed(command.authorization, command.input.location_id)
      ) {
        return configurationFailure("resource_not_found");
      }
      const value = copyPriceCandidate(command.input);
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.service.price.update",
        { expectedVersion: command.expectedVersion, input: value, target: command.target },
        clock,
        identifiers,
      );
      return store.updatePriceDraft({
        ...operation,
        expectedVersion: command.expectedVersion,
        priceId: command.target,
        value,
      });
    },
    publishPrice: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(PublishServicePriceInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.service.price.publish",
          { expectedVersion: command.expectedVersion, input: {}, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.publishPrice({
        ...operation,
        expectedVersion: command.expectedVersion,
        priceId: command.target,
      });
    },
    retirePrice: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(ResourceIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(RetireServicePriceInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.service.price.retire",
        { expectedVersion: command.expectedVersion, input: {}, target: command.target },
        clock,
        identifiers,
      );
      return store.retirePrice({
        ...operation,
        expectedVersion: command.expectedVersion,
        priceId: command.target,
      });
    },
    getPrice: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (!isSchemaValue(ResourceIdSchema, query.input.priceId)) {
        return configurationFailure("validation_failed");
      }
      return store.getPrice({
        authorization: query.authorization,
        priceId: query.input.priceId,
        readAt: asUtcTimestamp(clock()),
      });
    },
    listPrices: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (
        !isSchemaValue(ServicePriceListFilterSchema, query.input.filter) ||
        !isSchemaValue(PaginationRequestSchema, query.input.pagination)
      ) {
        return configurationFailure("validation_failed");
      }
      const locationId = query.input.filter.location_id ?? null;
      if (locationId !== null && !locationAllowed(query.authorization, locationId)) {
        return configurationFailure("resource_not_found");
      }
      const priceType = query.input.filter.price_type ?? null;
      const status = query.input.filter.status ?? null;
      const scopeHash = scopeHashFor(query.authorization);
      const decoded =
        query.input.pagination.cursor === undefined
          ? null
          : options.cursorCodec.decodePrice(query.input.pagination.cursor);
      if (
        query.input.pagination.cursor !== undefined &&
        (decoded === null ||
          decoded.organizationId !== query.authorization.organizationId ||
          decoded.scopeHash !== scopeHash ||
          decoded.locationId !== locationId ||
          decoded.priceType !== priceType ||
          decoded.status !== status)
      ) {
        return configurationFailure("validation_failed");
      }
      const result = await store.listPrices({
        after:
          decoded === null
            ? null
            : { createdAt: decoded.afterCreatedAt, priceId: decoded.afterPriceId },
        authorization: query.authorization,
        limit: query.input.pagination.limit ?? 50,
        locationId,
        priceType,
        readAt: asUtcTimestamp(clock()),
        status,
      });
      if (!result.ok) return result;
      const nextCursor =
        result.value.next === null
          ? null
          : options.cursorCodec.encodePrice({
              afterCreatedAt: result.value.next.createdAt,
              afterPriceId: result.value.next.priceId,
              kind: "price",
              locationId,
              organizationId: query.authorization.organizationId,
              priceType,
              scopeHash,
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

export const SERVICE_CONFIGURATION_EVENTS = Object.freeze([
  "service.published",
  "service.deactivated",
  "service_price.published",
] as const satisfies readonly (
  | ServicePublishedEvent["event_type"]
  | ServiceDeactivatedEvent["event_type"]
  | ServicePricePublishedEvent["event_type"]
)[]);
