import { isKnownEventVersion, isRoutedEventType, type RoutedEventType } from "./event-routing.js";

export const PRIVATE_JOB_SCHEMA_VERSION = "1" as const;

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGGREGATE_TYPES = new Set([
  "ai_run",
  "appointment_request",
  "business_policy",
  "channel_connection",
  "contact",
  "conversation",
  "faq",
  "handoff",
  "lead",
  "location",
  "membership",
  "notification",
  "organization",
  "service",
]);

export type PrivateQueueEnvelopeV1 = Readonly<{
  job_schema_version: typeof PRIVATE_JOB_SCHEMA_VERSION;
  outbox_event_id: string;
  organization_id: string;
  event_type: RoutedEventType;
  event_schema_version: string;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id?: string;
}>;

export class PrivateQueueEnvelopeValidationError extends Error {
  readonly code = "private_queue_envelope_invalid" as const;

  constructor() {
    super("Private queue envelope validation failed");
    this.name = "PrivateQueueEnvelopeValidationError";
  }
}

const REQUIRED_KEYS = Object.freeze([
  "job_schema_version",
  "outbox_event_id",
  "organization_id",
  "event_type",
  "event_schema_version",
  "aggregate_type",
  "aggregate_id",
  "correlation_id",
] as const);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isPrivateQueueEnvelopeV1 = (value: unknown): value is PrivateQueueEnvelopeV1 => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    ...REQUIRED_KEYS,
    ...(value["causation_id"] === undefined ? [] : ["causation_id"]),
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }

  return (
    value["job_schema_version"] === PRIVATE_JOB_SCHEMA_VERSION &&
    typeof value["outbox_event_id"] === "string" &&
    UUID_V7_PATTERN.test(value["outbox_event_id"]) &&
    typeof value["organization_id"] === "string" &&
    UUID_V7_PATTERN.test(value["organization_id"]) &&
    isRoutedEventType(value["event_type"]) &&
    typeof value["event_schema_version"] === "string" &&
    isKnownEventVersion(value["event_type"], value["event_schema_version"]) &&
    typeof value["aggregate_type"] === "string" &&
    AGGREGATE_TYPES.has(value["aggregate_type"]) &&
    typeof value["aggregate_id"] === "string" &&
    UUID_V7_PATTERN.test(value["aggregate_id"]) &&
    typeof value["correlation_id"] === "string" &&
    UUID_V7_PATTERN.test(value["correlation_id"]) &&
    (value["causation_id"] === undefined ||
      (typeof value["causation_id"] === "string" && UUID_V7_PATTERN.test(value["causation_id"])))
  );
};

export const requirePrivateQueueEnvelopeV1 = (value: unknown): PrivateQueueEnvelopeV1 => {
  if (!isPrivateQueueEnvelopeV1(value)) throw new PrivateQueueEnvelopeValidationError();
  return value;
};

export const createPrivateQueueEnvelopeV1 = (input: {
  aggregateId: string;
  aggregateType: string;
  causationId: string | null;
  correlationId: string;
  eventSchemaVersion: string;
  eventType: RoutedEventType;
  organizationId: string;
  outboxEventId: string;
}): PrivateQueueEnvelopeV1 => {
  const envelope = {
    job_schema_version: PRIVATE_JOB_SCHEMA_VERSION,
    outbox_event_id: input.outboxEventId,
    organization_id: input.organizationId,
    event_type: input.eventType,
    event_schema_version: input.eventSchemaVersion,
    aggregate_type: input.aggregateType,
    aggregate_id: input.aggregateId,
    correlation_id: input.correlationId,
    ...(input.causationId === null ? {} : { causation_id: input.causationId }),
  };
  return Object.freeze(requirePrivateQueueEnvelopeV1(envelope));
};

export const privateQueueEnvelopesMatch = (
  left: PrivateQueueEnvelopeV1,
  right: PrivateQueueEnvelopeV1,
): boolean =>
  REQUIRED_KEYS.every((key) => left[key] === right[key]) &&
  left.causation_id === right.causation_id;
