import Type from "typebox";

import { RequestIdSchema, type RequestId } from "../shared/identifiers.js";
import { withoutSchemaId } from "./embedding.js";

const SAFE_TEXT_PATTERN = "^[^\\u0000-\\u001F\\u007F]*$";
const JSON_POINTER_PATTERN =
  "^(?:|/(?:[A-Za-z0-9_-]|~[01]){1,64}(?:/(?:[A-Za-z0-9_-]|~[01]){1,64}){0,15})$";
const PROBLEM_INSTANCE_PATTERN = "^/v1(?:/[^\\s?#]*)?$";
const PROBLEM_TYPE_PATTERN = "^https://[^\\s]+$";

const EmbeddedRequestIdSchema = withoutSchemaId<RequestId>(RequestIdSchema);

const BadRequestCodeSchema = Type.Union([
  Type.Literal("request_malformed"),
  Type.Literal("validation_failed"),
]);
const UnauthorizedCodeSchema = Type.Union([
  Type.Literal("authentication_required"),
  Type.Literal("token_invalid"),
  Type.Literal("webhook_signature_invalid"),
]);
const ForbiddenCodeSchema = Type.Union([
  Type.Literal("permission_denied"),
  Type.Literal("origin_not_allowed"),
  Type.Literal("csrf_invalid"),
]);
const NotFoundCodeSchema = Type.Literal("resource_not_found");
const ConflictCodeSchema = Type.Union([
  Type.Literal("idempotency_conflict"),
  Type.Literal("version_conflict"),
  Type.Literal("appointment_transition_invalid"),
]);
const UnprocessableContentCodeSchema = Type.Union([
  Type.Literal("business_rule_failed"),
  Type.Literal("customer_confirmation_invalid"),
]);
const TooManyRequestsCodeSchema = Type.Literal("rate_limited");
const InternalServerErrorCodeSchema = Type.Literal("internal_error");
const ServiceUnavailableCodeSchema = Type.Union([
  Type.Literal("dependency_unavailable"),
  Type.Literal("temporarily_unavailable"),
]);

export const ApiErrorCodeSchema = Type.Union(
  [
    BadRequestCodeSchema,
    UnauthorizedCodeSchema,
    ForbiddenCodeSchema,
    NotFoundCodeSchema,
    ConflictCodeSchema,
    UnprocessableContentCodeSchema,
    TooManyRequestsCodeSchema,
    InternalServerErrorCodeSchema,
    ServiceUnavailableCodeSchema,
  ],
  {
    $id: "ApiErrorCode.v1",
    description: "Stable public V1 API error code.",
  },
);
export type ApiErrorCode = Type.Static<typeof ApiErrorCodeSchema>;

const createValidationIssueSchema = ($id?: string) =>
  Type.Object(
    {
      code: Type.String({
        description: "Stable machine-readable validation issue code.",
        maxLength: 64,
        minLength: 1,
        pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$",
      }),
      message: Type.String({
        description: "Bounded, client-safe validation issue description.",
        maxLength: 500,
        minLength: 1,
        pattern: SAFE_TEXT_PATTERN,
      }),
      path: Type.String({
        description: "Bounded JSON Pointer to the invalid request member.",
        maxLength: 512,
        pattern: JSON_POINTER_PATTERN,
      }),
    },
    {
      ...($id === undefined ? {} : { $id }),
      additionalProperties: false,
      description: "A bounded public validation issue without internal diagnostics.",
    },
  );

export const ValidationIssueSchema = createValidationIssueSchema("ValidationIssue.v1");
export type ValidationIssue = Type.Static<typeof ValidationIssueSchema>;

const createProblemVariant = <const Status extends number, CodeSchema extends Type.TSchema>(
  status: Status,
  codeSchema: CodeSchema,
) =>
  Type.Object(
    {
      code: codeSchema,
      detail: Type.String({
        description: "Bounded, client-safe explanation for this occurrence.",
        maxLength: 2_000,
        minLength: 1,
        pattern: SAFE_TEXT_PATTERN,
      }),
      errors: Type.Optional(
        Type.Array(createValidationIssueSchema(), {
          description: "Bounded field-level validation issues.",
          maxItems: 50,
          minItems: 1,
        }),
      ),
      instance: Type.String({
        description: "Safe V1 request path identifying this problem occurrence.",
        format: "uri-reference",
        maxLength: 2_048,
        minLength: 3,
        pattern: PROBLEM_INSTANCE_PATTERN,
      }),
      request_id: EmbeddedRequestIdSchema,
      status: Type.Literal(status),
      title: Type.String({
        description: "Short, stable, client-safe problem title.",
        maxLength: 200,
        minLength: 1,
        pattern: SAFE_TEXT_PATTERN,
      }),
      type: Type.String({
        description: "Absolute HTTPS URI identifying the public problem class.",
        format: "uri",
        maxLength: 2_048,
        minLength: 8,
        pattern: PROBLEM_TYPE_PATTERN,
      }),
    },
    {
      additionalProperties: false,
    },
  );

export const ProblemSchema = Type.Union(
  [
    createProblemVariant(400, BadRequestCodeSchema),
    createProblemVariant(401, UnauthorizedCodeSchema),
    createProblemVariant(403, ForbiddenCodeSchema),
    createProblemVariant(404, NotFoundCodeSchema),
    createProblemVariant(409, ConflictCodeSchema),
    createProblemVariant(422, UnprocessableContentCodeSchema),
    createProblemVariant(429, TooManyRequestsCodeSchema),
    createProblemVariant(500, InternalServerErrorCodeSchema),
    createProblemVariant(503, ServiceUnavailableCodeSchema),
  ],
  {
    $id: "Problem.v1",
    description: "RFC 9457-style public API problem with a correlated stable code.",
  },
);
export type Problem = Type.Static<typeof ProblemSchema>;
