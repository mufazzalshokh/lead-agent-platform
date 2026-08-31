import Type from "typebox";

import { ActorRefSchema, type ActorRef } from "../shared/actor.js";
import {
  CausationIdSchema,
  CorrelationIdSchema,
  EventIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  SchemaIdSchema,
  type CausationId,
  type CorrelationId,
  type EventId,
  type OrganizationId,
  type RequestId,
  type SchemaId,
} from "../shared/identifiers.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import {
  AggregateVersionSchema,
  SchemaVersionSchema,
  type AggregateVersion,
  type SchemaVersion,
} from "../shared/version.js";
import { isSchemaValue } from "../shared/validation.js";

type EventDefinition = {
  readonly eventSchema: Type.TSchema;
  readonly payloadSchema: Type.TSchema;
};

export type JsonWire<Value> = Value extends string
  ? string
  : Value extends number
    ? number
    : Value extends boolean
      ? boolean
      : Value extends null
        ? null
        : Value extends readonly (infer Item)[]
          ? JsonWire<Item>[]
          : Value extends object
            ? { readonly [Key in keyof Value]: JsonWire<Value[Key]> }
            : never;

export const embedSchemaAs = <Value>(schema: Type.TSchema) => {
  const embeddedSchema = { ...schema } as Record<PropertyKey, unknown>;
  delete embeddedSchema["$id"];

  return Type.Unsafe<Value>(embeddedSchema);
};

export const embedSchema = <Schema extends Type.TSchema>(schema: Schema) =>
  embedSchemaAs<Type.Static<Schema>>(schema);

export const boundedCodeSchema = () =>
  Type.String({
    description: "Bounded stable code; never free-form diagnostics or customer content.",
    maxLength: 100,
    minLength: 1,
    pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$",
  });

export const boundedCodeArraySchema = () =>
  Type.Array(boundedCodeSchema(), {
    maxItems: 16,
    minItems: 1,
    uniqueItems: true,
  });

const toPascalCase = (value: string) =>
  value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");

const eventSchemaPrefix = (eventType: string) =>
  eventType
    .split(".")
    .map((part) => toPascalCase(part))
    .join("");

const requireSchemaId = (schemaId: string) => {
  if (!isSchemaValue(SchemaIdSchema, schemaId)) {
    throw new TypeError(`Invalid domain event schema ID: ${schemaId}`);
  }

  return schemaId;
};

const schemaIdLiteral = (schemaId: string) =>
  Type.Unsafe<SchemaId>(Type.Literal(requireSchemaId(schemaId)));

const schemaVersionLiteral = (schemaVersion: string) => {
  if (!isSchemaValue(SchemaVersionSchema, schemaVersion)) {
    throw new TypeError("Invalid domain event schema version");
  }

  return Type.Unsafe<SchemaVersion>(Type.Literal(schemaVersion));
};

/**
 * Defines data contracts only. Organization and actor values are provenance,
 * never authorization; consumers must re-establish trusted tenant/actor context.
 */
export const defineDomainEvent = <
  const EventType extends string,
  const AggregateType extends string,
  AggregateIdSchema extends Type.TSchema,
  const PayloadProperties extends Type.TProperties,
>(
  eventType: EventType,
  aggregateType: AggregateType,
  aggregateIdSchema: AggregateIdSchema,
  payloadProperties: PayloadProperties,
): EventDefinition & {
  readonly eventSchema: Type.TObject<{
    actor: Type.TUnsafe<ActorRef>;
    aggregate_id: Type.TUnsafe<Type.Static<AggregateIdSchema>>;
    aggregate_type: Type.TLiteral<AggregateType>;
    aggregate_version: Type.TUnsafe<AggregateVersion>;
    causation_id: Type.TUnion<[Type.TUnsafe<CausationId>, Type.TNull]>;
    correlation_id: Type.TUnsafe<CorrelationId>;
    event_id: Type.TUnsafe<EventId>;
    event_type: Type.TLiteral<EventType>;
    occurred_at: Type.TUnsafe<UtcTimestamp>;
    organization_id: Type.TUnsafe<OrganizationId>;
    payload: Type.TUnsafe<Type.Static<Type.TObject<PayloadProperties>>>;
    request_id: Type.TUnion<[Type.TUnsafe<RequestId>, Type.TNull]>;
    schema_id: Type.TUnsafe<SchemaId>;
    schema_version: Type.TUnsafe<SchemaVersion>;
  }>;
  readonly payloadSchema: Type.TObject<PayloadProperties>;
} => {
  const prefix = eventSchemaPrefix(eventType);
  const schemaId = requireSchemaId(`${prefix}DomainEvent.v1`);
  const payloadSchema = Type.Object(payloadProperties, {
    $id: requireSchemaId(`${prefix}DomainEventPayload.v1`),
    additionalProperties: false,
    description: `Minimal privacy-safe payload for ${eventType}.`,
  });

  const eventSchema = Type.Object(
    {
      actor: embedSchema(ActorRefSchema),
      aggregate_id: embedSchema(aggregateIdSchema),
      aggregate_type: Type.Literal(aggregateType),
      aggregate_version: embedSchema(AggregateVersionSchema),
      causation_id: Type.Union([embedSchema(CausationIdSchema), Type.Null()]),
      correlation_id: embedSchema(CorrelationIdSchema),
      event_id: embedSchema(EventIdSchema),
      event_type: Type.Literal(eventType),
      occurred_at: embedSchema(UtcTimestampSchema),
      organization_id: embedSchema(OrganizationIdSchema),
      payload: embedSchema(payloadSchema),
      request_id: Type.Union([embedSchema(RequestIdSchema), Type.Null()]),
      schema_id: schemaIdLiteral(schemaId),
      schema_version: schemaVersionLiteral("1"),
    },
    {
      $id: schemaId,
      additionalProperties: false,
      description:
        "Versioned committed domain fact. Provenance fields do not authenticate or authorize a consumer.",
    },
  );

  return { eventSchema, payloadSchema };
};

/**
 * Defines an additional schema version for an existing semantic event type.
 * The caller supplies a closed, canonically identified payload schema so a
 * version may use a discriminated union without changing the V1 helper.
 */
export const defineDomainEventVersion = <
  const EventType extends string,
  const AggregateType extends string,
  AggregateIdSchema extends Type.TSchema,
  PayloadSchema extends Type.TSchema,
>(
  eventType: EventType,
  aggregateType: AggregateType,
  aggregateIdSchema: AggregateIdSchema,
  schemaVersion: string,
  payloadSchema: PayloadSchema,
): EventDefinition & {
  readonly eventSchema: Type.TObject<{
    actor: Type.TUnsafe<ActorRef>;
    aggregate_id: Type.TUnsafe<Type.Static<AggregateIdSchema>>;
    aggregate_type: Type.TLiteral<AggregateType>;
    aggregate_version: Type.TUnsafe<AggregateVersion>;
    causation_id: Type.TUnion<[Type.TUnsafe<CausationId>, Type.TNull]>;
    correlation_id: Type.TUnsafe<CorrelationId>;
    event_id: Type.TUnsafe<EventId>;
    event_type: Type.TLiteral<EventType>;
    occurred_at: Type.TUnsafe<UtcTimestamp>;
    organization_id: Type.TUnsafe<OrganizationId>;
    payload: Type.TUnsafe<Type.Static<PayloadSchema>>;
    request_id: Type.TUnion<[Type.TUnsafe<RequestId>, Type.TNull]>;
    schema_id: Type.TUnsafe<SchemaId>;
    schema_version: Type.TUnsafe<SchemaVersion>;
  }>;
  readonly payloadSchema: PayloadSchema;
} => {
  const prefix = eventSchemaPrefix(eventType);
  const schemaId = requireSchemaId(`${prefix}DomainEvent.v${schemaVersion}`);
  const expectedPayloadSchemaId = requireSchemaId(`${prefix}DomainEventPayload.v${schemaVersion}`);

  if (Reflect.get(payloadSchema, "$id") !== expectedPayloadSchemaId) {
    throw new TypeError(`Domain event payload schema ID must be ${expectedPayloadSchemaId}`);
  }

  const eventSchema = Type.Object(
    {
      actor: embedSchema(ActorRefSchema),
      aggregate_id: embedSchema(aggregateIdSchema),
      aggregate_type: Type.Literal(aggregateType),
      aggregate_version: embedSchema(AggregateVersionSchema),
      causation_id: Type.Union([embedSchema(CausationIdSchema), Type.Null()]),
      correlation_id: embedSchema(CorrelationIdSchema),
      event_id: embedSchema(EventIdSchema),
      event_type: Type.Literal(eventType),
      occurred_at: embedSchema(UtcTimestampSchema),
      organization_id: embedSchema(OrganizationIdSchema),
      payload: embedSchema(payloadSchema),
      request_id: Type.Union([embedSchema(RequestIdSchema), Type.Null()]),
      schema_id: schemaIdLiteral(schemaId),
      schema_version: schemaVersionLiteral(schemaVersion),
    },
    {
      $id: schemaId,
      additionalProperties: false,
      description:
        "Versioned committed domain fact. Provenance fields do not authenticate or authorize a consumer.",
    },
  );

  return { eventSchema, payloadSchema };
};
