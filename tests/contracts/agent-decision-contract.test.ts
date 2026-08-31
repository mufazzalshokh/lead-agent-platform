import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AgentActionTypeSchema,
  AgentAppointmentPreferenceSchema,
  AgentDecisionActionSchema,
  AgentDecisionLanguageSchema,
  AgentDecisionMessageSchema,
  AgentDecisionSafetySchema,
  AgentDecisionV1Schema,
  AgentExtractedFactsSchema,
  AgentFactualClaimKindSchema,
  AgentFactualClaimSchema,
  AgentFactualClaimSourceTypeSchema,
  AgentHandoffReasonSchema,
  AgentInformationFieldSchema,
  AgentIntentSchema,
  AgentMessageModeSchema,
  AgentRiskFlagSchema,
  SchemaIdSchema,
  isSchemaValue,
  type AgentDecisionAction,
  type AgentDecisionLanguage,
  type AgentDecisionV1,
  type AgentHandoffReason,
  type AgentIntent,
  type AgentRiskFlag,
  type AppointmentRequestId,
  type LocationId,
  type ServiceId,
} from "../../packages/contracts/src/index.js";

const ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const OTHER_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const UUID_V4 = "550e8400-e29b-41d4-a716-446655440000";

const INTENTS = [
  "greeting",
  "faq",
  "service_inquiry",
  "pricing",
  "qualification",
  "provide_contact",
  "booking_request",
  "booking_confirmation",
  "booking_decline",
  "human_request",
  "medical_question",
  "complaint",
  "unsafe_or_abusive",
  "other",
] as const satisfies readonly AgentIntent[];

const LANGUAGES = ["uz", "ru", "en", "unknown"] as const satisfies readonly AgentDecisionLanguage[];

const ACTION_FIXTURES = [
  { type: "none" },
  { field: "service", type: "request_information" },
  { type: "create_appointment_request" },
  { appointment_request_id: ID, type: "confirm_appointment" },
  { appointment_request_id: ID, type: "decline_appointment" },
  { reason: "customer_requested", type: "request_handoff" },
] as const;

const ACTION_TYPES = ACTION_FIXTURES.map((action) => action.type);

const INFORMATION_FIELDS = [
  "name",
  "phone",
  "email",
  "service",
  "location",
  "appointment_time",
  "booking_confirmation",
] as const;

const HANDOFF_REASONS = [
  "customer_requested",
  "missing_authoritative_information",
  "medical_or_safety",
  "low_confidence",
  "policy_blocked",
  "ai_unavailable",
  "delivery_problem",
  "other",
] as const satisfies readonly AgentHandoffReason[];

const CLAIM_KINDS = [
  "service",
  "price",
  "hours",
  "policy",
  "faq",
  "location",
  "booking_offer",
] as const;

const CLAIM_SOURCE_TYPES = [
  "service",
  "service_price",
  "business_policy",
  "faq",
  "location",
  "appointment_request",
] as const;

const MESSAGE_MODES = ["send_candidate", "use_safe_template", "suppress"] as const;

const RISK_FLAGS = [
  "medical_content",
  "price_missing",
  "availability_unknown",
  "service_missing",
  "prompt_injection",
  "sensitive_data",
  "abuse",
  "ambiguous_confirmation",
] as const satisfies readonly AgentRiskFlag[];

const createDecision = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: { type: "none" },
  confidence: 0.92,
  extracted_facts: {
    appointment_preference: null,
    display_name: null,
    email_raw: null,
    location_id: null,
    phone_raw: null,
    service_id: null,
  },
  factual_claims: [],
  intent: "faq",
  language: "en",
  message: {
    draft_text: "I can help with the clinic's published information.",
    mode: "send_candidate",
  },
  safety: {
    risk_flags: [],
    safe_to_send: true,
  },
  schema_version: "1",
  ...overrides,
});

const createCompleteDecision = (): Record<string, unknown> =>
  createDecision({
    action: { type: "create_appointment_request" },
    extracted_facts: {
      appointment_preference: {
        local_date: "2026-09-15",
        local_time_end: "15:30",
        local_time_start: "14:00",
        raw_text: "15 September between 14:00 and 15:30",
        timezone: "Asia/Tashkent",
      },
      display_name: "Dilnoza Дилноза 👋",
      email_raw: "lead@example.test",
      location_id: OTHER_ID,
      phone_raw: "+998 90 123 45 67",
      service_id: ID,
    },
    factual_claims: [
      {
        claim_kind: "service",
        source_id: ID,
        source_type: "service",
        source_version: 2,
      },
    ],
    intent: "booking_request",
    language: "uz",
    safety: {
      risk_flags: ["sensitive_data"],
      safe_to_send: false,
    },
  });

const withoutMember = (candidate: Record<string, unknown>, member: string) => {
  const clone = structuredClone(candidate);
  Reflect.deleteProperty(clone, member);
  return clone;
};

const schemaIdOf = (schema: object, label: string) => {
  const schemaId: unknown = Reflect.get(schema, "$id");

  if (typeof schemaId !== "string") {
    throw new TypeError(`Missing schema ID for ${label}`);
  }

  return schemaId;
};

const agentDecisionSchemas = [
  AgentDecisionLanguageSchema,
  AgentIntentSchema,
  AgentFactualClaimKindSchema,
  AgentFactualClaimSourceTypeSchema,
  AgentActionTypeSchema,
  AgentInformationFieldSchema,
  AgentHandoffReasonSchema,
  AgentMessageModeSchema,
  AgentRiskFlagSchema,
  AgentAppointmentPreferenceSchema,
  AgentExtractedFactsSchema,
  AgentFactualClaimSchema,
  AgentDecisionActionSchema,
  AgentDecisionMessageSchema,
  AgentDecisionSafetySchema,
  AgentDecisionV1Schema,
] as const;

describe("AgentDecision V1 source of truth", () => {
  it("publishes unique versioned schema IDs and JSON-serializable runtime schemas", () => {
    const schemaIds = agentDecisionSchemas.map((schema) => schemaIdOf(schema, "AI contract"));

    expect(schemaIds).toHaveLength(new Set(schemaIds).size);
    expect(schemaIds.every((schemaId) => isSchemaValue(SchemaIdSchema, schemaId))).toBe(true);

    for (const schema of agentDecisionSchemas) {
      expect(() => JSON.stringify(schema)).not.toThrow();
    }
  });

  it("retains the canonical Stage 0 AgentDecision schema identity", () => {
    expect(schemaIdOf(AgentDecisionV1Schema, "AgentDecision V1")).toBe("AgentDecision.v1");
  });

  it("contains exactly the nine required closed top-level fields", () => {
    expect(Object.keys(AgentDecisionV1Schema.properties).sort()).toEqual([
      "action",
      "confidence",
      "extracted_facts",
      "factual_claims",
      "intent",
      "language",
      "message",
      "safety",
      "schema_version",
    ]);
    expect(Reflect.get(AgentDecisionV1Schema, "additionalProperties")).toBe(false);
  });

  it("derives discriminated and nominal TypeScript types from runtime schemas", () => {
    expectTypeOf<AgentDecisionV1["intent"]>().toEqualTypeOf<AgentIntent>();
    expectTypeOf<AgentDecisionV1["action"]>().toEqualTypeOf<AgentDecisionAction>();
    expectTypeOf<AgentDecisionV1["language"]>().toEqualTypeOf<AgentDecisionLanguage>();
    expectTypeOf<AgentDecisionV1["schema_version"]>().toEqualTypeOf<"1">();
    expectTypeOf<
      AgentDecisionV1["extracted_facts"]["service_id"]
    >().toEqualTypeOf<ServiceId | null>();
    expectTypeOf<
      AgentDecisionV1["extracted_facts"]["location_id"]
    >().toEqualTypeOf<LocationId | null>();
    expectTypeOf<
      Extract<AgentDecisionAction, { type: "confirm_appointment" }>["appointment_request_id"]
    >().toEqualTypeOf<AppointmentRequestId>();
  });
});

describe("accepted AgentDecision V1 vocabulary and values", () => {
  it.each(INTENTS)("accepts canonical intent %s", (intent) => {
    expect(isSchemaValue(AgentIntentSchema, intent)).toBe(true);
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ intent }))).toBe(true);
  });

  it.each(LANGUAGES)("accepts canonical language %s", (language) => {
    expect(isSchemaValue(AgentDecisionLanguageSchema, language)).toBe(true);
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ language }))).toBe(true);
  });

  it.each(ACTION_FIXTURES)("accepts runtime-discriminated action $type", (action) => {
    expect(isSchemaValue(AgentActionTypeSchema, action.type)).toBe(true);
    expect(isSchemaValue(AgentDecisionActionSchema, action)).toBe(true);
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ action }))).toBe(true);
  });

  it.each(INFORMATION_FIELDS)("accepts request-information field %s", (field) => {
    expect(isSchemaValue(AgentInformationFieldSchema, field)).toBe(true);
    expect(
      isSchemaValue(
        AgentDecisionV1Schema,
        createDecision({ action: { field, type: "request_information" } }),
      ),
    ).toBe(true);
  });

  it.each(HANDOFF_REASONS)("accepts model-proposable handoff reason %s", (reason) => {
    expect(isSchemaValue(AgentHandoffReasonSchema, reason)).toBe(true);
    expect(
      isSchemaValue(
        AgentDecisionV1Schema,
        createDecision({ action: { reason, type: "request_handoff" } }),
      ),
    ).toBe(true);
  });

  it.each(MESSAGE_MODES)("accepts customer-message mode %s", (mode) => {
    expect(isSchemaValue(AgentMessageModeSchema, mode)).toBe(true);
    expect(
      isSchemaValue(AgentDecisionV1Schema, createDecision({ message: { draft_text: null, mode } })),
    ).toBe(true);
  });

  it.each(RISK_FLAGS)("accepts advisory risk flag %s", (riskFlag) => {
    expect(isSchemaValue(AgentRiskFlagSchema, riskFlag)).toBe(true);
    expect(
      isSchemaValue(
        AgentDecisionV1Schema,
        createDecision({ safety: { risk_flags: [riskFlag], safe_to_send: false } }),
      ),
    ).toBe(true);
  });

  it("accepts all-null unknown extracted facts without forcing invented values", () => {
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision())).toBe(true);
  });

  it("accepts bounded multilingual candidate extraction and preference fields", () => {
    const candidate = createCompleteDecision();

    expect(isSchemaValue(AgentDecisionV1Schema, candidate)).toBe(true);
    expect(isSchemaValue(AgentDecisionV1Schema, JSON.parse(JSON.stringify(candidate)))).toBe(true);
  });

  it("accepts an appointment preference whose parsed components remain unknown", () => {
    const extractedFacts = {
      appointment_preference: {
        local_date: null,
        local_time_end: null,
        local_time_start: null,
        raw_text: "next week sometime",
        timezone: null,
      },
      display_name: null,
      email_raw: null,
      location_id: null,
      phone_raw: null,
      service_id: null,
    };

    expect(
      isSchemaValue(AgentDecisionV1Schema, createDecision({ extracted_facts: extractedFacts })),
    ).toBe(true);
  });

  it.each(CLAIM_KINDS)("accepts factual-claim kind %s", (claimKind) => {
    expect(isSchemaValue(AgentFactualClaimKindSchema, claimKind)).toBe(true);
    expect(
      isSchemaValue(
        AgentDecisionV1Schema,
        createDecision({
          factual_claims: [
            {
              claim_kind: claimKind,
              source_id: ID,
              source_type: "service",
              source_version: 1,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each(CLAIM_SOURCE_TYPES)("accepts authoritative-record source type %s", (sourceType) => {
    expect(isSchemaValue(AgentFactualClaimSourceTypeSchema, sourceType)).toBe(true);
    expect(
      isSchemaValue(
        AgentDecisionV1Schema,
        createDecision({
          factual_claims: [
            {
              claim_kind: "faq",
              source_id: ID,
              source_type: sourceType,
              source_version: Number.MAX_SAFE_INTEGER,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each(ACTION_FIXTURES)("round-trips $type through JSON", (action) => {
    const candidate = createDecision({ action });
    const roundTripped: unknown = JSON.parse(JSON.stringify(candidate));

    expect(isSchemaValue(AgentDecisionV1Schema, roundTripped)).toBe(true);
  });
});

describe("AgentDecision V1 structural rejection", () => {
  it.each([
    "schema_version",
    "language",
    "intent",
    "confidence",
    "extracted_facts",
    "factual_claims",
    "action",
    "message",
    "safety",
  ])("rejects a decision missing required top-level field %s", (field) => {
    expect(isSchemaValue(AgentDecisionV1Schema, withoutMember(createDecision(), field))).toBe(
      false,
    );
  });

  it.each(["0", "2", 1, null, "01", "latest"])(
    "rejects invalid schema version %j",
    (schemaVersion) => {
      expect(
        isSchemaValue(AgentDecisionV1Schema, createDecision({ schema_version: schemaVersion })),
      ).toBe(false);
    },
  );

  it.each(["unsupported", "FAQ", "book_appointment", "", null, 1])(
    "rejects unknown intent %j",
    (intent) => {
      expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ intent }))).toBe(false);
    },
  );

  it.each(["de", "uz-UZ", "ru-RU", "en-US", "", null, 1])(
    "rejects unsupported language %j",
    (language) => {
      expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ language }))).toBe(false);
    },
  );

  it.each([
    -0.01,
    1.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "0.5",
    null,
  ])("rejects invalid confidence %j", (confidence) => {
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ confidence }))).toBe(false);
  });

  it.each([
    "appointment_preference",
    "display_name",
    "email_raw",
    "location_id",
    "phone_raw",
    "service_id",
  ])("rejects extracted facts missing required member %s", (field) => {
    const candidate = createDecision();
    const extractedFacts = structuredClone(candidate["extracted_facts"]) as Record<string, unknown>;
    Reflect.deleteProperty(extractedFacts, field);

    expect(
      isSchemaValue(AgentDecisionV1Schema, { ...candidate, extracted_facts: extractedFacts }),
    ).toBe(false);
  });

  it.each([
    { display_name: "n".repeat(201) },
    { display_name: 42 },
    { phone_raw: "1".repeat(101) },
    { phone_raw: { verified: true, value: "+998901234567" } },
    { email_raw: "e".repeat(321) },
    { email_raw: ["lead@example.test"] },
    { service_id: UUID_V4 },
    { service_id: "not-a-uuid" },
    { location_id: UUID_V4 },
    { location_id: "not-a-uuid" },
    { appointment_preference: "tomorrow" },
  ])("rejects malformed or oversized extracted fact %#", (override) => {
    const base = createDecision();
    const extractedFacts = {
      ...(base["extracted_facts"] as Record<string, unknown>),
      ...override,
    };

    expect(isSchemaValue(AgentDecisionV1Schema, { ...base, extracted_facts: extractedFacts })).toBe(
      false,
    );
  });

  it.each([
    { local_date: "2026-02-30" },
    { local_date: "15-09-2026" },
    { local_time_start: "24:00" },
    { local_time_start: "9:30" },
    { local_time_end: "14:60" },
    { local_time_end: "14:00:00" },
    { raw_text: "t".repeat(501) },
    { raw_text: null },
    { timezone: "z".repeat(101) },
    { timezone: 5 },
  ])("rejects malformed or oversized appointment preference %#", (override) => {
    const complete = createCompleteDecision();
    const extractedFacts = structuredClone(complete["extracted_facts"]) as Record<string, unknown>;
    extractedFacts["appointment_preference"] = {
      ...(extractedFacts["appointment_preference"] as Record<string, unknown>),
      ...override,
    };

    expect(
      isSchemaValue(AgentDecisionV1Schema, {
        ...complete,
        extracted_facts: extractedFacts,
      }),
    ).toBe(false);
  });

  it.each(["raw_text", "local_date", "local_time_start", "local_time_end", "timezone"])(
    "rejects appointment preference missing required member %s",
    (field) => {
      const complete = createCompleteDecision();
      const extractedFacts = structuredClone(complete["extracted_facts"]) as Record<
        string,
        unknown
      >;
      const preference = extractedFacts["appointment_preference"] as Record<string, unknown>;
      Reflect.deleteProperty(preference, field);

      expect(
        isSchemaValue(AgentDecisionV1Schema, {
          ...complete,
          extracted_facts: extractedFacts,
        }),
      ).toBe(false);
    },
  );

  it("rejects more than twelve factual claims", () => {
    const factualClaim = {
      claim_kind: "service",
      source_id: ID,
      source_type: "service",
      source_version: 1,
    };

    expect(
      isSchemaValue(
        AgentDecisionV1Schema,
        createDecision({ factual_claims: Array.from({ length: 13 }, () => factualClaim) }),
      ),
    ).toBe(false);
  });

  it.each(["claim_kind", "source_type", "source_id", "source_version"])(
    "rejects a factual claim missing required member %s",
    (field) => {
      const claim: Record<string, unknown> = {
        claim_kind: "service",
        source_id: ID,
        source_type: "service",
        source_version: 1,
      };
      Reflect.deleteProperty(claim, field);

      expect(
        isSchemaValue(AgentDecisionV1Schema, createDecision({ factual_claims: [claim] })),
      ).toBe(false);
    },
  );

  it.each([
    { claim_kind: "discount" },
    { source_type: "database_row" },
    { source_id: UUID_V4 },
    { source_id: "not-a-uuid" },
    { source_version: 0 },
    { source_version: 1.5 },
    { source_version: Number.MAX_SAFE_INTEGER + 1 },
    { source_version: "1" },
  ])("rejects malformed factual claim %#", (override) => {
    const claim = {
      claim_kind: "service",
      source_id: ID,
      source_type: "service",
      source_version: 1,
      ...override,
    };

    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ factual_claims: [claim] }))).toBe(
      false,
    );
  });
});

describe("strict runtime-discriminated action union", () => {
  it.each([
    { type: "book_appointment" },
    { type: "confirm_booking" },
    { type: "update_calendar" },
    { type: "set_price" },
    { type: "apply_discount" },
    { type: "diagnose" },
    { type: "execute_tool" },
    { type: "unknown" },
    null,
    [],
  ])("rejects unknown or wrong-shaped action %#", (action) => {
    expect(isSchemaValue(AgentDecisionActionSchema, action)).toBe(false);
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ action }))).toBe(false);
  });

  it.each([
    { type: "request_information" },
    { field: "service", type: "none" },
    { field: "unknown", type: "request_information" },
    { appointment_request_id: ID, type: "request_information" },
    { type: "confirm_appointment" },
    { appointment_request_id: UUID_V4, type: "confirm_appointment" },
    { appointment_request_id: ID, type: "create_appointment_request" },
    { type: "decline_appointment" },
    { appointment_request_id: UUID_V4, type: "decline_appointment" },
    { reason: "customer_requested", type: "decline_appointment" },
    { type: "request_handoff" },
    { reason: "staff_created", type: "request_handoff" },
    { field: "phone", reason: "customer_requested", type: "request_handoff" },
  ])("rejects missing, mismatched, or invalid action payload %#", (action) => {
    expect(isSchemaValue(AgentDecisionActionSchema, action)).toBe(false);
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ action }))).toBe(false);
  });

  it("rejects every foreign payload field on every action variant", () => {
    const payloadFields = {
      appointment_request_id: ID,
      field: "service",
      reason: "customer_requested",
    };

    for (const action of ACTION_FIXTURES) {
      for (const [field, value] of Object.entries(payloadFields)) {
        if (field in action) {
          continue;
        }

        expect(
          isSchemaValue(AgentDecisionActionSchema, { ...action, [field]: value }),
          `${action.type} accepted foreign ${field}`,
        ).toBe(false);
      }
    }
  });

  it.each([
    { action: [] },
    { action: [{ type: "none" }] },
    {
      action: [{ type: "none" }, { reason: "customer_requested", type: "request_handoff" }],
    },
  ])("rejects an action array because V1 requires exactly one action object %#", ({ action }) => {
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ action }))).toBe(false);
  });

  it("publishes exactly the accepted six action discriminants", () => {
    expect(ACTION_TYPES).toEqual([
      "none",
      "request_information",
      "create_appointment_request",
      "confirm_appointment",
      "decline_appointment",
      "request_handoff",
    ]);
    expect(
      ACTION_TYPES.every((actionType) => isSchemaValue(AgentActionTypeSchema, actionType)),
    ).toBe(true);
  });
});

describe("message, safety, and JSON-wire bounds", () => {
  it.each([
    { draft_text: "t".repeat(4_001), mode: "send_candidate" },
    { draft_text: 42, mode: "send_candidate" },
    { draft_text: "Hello", mode: "send" },
    { mode: "send_candidate" },
    { draft_text: "Hello" },
    { draft_text: "Hello", html: "<b>Hello</b>", mode: "send_candidate" },
  ])("rejects malformed, oversized, or open message %#", (message) => {
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ message }))).toBe(false);
  });

  it.each([
    { risk_flags: [], safe_to_send: "yes" },
    { risk_flags: ["unknown"], safe_to_send: false },
    {
      risk_flags: Array.from({ length: 11 }, () => "medical_content"),
      safe_to_send: false,
    },
    { risk_flags: "medical_content", safe_to_send: false },
    { safe_to_send: false },
    { risk_flags: [] },
    { authorized: true, risk_flags: [], safe_to_send: true },
  ])("rejects malformed, excessive, or authority-bearing safety data %#", (safety) => {
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ safety }))).toBe(false);
  });

  it.each([
    { ...createDecision(), confidence: 1n },
    { ...createDecision(), action: new Map([["type", "none"]]) },
    { ...createDecision(), action: new Set(["none"]) },
    { ...createDecision(), action: () => ({ type: "none" }) },
    { ...createDecision(), action: undefined },
    { ...createDecision(), factual_claims: new Map() },
    { ...createDecision(), message: new Date("2026-09-01T00:00:00Z") },
  ])("rejects non-JSON wire decision value %#", (candidate) => {
    expect(isSchemaValue(AgentDecisionV1Schema, candidate)).toBe(false);
  });
});

describe("AgentDecision authority, tool, business-fact, and medical smuggling", () => {
  const forbiddenFields = [
    "organization_id",
    "organizationId",
    "tenant_id",
    "tenantId",
    "membershipId",
    "role",
    "roles",
    "permissions",
    "capabilities",
    "isAdmin",
    "isOwner",
    "platformOperator",
    "authorization",
    "accessToken",
    "session",
    "cookie",
    "secret",
    "apiKey",
    "tool",
    "toolName",
    "tool_calls",
    "function",
    "functionName",
    "command",
    "shell",
    "sql",
    "query",
    "url",
    "httpMethod",
    "headers",
    "providerBody",
    "providerResponse",
    "rawModelResponse",
    "reasoning",
    "chainOfThought",
    "debug",
    "metadata",
    "databaseRow",
    "rawInput",
    "price",
    "priceOverride",
    "discount",
    "discountPercent",
    "availability",
    "slotAvailable",
    "guaranteed",
    "guarantee",
    "calendarWrite",
    "calendarEvent",
    "confirmedBooking",
    "diagnosis",
    "treatment",
    "prescription",
    "contraindication",
    "medicalAdvice",
    "eligibility",
    "clinicalRisk",
  ] as const;

  const injectedValue = (field: string) =>
    field.includes("organization") || field.includes("tenant") ? ID : { injected: true };

  it.each(forbiddenFields)(
    "rejects forbidden field %s at every closed object boundary",
    (field) => {
      const value = injectedValue(field);
      const complete = createCompleteDecision();
      const extractedFacts = structuredClone(complete["extracted_facts"]) as Record<
        string,
        unknown
      >;
      const appointmentPreference = extractedFacts["appointment_preference"] as Record<
        string,
        unknown
      >;
      const factualClaim = (complete["factual_claims"] as Record<string, unknown>[])[0];

      if (factualClaim === undefined) {
        throw new TypeError("Expected a factual claim fixture");
      }

      expect(isSchemaValue(AgentDecisionV1Schema, { ...complete, [field]: value })).toBe(false);
      expect(
        isSchemaValue(AgentDecisionV1Schema, {
          ...complete,
          action: { ...(complete["action"] as Record<string, unknown>), [field]: value },
        }),
      ).toBe(false);
      expect(
        isSchemaValue(AgentDecisionV1Schema, {
          ...complete,
          extracted_facts: { ...extractedFacts, [field]: value },
        }),
      ).toBe(false);
      expect(
        isSchemaValue(AgentDecisionV1Schema, {
          ...complete,
          extracted_facts: {
            ...extractedFacts,
            appointment_preference: { ...appointmentPreference, [field]: value },
          },
        }),
      ).toBe(false);
      expect(
        isSchemaValue(AgentDecisionV1Schema, {
          ...complete,
          factual_claims: [{ ...factualClaim, [field]: value }],
        }),
      ).toBe(false);
      expect(
        isSchemaValue(AgentDecisionV1Schema, {
          ...complete,
          message: { ...(complete["message"] as Record<string, unknown>), [field]: value },
        }),
      ).toBe(false);
      expect(
        isSchemaValue(AgentDecisionV1Schema, {
          ...complete,
          safety: { ...(complete["safety"] as Record<string, unknown>), [field]: value },
        }),
      ).toBe(false);
    },
  );

  it.each([
    { args: {}, tool: "database" },
    { function: "createBooking", parameters: {} },
    { command: "rm -rf /" },
    { method: "POST", url: "https://example.test/calendar" },
    { query: "select * from organizations", sql: true },
  ])("rejects generic tool/function/command action surface %#", (action) => {
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ action }))).toBe(false);
  });

  it.each([
    "BOOK_APPOINTMENT",
    "CONFIRM_APPOINTMENT",
    "UPDATE_CALENDAR",
    "DELETE_APPOINTMENT",
    "RESCHEDULE_CALENDAR",
    "CHECK_AND_RESERVE_SLOT",
    "SET_PRICE",
    "APPLY_DISCOUNT",
    "CHANGE_PRICE",
    "OVERRIDE_PRICE",
  ])("rejects authoritative booking/pricing action %s", (type) => {
    expect(isSchemaValue(AgentDecisionV1Schema, createDecision({ action: { type } }))).toBe(false);
  });
});
