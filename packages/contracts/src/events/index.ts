import Type from "typebox";

import { domainEventDefinitions, leadReopenedDomainEventV2Definition } from "./catalog.js";

type EventDefinitions = typeof domainEventDefinitions;

export const DomainEventSchemas = Object.fromEntries(
  Object.entries(domainEventDefinitions).map(([eventName, definition]) => [
    eventName,
    definition.eventSchema,
  ]),
) as {
  readonly [EventName in keyof EventDefinitions]: EventDefinitions[EventName]["eventSchema"];
};

export const DomainEventPayloadSchemas = Object.fromEntries(
  Object.entries(domainEventDefinitions).map(([eventName, definition]) => [
    eventName,
    definition.payloadSchema,
  ]),
) as {
  readonly [EventName in keyof EventDefinitions]: EventDefinitions[EventName]["payloadSchema"];
};

export const LeadReopenedDomainEventV2Schema = leadReopenedDomainEventV2Definition.eventSchema;
export const LeadReopenedDomainEventPayloadV2Schema =
  leadReopenedDomainEventV2Definition.payloadSchema;

const v1EventSchemasByVersion = Object.fromEntries(
  Object.entries(DomainEventSchemas).map(([eventName, schema]) => [
    eventName,
    Object.freeze({ "1": schema }),
  ]),
) as {
  readonly [EventName in keyof EventDefinitions]: {
    readonly "1": (typeof DomainEventSchemas)[EventName];
  };
};

const v1PayloadSchemasByVersion = Object.fromEntries(
  Object.entries(DomainEventPayloadSchemas).map(([eventName, schema]) => [
    eventName,
    Object.freeze({ "1": schema }),
  ]),
) as {
  readonly [EventName in keyof EventDefinitions]: {
    readonly "1": (typeof DomainEventPayloadSchemas)[EventName];
  };
};

/**
 * Version-aware validation registry. The legacy maps above intentionally stay
 * V1 compatibility views; new consumers select by event_type + schema_version.
 */
export const DomainEventSchemasByVersion = Object.freeze({
  ...v1EventSchemasByVersion,
  "lead.reopened": Object.freeze({
    "1": DomainEventSchemas["lead.reopened"],
    "2": LeadReopenedDomainEventV2Schema,
  }),
});

export const DomainEventPayloadSchemasByVersion = Object.freeze({
  ...v1PayloadSchemasByVersion,
  "lead.reopened": Object.freeze({
    "1": DomainEventPayloadSchemas["lead.reopened"],
    "2": LeadReopenedDomainEventPayloadV2Schema,
  }),
});

export type LeadReopenedDomainEventV2 = Type.Static<typeof LeadReopenedDomainEventV2Schema>;
export type LeadReopenedDomainEventPayloadV2 = Type.Static<
  typeof LeadReopenedDomainEventPayloadV2Schema
>;

export type DomainEventName = keyof typeof DomainEventSchemas;
export type DomainEventFor<EventName extends DomainEventName> = Type.Static<
  (typeof DomainEventSchemas)[EventName]
>;
export type DomainEvent = DomainEventFor<DomainEventName>;
export type DomainEventPayloadByName = {
  readonly [EventName in DomainEventName]: Type.Static<
    (typeof DomainEventPayloadSchemas)[EventName]
  >;
};
export type DomainAggregateType = DomainEvent["aggregate_type"];

export const DOMAIN_EVENT_NAMES = Object.freeze(
  Object.keys(DomainEventSchemas) as DomainEventName[],
);

const domainEventNameLiterals = DOMAIN_EVENT_NAMES.map((eventName) => Type.Literal(eventName)) as [
  Type.TLiteral<DomainEventName>,
  ...Type.TLiteral<DomainEventName>[],
];

export const DomainEventNameSchema = Type.Unsafe<DomainEventName>(
  Type.Union(domainEventNameLiterals, {
    $id: "DomainEventName.v1",
    description: "Closed Stage 0 domain-event name vocabulary.",
  }),
);

const aggregateTypes = [
  ...new Set(
    Object.values(DomainEventSchemas).map((schema) => schema.properties.aggregate_type.const),
  ),
].sort();

const domainAggregateTypeLiterals = aggregateTypes.map((aggregateType) =>
  Type.Literal(aggregateType),
) as [Type.TLiteral<DomainAggregateType>, ...Type.TLiteral<DomainAggregateType>[]];

export const DomainAggregateTypeSchema = Type.Unsafe<DomainAggregateType>(
  Type.Union(domainAggregateTypeLiterals, {
    $id: "DomainAggregateType.v1",
    description: "Closed aggregate-root provenance vocabulary used by Stage 0 events.",
  }),
);

const domainEventVariants = Object.values(DomainEventSchemas) as [
  (typeof DomainEventSchemas)[DomainEventName],
  ...(typeof DomainEventSchemas)[DomainEventName][],
];

export const DomainEventSchema = Type.Unsafe<DomainEvent>(
  Type.Union(domainEventVariants, {
    $id: "DomainEvent.v1",
    description: "Runtime-discriminated union of every accepted Stage 0 domain event.",
  }),
);
