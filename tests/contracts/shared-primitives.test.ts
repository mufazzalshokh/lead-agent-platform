import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ActorRefSchema,
  AggregateVersionSchema,
  AiRunIdSchema,
  AppointmentRequestIdSchema,
  CausationIdSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  CurrencyCodeSchema,
  EventIdSchema,
  HandoffIdSchema,
  LeadIdSchema,
  LocaleSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  MoneySchema,
  OrganizationIdSchema,
  RequestIdSchema,
  ResourceIdSchema,
  ResourceVersionSchema,
  SchemaIdSchema,
  SchemaVersionSchema,
  ServiceIdSchema,
  UserIdSchema,
  UtcTimestampSchema,
  UuidV7Schema,
  isSchemaValue,
  type OrganizationId,
  type UserId,
} from "../../packages/contracts/src/index.js";

const VALID_UUID_V7 = "0193f1a8-7f65-7c28-a434-a10796c41c2b";

const typedIdSchemas = [
  UuidV7Schema,
  ResourceIdSchema,
  OrganizationIdSchema,
  UserIdSchema,
  MembershipIdSchema,
  LocationIdSchema,
  ServiceIdSchema,
  ContactIdSchema,
  LeadIdSchema,
  ConversationIdSchema,
  MessageIdSchema,
  AppointmentRequestIdSchema,
  HandoffIdSchema,
  ChannelConnectionIdSchema,
  AiRunIdSchema,
  EventIdSchema,
  CorrelationIdSchema,
  CausationIdSchema,
] as const;

const allPrimitiveSchemas = [
  ...typedIdSchemas,
  RequestIdSchema,
  SchemaIdSchema,
  SchemaVersionSchema,
  ResourceVersionSchema,
  AggregateVersionSchema,
  UtcTimestampSchema,
  LocaleSchema,
  CurrencyCodeSchema,
  MoneySchema,
  ActorRefSchema,
] as const;

describe("canonical shared primitive schemas", () => {
  it("publishes unique, versioned, JSON-serializable schema identifiers", () => {
    const schemaIds = allPrimitiveSchemas.map((schema) =>
      "$id" in schema ? schema.$id : undefined,
    );

    expect(schemaIds).toHaveLength(new Set(schemaIds).size);
    expect(schemaIds.every((schemaId) => isSchemaValue(SchemaIdSchema, schemaId))).toBe(true);

    for (const schema of allPrimitiveSchemas) {
      expect(() => JSON.stringify(schema)).not.toThrow();
    }
  });

  it("narrows unknown values to the schema-derived nominal type", () => {
    const candidate: unknown = VALID_UUID_V7;

    expect(isSchemaValue(OrganizationIdSchema, candidate)).toBe(true);

    if (!isSchemaValue(OrganizationIdSchema, candidate)) {
      throw new TypeError("Expected the fixture to be a valid organization identifier");
    }

    expectTypeOf(candidate).toEqualTypeOf<OrganizationId>();
    expectTypeOf<OrganizationId>().not.toEqualTypeOf<UserId>();
  });
});

describe("UUIDv7 identifiers", () => {
  it("accepts a canonical UUIDv7 for every typed resource identifier", () => {
    for (const schema of typedIdSchemas) {
      expect(isSchemaValue(schema, VALID_UUID_V7)).toBe(true);
    }
  });

  it.each([
    "",
    "0193f1a8-7f65-4c28-a434-a10796c41c2b",
    "0193f1a8-7f65-7c28-7434-a10796c41c2b",
    "0193F1A8-7F65-7C28-A434-A10796C41C2B",
    "0193f1a87f657c28a434a10796c41c2b",
    `${VALID_UUID_V7}\n`,
    "a".repeat(1_000),
  ])("rejects malformed, non-canonical, or wrong-version identifier %j", (candidate) => {
    expect(isSchemaValue(OrganizationIdSchema, candidate)).toBe(false);
  });

  it.each([null, 1, {}, [], true])("rejects non-string identifier input %j", (candidate) => {
    expect(isSchemaValue(OrganizationIdSchema, candidate)).toBe(false);
  });
});

describe("operational and schema identifiers", () => {
  it.each(["req_01JQ4Z7YRXG8M4NP6V2C3D5E6F", VALID_UUID_V7])(
    "accepts bounded opaque request identifier %s",
    (candidate) => {
      expect(isSchemaValue(RequestIdSchema, candidate)).toBe(true);
    },
  );

  it.each([
    "short",
    " request_123",
    "request 123",
    "customer@example.com",
    "request/123",
    "request_123\n",
    "r".repeat(129),
  ])("rejects unsafe request identifier %j", (candidate) => {
    expect(isSchemaValue(RequestIdSchema, candidate)).toBe(false);
  });

  it.each(["CanonicalInboundEvent.v1", "agent_decision.v13", "Money.v1"])(
    "accepts canonical schema identifier %s",
    (candidate) => {
      expect(isSchemaValue(SchemaIdSchema, candidate)).toBe(true);
    },
  );

  it.each([
    "Schema",
    "Schema.v0",
    "Schema.v01",
    ".Schema.v1",
    "Schema name.v1",
    "Schema/v1",
    `Schema${"x".repeat(120)}.v1`,
  ])("rejects malformed schema identifier %j", (candidate) => {
    expect(isSchemaValue(SchemaIdSchema, candidate)).toBe(false);
  });
});

describe("timestamps", () => {
  it.each(["2026-08-30T12:34:56Z", "2024-02-29T23:59:59.123Z", "2026-08-30T12:34:56.123456789Z"])(
    "accepts canonical UTC timestamp %s",
    (candidate) => {
      expect(isSchemaValue(UtcTimestampSchema, candidate)).toBe(true);
    },
  );

  it.each([
    "2026-08-30",
    "2026-08-30T12:34Z",
    "2026-08-30T12:34:56",
    "2026-08-30T12:34:56+05:00",
    "2026-08-30T12:34:56z",
    "2026-02-30T12:34:56Z",
    "2026-08-30 12:34:56Z",
    "2026-08-30T12:34:56.1234567890Z",
    " 2026-08-30T12:34:56Z",
  ])("rejects malformed or non-canonical timestamp %j", (candidate) => {
    expect(isSchemaValue(UtcTimestampSchema, candidate)).toBe(false);
  });
});

describe("locales", () => {
  it.each(["uz", "ru", "en"])("accepts supported locale %s", (candidate) => {
    expect(isSchemaValue(LocaleSchema, candidate)).toBe(true);
  });

  it.each(["uz-UZ", "ru-RU", "en-US", "de", "unknown", "", null, 1, "u".repeat(1_000)])(
    "rejects unsupported locale %j",
    (candidate) => {
      expect(isSchemaValue(LocaleSchema, candidate)).toBe(false);
    },
  );
});

describe("currency and money", () => {
  it.each(["USD", "UZS", "RUB"])("accepts structurally valid ISO 4217 code %s", (candidate) => {
    expect(isSchemaValue(CurrencyCodeSchema, candidate)).toBe(true);
  });

  it.each(["usd", "US", "USDD", "U$D", "", "U".repeat(1_000), null, 840])(
    "rejects invalid currency input %j",
    (candidate) => {
      expect(isSchemaValue(CurrencyCodeSchema, candidate)).toBe(false);
    },
  );

  it.each([
    { amount_minor: 0, currency: "USD" },
    { amount_minor: 125_00, currency: "UZS" },
    { amount_minor: -1, currency: "RUB" },
    { amount_minor: Number.MAX_SAFE_INTEGER, currency: "USD" },
  ])("accepts exact integer-minor-unit money %j", (candidate) => {
    expect(isSchemaValue(MoneySchema, candidate)).toBe(true);
  });

  it.each([
    { amount_minor: 12.5, currency: "USD" },
    { amount_minor: Number.MAX_SAFE_INTEGER + 1, currency: "USD" },
    { amount_minor: Number.MIN_SAFE_INTEGER - 1, currency: "USD" },
    { amount_minor: "1250", currency: "USD" },
    { amount_minor: 1250, currency: "usd" },
    { amount_minor: 1250 },
    { currency: "USD" },
    { amount_minor: 1250, currency: "USD", amount: 12.5 },
    JSON.parse('{"amount_minor":1250,"currency":"USD","__proto__":{"polluted":true}}'),
  ])("rejects floating-point, unsafe, incomplete, or hostile money %j", (candidate) => {
    expect(isSchemaValue(MoneySchema, candidate)).toBe(false);
  });
});

describe("actor references", () => {
  it.each([
    { actor_id: VALID_UUID_V7, actor_type: "customer" },
    { actor_id: VALID_UUID_V7, actor_type: "member" },
    { actor_id: null, actor_type: "system" },
    { actor_id: VALID_UUID_V7, actor_type: "platform_operator" },
  ])("accepts attribution-only actor reference %j", (candidate) => {
    expect(isSchemaValue(ActorRefSchema, candidate)).toBe(true);
  });

  it.each([
    { actor_id: null, actor_type: "customer" },
    { actor_id: VALID_UUID_V7, actor_type: "system" },
    { actor_id: VALID_UUID_V7, actor_type: "model" },
    { actor_type: "member" },
    { actor_id: VALID_UUID_V7 },
    {
      actor_id: VALID_UUID_V7,
      actor_type: "member",
      organization_id: VALID_UUID_V7,
    },
    {
      actor_id: "550e8400-e29b-41d4-a716-446655440000",
      actor_type: "member",
    },
    JSON.parse('{"actor_id":null,"actor_type":"system","__proto__":{"trusted":true}}'),
    { actor_id: VALID_UUID_V7, actor_type: "a".repeat(1_000) },
  ])("rejects malformed or authority-smuggling actor reference %j", (candidate) => {
    expect(isSchemaValue(ActorRefSchema, candidate)).toBe(false);
  });
});

describe("schema and concurrency versions", () => {
  it.each(["1", "13", "999999"])("accepts schema version %s", (candidate) => {
    expect(isSchemaValue(SchemaVersionSchema, candidate)).toBe(true);
  });

  it.each(["0", "01", "1.0", "1000000", "1".repeat(1_000), 1, null])(
    "rejects malformed schema version %j",
    (candidate) => {
      expect(isSchemaValue(SchemaVersionSchema, candidate)).toBe(false);
    },
  );

  it.each([1, 2, Number.MAX_SAFE_INTEGER])("accepts positive safe resource version %s", (value) => {
    expect(isSchemaValue(ResourceVersionSchema, value)).toBe(true);
    expect(isSchemaValue(AggregateVersionSchema, value)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null])(
    "rejects invalid resource version %j",
    (value) => {
      expect(isSchemaValue(ResourceVersionSchema, value)).toBe(false);
      expect(isSchemaValue(AggregateVersionSchema, value)).toBe(false);
    },
  );
});
