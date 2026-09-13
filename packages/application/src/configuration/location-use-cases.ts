import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  CancelLocationClosureInputSchema,
  ConfigurationIdempotencyKeySchema,
  ContentHashSchema,
  CreateLocationClosureInputSchema,
  CreateLocationInputSchema,
  DeactivateLocationInputSchema,
  DomainEventSchemas,
  CorrelationIdSchema,
  EventIdSchema,
  LocationClosureRecordSchema,
  LocationIdSchema,
  LocationListFilterSchema,
  LocationRootSchema,
  OpaqueCursorSchema,
  PaginationRequestSchema,
  PublishLocationInputSchema,
  RequestIdSchema,
  ResourceIdSchema,
  ResourceVersionSchema,
  SupersedeLocationClosureInputSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ConfigurationIdempotencyKey,
  type CorrelationId,
  type ContentHash,
  type CreateLocationClosureInput,
  type CreateLocationInput,
  type DomainEventFor,
  type EventId,
  type LocationClosureRecord,
  type LocationId,
  type LocationListFilter,
  type LocationRoot,
  type OpaqueCursor,
  type PublishLocationInput,
  type RequestId,
  type ResourceId,
  type ResourceVersion,
  type UtcTimestamp,
  type WeeklyBusinessHours,
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
  LocationConfigurationUseCases,
} from "./ports.js";

const IDEMPOTENCY_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_LOCK_MILLISECONDS = 5 * 60 * 1_000;
const CURSOR_SIGNATURE_BYTES = 32;

type LocationChangedEvent = DomainEventFor<"location.changed">;
type LocationChangedField = LocationChangedEvent["payload"]["changed_location_fields"][number];

export type LocationListPosition = Readonly<{
  code: string;
  locationId: LocationId;
}>;

export type PreparedIdempotency = Readonly<{
  expiresAt: UtcTimestamp;
  id: ResourceId;
  keyHash: Uint8Array;
  lockedUntil: UtcTimestamp;
  principalIdHash: Uint8Array;
  requestHash: Uint8Array;
  scope: string;
}>;

export type PreparedLocationOperation = Readonly<{
  auditId: ResourceId;
  authorization: AuthorizationContext;
  correlationId: CorrelationId;
  idempotency: PreparedIdempotency;
  occurredAt: UtcTimestamp;
  requestId: RequestId;
}>;

export type PreparedLocationEventOperation = PreparedLocationOperation &
  Readonly<{ eventId: EventId }>;

export interface LocationConfigurationStore {
  createLocation(
    input: PreparedLocationOperation &
      Readonly<{ locationId: LocationId; value: CreateLocationInput }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationRoot>>>;
  publishLocation(
    input: PreparedLocationEventOperation &
      Readonly<{
        contentHash: ContentHash;
        expectedVersion: ResourceVersion;
        hourIds: readonly ResourceId[];
        locationId: LocationId;
        value: PublishLocationInput;
        versionId: ResourceId;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationRoot>>>;
  deactivateLocation(
    input: PreparedLocationEventOperation &
      Readonly<{ expectedVersion: ResourceVersion; locationId: LocationId }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationRoot>>>;
  createClosure(
    input: PreparedLocationEventOperation &
      Readonly<{
        closureId: ResourceId;
        expectedVersion: ResourceVersion;
        locationId: LocationId;
        value: CreateLocationClosureInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationClosureRecord>>>;
  supersedeClosure(
    input: PreparedLocationEventOperation &
      Readonly<{
        closureId: ResourceId;
        expectedVersion: ResourceVersion;
        locationId: LocationId;
        replacementId: ResourceId;
        value: CreateLocationClosureInput;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationClosureRecord>>>;
  cancelClosure(
    input: PreparedLocationEventOperation &
      Readonly<{
        closureId: ResourceId;
        expectedVersion: ResourceVersion;
        locationId: LocationId;
      }>,
  ): Promise<ConfigurationResult<ConfigurationMutation<LocationClosureRecord>>>;
  getLocation(
    input: Readonly<{ authorization: AuthorizationContext; locationId: LocationId }>,
  ): Promise<ConfigurationResult<LocationRoot>>;
  listLocations(
    input: Readonly<{
      after: LocationListPosition | null;
      authorization: AuthorizationContext;
      limit: number;
      status: LocationListFilter["status"] | null;
    }>,
  ): Promise<
    ConfigurationResult<
      Readonly<{ items: readonly LocationRoot[]; next: LocationListPosition | null }>
    >
  >;
}

type LocationCursorPayload = Readonly<{
  afterCode: string;
  afterLocationId: LocationId;
  organizationId: string;
  scopeHash: string;
  status: LocationListFilter["status"] | null;
  version: 1;
}>;

export interface LocationCursorCodec {
  decode(cursor: OpaqueCursor): LocationCursorPayload | null;
  encode(payload: LocationCursorPayload): OpaqueCursor;
}

export const isLocationMutationReplay = (
  value: unknown,
  resource: "closure" | "location",
): value is ConfigurationMutation<LocationClosureRecord | LocationRoot> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (!Array.isArray(candidate["events"])) return false;
  if (
    !candidate["events"].every((event) =>
      isSchemaValue(DomainEventSchemas["location.changed"], event),
    )
  ) {
    return false;
  }
  return resource === "location"
    ? isSchemaValue(LocationRootSchema, candidate["resource"])
    : isSchemaValue(LocationClosureRecordSchema, candidate["resource"]);
};

const digest = (value: string): Uint8Array => createHash("sha256").update(value, "utf8").digest();

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
};

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right));

export const createLocationCursorCodec = (signingKey: Uint8Array): LocationCursorCodec => {
  if (signingKey.byteLength < 32) {
    throw new TypeError("Location cursor signing key must contain at least 32 bytes");
  }
  const sign = (payload: Uint8Array): Uint8Array =>
    createHmac("sha256", signingKey).update(payload).digest();

  const codec: LocationCursorCodec = Object.freeze({
    decode: (cursor: OpaqueCursor): LocationCursorPayload | null => {
      if (!isSchemaValue(OpaqueCursorSchema, cursor)) return null;
      const packed = Buffer.from(cursor, "base64url");
      if (packed.toString("base64url") !== cursor || packed.length <= CURSOR_SIGNATURE_BYTES) {
        return null;
      }
      const payloadBytes = packed.subarray(0, -CURSOR_SIGNATURE_BYTES);
      const signature = packed.subarray(-CURSOR_SIGNATURE_BYTES);
      if (!equalBytes(sign(payloadBytes), signature)) return null;
      let value: unknown;
      try {
        value = JSON.parse(payloadBytes.toString("utf8")) as unknown;
      } catch {
        return null;
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const candidate = value as Readonly<Record<string, unknown>>;
      const status = candidate["status"];
      if (
        candidate["version"] !== 1 ||
        typeof candidate["organizationId"] !== "string" ||
        typeof candidate["scopeHash"] !== "string" ||
        typeof candidate["afterCode"] !== "string" ||
        !isSchemaValue(LocationIdSchema, candidate["afterLocationId"]) ||
        (status !== null && status !== "active" && status !== "inactive")
      ) {
        return null;
      }
      return Object.freeze({
        afterCode: candidate["afterCode"],
        afterLocationId: candidate["afterLocationId"],
        organizationId: candidate["organizationId"],
        scopeHash: candidate["scopeHash"],
        status,
        version: 1,
      });
    },
    encode: (payload: LocationCursorPayload): OpaqueCursor => {
      const body = Buffer.from(stableJson(payload), "utf8");
      const cursor = Buffer.concat([body, Buffer.from(sign(body))]).toString("base64url");
      if (!isSchemaValue(OpaqueCursorSchema, cursor)) {
        throw new TypeError("Location cursor exceeds the canonical cursor bounds");
      }
      return cursor;
    },
  });
  return codec;
};

const configurationFailure = <Value>(
  code: "permission_denied" | "validation_failed",
): ConfigurationResult<Value> => Object.freeze({ error: Object.freeze({ code }), ok: false });

const hasConfigurationPermission = (
  authorization: AuthorizationContext,
  permission: "configuration.publish" | "configuration.read" | "configuration.write",
): boolean =>
  isAuthorizationContext(authorization) && hasPermission(authorization.role, permission);

const cloneLocalizedText = <Value extends Readonly<Partial<Record<"en" | "ru" | "uz", string>>>>(
  value: Value,
): Value => Object.freeze({ ...value });

const validateAndOrderHours = (hours: WeeklyBusinessHours): WeeklyBusinessHours | null => {
  const ordered = [...hours.intervals].sort(
    (left, right) => left.day_of_week - right.day_of_week || left.sequence_no - right.sequence_no,
  );
  let prior: (typeof ordered)[number] | undefined;
  for (const interval of ordered) {
    if (interval.opens_at_local >= interval.closes_at_local) return null;
    if (prior?.day_of_week === interval.day_of_week) {
      if (
        interval.sequence_no !== prior.sequence_no + 1 ||
        interval.opens_at_local < prior.opens_at_local ||
        interval.opens_at_local < prior.closes_at_local
      ) {
        return null;
      }
    } else if (interval.sequence_no !== 1) {
      return null;
    }
    prior = interval;
  }
  return Object.freeze({
    intervals: ordered.map((interval) => Object.freeze({ ...interval })),
  });
};

const copyPublishInput = (value: PublishLocationInput): PublishLocationInput | null => {
  const businessHours = validateAndOrderHours(value.business_hours);
  if (businessHours === null) return null;
  return Object.freeze({
    address_i18n: cloneLocalizedText(value.address_i18n),
    business_hours: businessHours,
    name_i18n: cloneLocalizedText(value.name_i18n),
    public_contact: Object.freeze({ ...value.public_contact }),
    time_zone: value.time_zone,
  });
};

const copyClosureInput = (value: CreateLocationClosureInput): CreateLocationClosureInput =>
  value.kind === "closed"
    ? Object.freeze({
        kind: value.kind,
        local_date: value.local_date,
        reason_i18n: cloneLocalizedText(value.reason_i18n),
      })
    : Object.freeze({
        closes_at_local: value.closes_at_local,
        kind: value.kind,
        local_date: value.local_date,
        opens_at_local: value.opens_at_local,
        reason_i18n: cloneLocalizedText(value.reason_i18n),
      });

const scopeHashFor = (authorization: AuthorizationContext): string =>
  createHash("sha256")
    .update(
      authorization.locationScope === "all"
        ? "all"
        : `restricted:${[...authorization.allowedLocationIds].sort().join(",")}`,
      "utf8",
    )
    .digest("hex");

const asUtcTimestamp = (date: Date): UtcTimestamp => {
  const value = date.toISOString();
  if (!isSchemaValue(UtcTimestampSchema, value)) throw new TypeError("Clock returned invalid time");
  return value;
};

const issueResourceId = (identifiers: SecurityIdentifierFactory, now: Date): ResourceId => {
  const value = identifiers.issueResourceId(now);
  if (!isSchemaValue(ResourceIdSchema, value)) {
    throw new TypeError("Identifier factory returned invalid resource ID");
  }
  return value;
};

const issueLocationId = (identifiers: SecurityIdentifierFactory, now: Date): LocationId => {
  const value = identifiers.issueResourceId(now);
  if (!isSchemaValue(LocationIdSchema, value)) {
    throw new TypeError("Identifier factory returned invalid Location ID");
  }
  return value;
};

const issueCorrelationId = (identifiers: SecurityIdentifierFactory, now: Date): CorrelationId => {
  const value = identifiers.issueResourceId(now);
  if (!isSchemaValue(CorrelationIdSchema, value)) {
    throw new TypeError("Identifier factory returned invalid correlation ID");
  }
  return value;
};

const issueEventId = (identifiers: SecurityIdentifierFactory, now: Date): EventId => {
  const value = identifiers.issueResourceId(now);
  if (!isSchemaValue(EventIdSchema, value)) {
    throw new TypeError("Identifier factory returned invalid event ID");
  }
  return value;
};

const issueRequestId = (identifiers: SecurityIdentifierFactory, now: Date): RequestId => {
  const value = identifiers.issueResourceId(now);
  if (!isSchemaValue(RequestIdSchema, value)) {
    throw new TypeError("Identifier factory returned invalid request ID");
  }
  return value;
};

const preparedOperation = (
  authorization: AuthorizationContext,
  idempotencyKey: ConfigurationIdempotencyKey,
  scope: string,
  requestValue: unknown,
  clock: () => Date,
  identifiers: SecurityIdentifierFactory,
): PreparedLocationOperation => {
  const now = clock();
  const occurredAt = asUtcTimestamp(now);
  const expiresAt = asUtcTimestamp(new Date(now.getTime() + IDEMPOTENCY_LIFETIME_MILLISECONDS));
  const lockedUntil = asUtcTimestamp(new Date(now.getTime() + IDEMPOTENCY_LOCK_MILLISECONDS));
  return Object.freeze({
    auditId: issueResourceId(identifiers, now),
    authorization,
    correlationId: issueCorrelationId(identifiers, now),
    idempotency: Object.freeze({
      expiresAt,
      id: issueResourceId(identifiers, now),
      keyHash: digest(idempotencyKey),
      lockedUntil,
      principalIdHash: digest(authorization.userId),
      requestHash: digest(stableJson(requestValue)),
      scope,
    }),
    occurredAt,
    requestId: issueRequestId(identifiers, now),
  });
};

const withEvent = (
  operation: PreparedLocationOperation,
  clock: () => Date,
  identifiers: SecurityIdentifierFactory,
): PreparedLocationEventOperation => ({
  ...operation,
  eventId: issueEventId(identifiers, clock()),
});

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

export const createLocationConfigurationUseCases = (
  store: LocationConfigurationStore,
  options: Readonly<{
    clock?: () => Date;
    cursorCodec: LocationCursorCodec;
    identifierFactory?: SecurityIdentifierFactory;
  }>,
): LocationConfigurationUseCases => {
  const clock = options.clock ?? (() => new Date());
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();

  const useCases: LocationConfigurationUseCases = {
    createLocation: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.write",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (!isSchemaValue(CreateLocationInputSchema, command.input)) {
        return configurationFailure("validation_failed");
      }
      const value = Object.freeze({ code: command.input.code });
      const operation = preparedOperation(
        command.authorization,
        command.idempotencyKey,
        "configuration.location.create",
        { input: value },
        clock,
        identifiers,
      );
      return store.createLocation({
        ...operation,
        locationId: issueLocationId(identifiers, clock()),
        value,
      });
    },
    publishLocation: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(LocationIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(PublishLocationInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const value = copyPublishInput(command.input);
      if (value === null) return configurationFailure("validation_failed");
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.location.publish",
          { expectedVersion: command.expectedVersion, input: value, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      const contentHashValue = createHash("sha256").update(stableJson(value), "utf8").digest("hex");
      if (!isSchemaValue(ContentHashSchema, contentHashValue)) {
        throw new TypeError("Cannot create Location content hash");
      }
      return store.publishLocation({
        ...operation,
        contentHash: contentHashValue,
        expectedVersion: command.expectedVersion,
        hourIds: Object.freeze(
          value.business_hours.intervals.map(() => issueResourceId(identifiers, clock())),
        ),
        locationId: command.target,
        value,
        versionId: issueResourceId(identifiers, clock()),
      });
    },
    deactivateLocation: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(LocationIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(DeactivateLocationInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.location.deactivate",
          { expectedVersion: command.expectedVersion, input: {}, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.deactivateLocation({
        ...operation,
        expectedVersion: command.expectedVersion,
        locationId: command.target,
      });
    },
    createClosure: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(LocationIdSchema, command.target) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(CreateLocationClosureInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const value = copyClosureInput(command.input);
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.location.closure.create",
          { expectedVersion: command.expectedVersion, input: value, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.createClosure({
        ...operation,
        closureId: issueResourceId(identifiers, clock()),
        expectedVersion: command.expectedVersion,
        locationId: command.target,
        value,
      });
    },
    supersedeClosure: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(LocationIdSchema, command.target.locationId) ||
        !isSchemaValue(ResourceIdSchema, command.target.closureId) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(SupersedeLocationClosureInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const value = copyClosureInput(command.input);
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.location.closure.supersede",
          { expectedVersion: command.expectedVersion, input: value, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.supersedeClosure({
        ...operation,
        closureId: command.target.closureId,
        expectedVersion: command.expectedVersion,
        locationId: command.target.locationId,
        replacementId: issueResourceId(identifiers, clock()),
        value,
      });
    },
    cancelClosure: async (command) => {
      const invalid = validateCommandBase(
        command.authorization,
        command.idempotencyKey,
        "configuration.publish",
      );
      if (invalid !== null) return configurationFailure(invalid);
      if (
        !isSchemaValue(LocationIdSchema, command.target.locationId) ||
        !isSchemaValue(ResourceIdSchema, command.target.closureId) ||
        !isSchemaValue(ResourceVersionSchema, command.expectedVersion) ||
        !isSchemaValue(CancelLocationClosureInputSchema, command.input)
      ) {
        return configurationFailure("validation_failed");
      }
      const operation = withEvent(
        preparedOperation(
          command.authorization,
          command.idempotencyKey,
          "configuration.location.closure.cancel",
          { expectedVersion: command.expectedVersion, input: {}, target: command.target },
          clock,
          identifiers,
        ),
        clock,
        identifiers,
      );
      return store.cancelClosure({
        ...operation,
        closureId: command.target.closureId,
        expectedVersion: command.expectedVersion,
        locationId: command.target.locationId,
      });
    },
    getLocation: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (!isSchemaValue(LocationIdSchema, query.input.locationId)) {
        return configurationFailure("validation_failed");
      }
      if (
        query.authorization.locationScope === "restricted" &&
        !query.authorization.allowedLocationIds.includes(query.input.locationId)
      ) {
        return Object.freeze({
          error: Object.freeze({ code: "resource_not_found" as const }),
          ok: false as const,
        });
      }
      return store.getLocation({
        authorization: query.authorization,
        locationId: query.input.locationId,
      });
    },
    listLocations: async (query) => {
      if (!hasConfigurationPermission(query.authorization, "configuration.read")) {
        return configurationFailure("permission_denied");
      }
      if (
        !isSchemaValue(LocationListFilterSchema, query.input.filter) ||
        !isSchemaValue(PaginationRequestSchema, query.input.pagination)
      ) {
        return configurationFailure("validation_failed");
      }
      const status = query.input.filter.status ?? null;
      const expectedScopeHash = scopeHashFor(query.authorization);
      const decoded =
        query.input.pagination.cursor === undefined
          ? null
          : options.cursorCodec.decode(query.input.pagination.cursor);
      if (
        query.input.pagination.cursor !== undefined &&
        (decoded === null ||
          decoded.organizationId !== query.authorization.organizationId ||
          decoded.scopeHash !== expectedScopeHash ||
          decoded.status !== status)
      ) {
        return configurationFailure("validation_failed");
      }
      const result = await store.listLocations({
        after:
          decoded === null
            ? null
            : Object.freeze({
                code: decoded.afterCode,
                locationId: decoded.afterLocationId,
              }),
        authorization: query.authorization,
        limit: query.input.pagination.limit ?? 50,
        status,
      });
      if (!result.ok) return result;
      const nextCursor =
        result.value.next === null
          ? null
          : options.cursorCodec.encode({
              afterCode: result.value.next.code,
              afterLocationId: result.value.next.locationId,
              organizationId: query.authorization.organizationId,
              scopeHash: expectedScopeHash,
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

export const LOCATION_CHANGED_FIELDS = Object.freeze([
  "details",
  "business_hours",
  "closures",
  "status",
  "time_zone",
] as const satisfies readonly LocationChangedField[]);
