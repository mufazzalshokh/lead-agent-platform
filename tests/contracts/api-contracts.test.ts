import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ApiErrorCodeSchema,
  MoneySchema,
  OpaqueCursorSchema,
  PageSizeSchema,
  PaginationMetaSchema,
  PaginationRequestSchema,
  ProblemSchema,
  ResponseMetaSchema,
  SchemaIdSchema,
  ValidationIssueSchema,
  createCollectionEnvelopeSchema,
  createSuccessEnvelopeSchema,
  isSchemaValue,
  type ApiErrorCode,
  type OpaqueCursor,
  type PaginationRequest,
  type Problem,
} from "../../packages/contracts/src/index.js";

const REQUEST_ID = "req_01JQ4Z7YRXG8M4NP6V2C3D5E6F";
const CURSOR = "eyJwYWdlIjoyfQ";

const ERROR_CODES_BY_STATUS = [
  [400, ["request_malformed", "validation_failed"]],
  [401, ["authentication_required", "token_invalid", "webhook_signature_invalid"]],
  [403, ["permission_denied", "origin_not_allowed", "csrf_invalid"]],
  [404, ["resource_not_found"]],
  [409, ["idempotency_conflict", "version_conflict", "appointment_transition_invalid"]],
  [422, ["business_rule_failed", "customer_confirmation_invalid"]],
  [429, ["rate_limited"]],
  [500, ["internal_error"]],
  [503, ["dependency_unavailable", "temporarily_unavailable"]],
] as const;

const ERROR_STATUS_FIXTURES = ERROR_CODES_BY_STATUS.flatMap(([status, codes]) =>
  codes.map((code) => ({ code, status })),
);

const createProblem = (status: number, code: string) => ({
  code,
  detail: "The request could not be completed safely.",
  instance: "/v1/staff/appointment-requests/0193f1a8/accept",
  request_id: REQUEST_ID,
  status,
  title: "Request could not be completed",
  type: `https://api.example.test/problems/${code.replaceAll("_", "-")}`,
});

const apiSchemas = [
  ApiErrorCodeSchema,
  ValidationIssueSchema,
  ProblemSchema,
  OpaqueCursorSchema,
  PageSizeSchema,
  PaginationRequestSchema,
  PaginationMetaSchema,
  ResponseMetaSchema,
] as const;

describe("API contract schema publication", () => {
  it("publishes unique versioned schema IDs and serializable JSON Schemas", () => {
    const schemaIds = apiSchemas.map((schema) => ("$id" in schema ? schema.$id : undefined));

    expect(schemaIds).toHaveLength(new Set(schemaIds).size);
    expect(schemaIds.every((schemaId) => isSchemaValue(SchemaIdSchema, schemaId))).toBe(true);

    for (const schema of apiSchemas) {
      expect(() => JSON.stringify(schema)).not.toThrow();
    }
  });

  it("derives public TypeScript types from the schemas", () => {
    expectTypeOf<ApiErrorCode>().toEqualTypeOf<
      | "appointment_transition_invalid"
      | "authentication_required"
      | "business_rule_failed"
      | "csrf_invalid"
      | "customer_confirmation_invalid"
      | "dependency_unavailable"
      | "idempotency_conflict"
      | "internal_error"
      | "origin_not_allowed"
      | "permission_denied"
      | "rate_limited"
      | "request_malformed"
      | "resource_not_found"
      | "temporarily_unavailable"
      | "token_invalid"
      | "validation_failed"
      | "version_conflict"
      | "webhook_signature_invalid"
    >();
    expectTypeOf<Problem>().toMatchTypeOf<{ request_id: string; status: number }>();
    expectTypeOf<PaginationRequest>().toMatchTypeOf<{
      cursor?: OpaqueCursor;
      limit?: number;
    }>();
  });
});

describe("RFC 9457-style Problem contract", () => {
  it.each(ERROR_STATUS_FIXTURES)("accepts $status $code", ({ code, status }) => {
    const problem = createProblem(status, code);

    expect(isSchemaValue(ApiErrorCodeSchema, code)).toBe(true);
    expect(isSchemaValue(ProblemSchema, problem)).toBe(true);
    expect(isSchemaValue(ProblemSchema, JSON.parse(JSON.stringify(problem)))).toBe(true);
  });

  it.each(ERROR_STATUS_FIXTURES)(
    "rejects $code when paired with the wrong HTTP status",
    ({ code, status }) => {
      const wrongStatus = status === 500 ? 400 : 500;

      expect(isSchemaValue(ProblemSchema, createProblem(wrongStatus, code))).toBe(false);
    },
  );

  it("accepts bounded validation issues and permits them to be absent", () => {
    const withoutIssues = createProblem(400, "validation_failed");
    const withIssues = {
      ...withoutIssues,
      errors: [
        {
          code: "stale_version",
          message: "The expected version is no longer current.",
          path: "/expected_version",
        },
        {
          code: "invalid_value",
          message: "One nested value is invalid.",
          path: "/items/0/value~1name",
        },
      ],
    };

    expect(isSchemaValue(ProblemSchema, withoutIssues)).toBe(true);
    expect(isSchemaValue(ProblemSchema, withIssues)).toBe(true);
    expect(isSchemaValue(ValidationIssueSchema, withIssues.errors[0])).toBe(true);
  });

  it.each(["type", "title", "status", "code", "detail", "instance", "request_id"] as const)(
    "rejects a Problem missing required member %s",
    (field) => {
      const problem = createProblem(409, "version_conflict");
      Reflect.deleteProperty(problem, field);

      expect(isSchemaValue(ProblemSchema, problem)).toBe(false);
    },
  );

  it.each([
    ["stack", "Error at database.ts:42"],
    ["sql", "SELECT * FROM memberships"],
    ["query", "SELECT secret FROM organizations"],
    ["constraint", "appointments_version_check"],
    ["providerBody", { authorization: "Bearer secret" }],
    ["provider_response", { authorization: "Bearer secret" }],
    ["secret", "super-secret"],
    ["token", "signed-token"],
    ["cookie", "session=secret"],
    ["organizationId", "0193f1a8-7f65-7c28-a434-a10796c41c2b"],
    ["organization_id", "0193f1a8-7f65-7c28-a434-a10796c41c2b"],
  ])("rejects public Problem internal or authority-smuggling member %s", (field, value) => {
    expect(
      isSchemaValue(ProblemSchema, {
        ...createProblem(500, "internal_error"),
        [field]: value,
      }),
    ).toBe(false);
  });

  it.each([
    { ...createProblem(500, "internal_error"), code: "database_error" },
    { ...createProblem(500, "internal_error"), detail: "" },
    { ...createProblem(500, "internal_error"), detail: "d".repeat(2_001) },
    { ...createProblem(500, "internal_error"), detail: "unsafe\u0000detail" },
    { ...createProblem(500, "internal_error"), instance: "/v2/private" },
    { ...createProblem(500, "internal_error"), instance: "/v1/private?token=secret" },
    { ...createProblem(500, "internal_error"), request_id: "customer@example.com" },
    { ...createProblem(500, "internal_error"), status: "500" },
    { ...createProblem(500, "internal_error"), title: "" },
    { ...createProblem(500, "internal_error"), title: "t".repeat(201) },
    { ...createProblem(500, "internal_error"), type: "javascript:alert(1)" },
    { ...createProblem(500, "internal_error"), type: "https://example.test/problem\nsecret" },
    { ...createProblem(400, "validation_failed"), errors: [] },
    {
      ...createProblem(400, "validation_failed"),
      errors: Array.from({ length: 51 }, () => ({
        code: "invalid_value",
        message: "Invalid value.",
        path: "/value",
      })),
    },
  ])("rejects malformed or oversized Problem fixture %#", (candidate) => {
    expect(isSchemaValue(ProblemSchema, candidate)).toBe(false);
  });

  it.each([
    { code: "invalid-value", message: "Invalid value.", path: "/value" },
    { code: "InvalidValue", message: "Invalid value.", path: "/value" },
    { code: `a${"a".repeat(64)}`, message: "Invalid value.", path: "/value" },
    { code: "invalid_value", message: "", path: "/value" },
    { code: "invalid_value", message: "m".repeat(501), path: "/value" },
    { code: "invalid_value", message: "unsafe\u0000message", path: "/value" },
    { code: "invalid_value", message: "Invalid value.", path: "value" },
    { code: "invalid_value", message: "Invalid value.", path: "/value/" },
    { code: "invalid_value", message: "Invalid value.", path: "/value~2name" },
    {
      code: "invalid_value",
      message: "Invalid value.",
      path: `/${Array.from({ length: 17 }, () => "value").join("/")}`,
    },
    { code: "invalid_value", message: "Invalid value.", path: `/${"a".repeat(513)}` },
    {
      code: "invalid_value",
      internal_details: { constraint: "appointments_version_check" },
      message: "Invalid value.",
      path: "/value",
    },
    {
      code: "invalid_value",
      message: "Invalid value.",
      path: "/value",
      rejected_input: { token: "do-not-reflect" },
    },
  ])("rejects unsafe validation issue fixture %#", (candidate) => {
    expect(isSchemaValue(ValidationIssueSchema, candidate)).toBe(false);
  });

  it.each([
    "invalid_recipient",
    "authentication_failed",
    "provider_unavailable",
    "unsupported_content",
    "permanent_rejection",
    "cross_tenant_access",
  ])("does not admit non-API or tenant-revealing public code %s", (candidate) => {
    expect(isSchemaValue(ApiErrorCodeSchema, candidate)).toBe(false);
  });
});

describe("keyset pagination contracts", () => {
  it("publishes the documented page-size default without coercing input", () => {
    expect(JSON.stringify(PageSizeSchema)).toContain('"default":50');
  });

  it.each([
    {},
    { limit: 1 },
    { limit: 50 },
    { limit: 100 },
    { cursor: CURSOR },
    { cursor: CURSOR, limit: 25 },
  ])("accepts bounded parsed pagination request %j", (candidate) => {
    expect(isSchemaValue(PaginationRequestSchema, candidate)).toBe(true);
  });

  it.each([
    { limit: 0 },
    { limit: -1 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: Number.MAX_SAFE_INTEGER + 1 },
    { limit: "50" },
    { cursor: "" },
    { cursor: "a" },
    { cursor: "abcde" },
    { cursor: "YWJj=" },
    { cursor: "YW Jj" },
    { cursor: "YWJj+/" },
    { cursor: "YWJj\n" },
    { cursor: "A".repeat(2_052) },
    { cursor: null },
    { cursor: { organization_id: "tenant-a" } },
    { filter: { organization_id: "tenant-a" } },
    { order: { sql: "created_at desc" } },
    { offset: 50 },
    { organization_id: "tenant-a" },
    { sql: "select * from messages" },
    { cursor: CURSOR, tenant_id: "tenant-a" },
  ])("rejects malformed, oversized, offset, or authority-smuggling pagination %j", (candidate) => {
    expect(isSchemaValue(PaginationRequestSchema, candidate)).toBe(false);
  });

  it.each(["YQ", "YWI", "YWJj", CURSOR])("accepts unpadded base64url cursor %s", (candidate) => {
    expect(isSchemaValue(OpaqueCursorSchema, candidate)).toBe(true);
  });

  it.each([
    { has_more: false, request_id: REQUEST_ID },
    { has_more: false, next_cursor: null, request_id: REQUEST_ID },
    { has_more: true, next_cursor: CURSOR, request_id: REQUEST_ID },
  ])("accepts coherent pagination metadata %j", (candidate) => {
    expect(isSchemaValue(PaginationMetaSchema, candidate)).toBe(true);
  });

  it.each([
    { has_more: true, request_id: REQUEST_ID },
    { has_more: true, next_cursor: null, request_id: REQUEST_ID },
    { has_more: false, next_cursor: CURSOR, request_id: REQUEST_ID },
    { has_more: false, next_cursor: null },
    { has_more: false, next_cursor: null, request_id: REQUEST_ID, tenant_id: "tenant-a" },
  ])("rejects incoherent or authority-smuggling pagination metadata %j", (candidate) => {
    expect(isSchemaValue(PaginationMetaSchema, candidate)).toBe(false);
  });
});

describe("success response envelopes", () => {
  const SuccessEnvelopeSchema = createSuccessEnvelopeSchema(MoneySchema, "TestResourceResponse.v1");
  const CollectionEnvelopeSchema = createCollectionEnvelopeSchema(
    MoneySchema,
    "TestResourceCollectionResponse.v1",
  );

  it("accepts canonical single-resource and collection response envelopes", () => {
    const single = {
      data: { amount_minor: 12_500, currency: "USD" },
      meta: { request_id: REQUEST_ID },
    };
    const collection = {
      data: [{ amount_minor: 12_500, currency: "USD" }],
      meta: { has_more: true, next_cursor: CURSOR, request_id: REQUEST_ID },
    };

    expect(isSchemaValue(SuccessEnvelopeSchema, single)).toBe(true);
    expect(isSchemaValue(CollectionEnvelopeSchema, collection)).toBe(true);
    expect(isSchemaValue(SuccessEnvelopeSchema, JSON.parse(JSON.stringify(single)))).toBe(true);
    expect(isSchemaValue(CollectionEnvelopeSchema, JSON.parse(JSON.stringify(collection)))).toBe(
      true,
    );
  });

  it.each([
    {
      data: { amount_minor: 12_500, currency: "USD" },
      meta: { request_id: REQUEST_ID },
      tenant_id: "tenant-a",
    },
    {
      data: { amount_minor: 12_500, currency: "USD", secret: "hidden" },
      meta: { request_id: REQUEST_ID },
    },
    {
      data: { amount_minor: 12_500, currency: "USD" },
      meta: { request_id: REQUEST_ID, trace_id: "internal" },
    },
    { data: { amount_minor: 12_500, currency: "USD" } },
  ])("rejects malformed or internal single-resource response %j", (candidate) => {
    expect(isSchemaValue(SuccessEnvelopeSchema, candidate)).toBe(false);
  });

  it("bounds collection envelopes to the documented maximum page size", () => {
    const candidate = {
      data: Array.from({ length: 101 }, () => ({ amount_minor: 12_500, currency: "USD" })),
      meta: { has_more: false, next_cursor: null, request_id: REQUEST_ID },
    };

    expect(isSchemaValue(CollectionEnvelopeSchema, candidate)).toBe(false);
  });

  it.each(["Unversioned", "Response.v0", "Response.v01", "Response name.v1"])(
    "rejects invalid envelope schema ID %s",
    (schemaId) => {
      expect(() => createSuccessEnvelopeSchema(MoneySchema, schemaId)).toThrow(TypeError);
      expect(() => createCollectionEnvelopeSchema(MoneySchema, schemaId)).toThrow(TypeError);
    },
  );
});
