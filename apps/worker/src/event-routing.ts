import type { QueueName } from "./queue-names.js";

export const EVENT_QUEUE_OWNERSHIP = Object.freeze({
  "organization.created": "maintenance",
  "organization.status_changed": "maintenance",
  "membership.activated": "maintenance",
  "membership.scope_changed": "maintenance",
  "membership.revoked": "maintenance",
  "location.changed": "maintenance",
  "service.published": "maintenance",
  "service.deactivated": "maintenance",
  "service_price.published": "maintenance",
  "faq.published": "maintenance",
  "business_policy.published": "maintenance",
  "channel_connection.activated": "maintenance",
  "channel_connection.disabled": "maintenance",
  "channel_connection.credential_rotated": "maintenance",
  "contact.created": "maintenance",
  "contact.identity_added": "maintenance",
  "contact.anonymized": "maintenance",
  "consent.granted": "maintenance",
  "consent.declined": "maintenance",
  "consent.withdrawn": "maintenance",
  "consent.not_required_recorded": "maintenance",
  "message.received": "ai",
  "message.response_queued": "outbound_message",
  "notification.created": "staff_notification",
  "lead.created": "analytics",
  "lead.engaged": "analytics",
  "lead.qualified": "analytics",
  "lead.disqualified": "analytics",
  "lead.booking_requested": "analytics",
  "lead.converted": "analytics",
  "lead.closed": "analytics",
  "lead.reopened": "analytics",
  "conversation.started": "analytics",
  "message.sent": "analytics",
  "conversation.status_changed": "analytics",
  "conversation.automation_mode_changed": "analytics",
  "conversation.active_handoff_changed": "analytics",
  "conversation.resolved": "analytics",
  "conversation.closed": "analytics",
  "appointment_request.created": "analytics",
  "appointment_request.staff_accepted": "analytics",
  "appointment_request.customer_confirmation_requested": "analytics",
  "appointment_request.confirmed": "analytics",
  "appointment_request.rejected": "analytics",
  "appointment_request.cancelled": "analytics",
  "appointment_request.expired": "analytics",
  "appointment.attendance_recorded": "analytics",
  "appointment.attendance_corrected": "analytics",
  "appointment.revenue_attributed": "analytics",
  "appointment.revenue_reversed": "analytics",
  "handoff.requested": "analytics",
  "handoff.assigned": "analytics",
  "handoff.started": "analytics",
  "handoff.resolved": "analytics",
  "handoff.cancelled": "analytics",
  "handoff.expired": "analytics",
  "notification.delivered": "analytics",
  "notification.failed": "analytics",
  "notification.dead_lettered": "analytics",
  "ai_run.completed": "analytics",
  "ai_run.failed": "analytics",
  "ai_run.schema_rejected": "analytics",
  "ai_run.policy_denied": "analytics",
} as const satisfies Readonly<Record<string, QueueName>>);

export type RoutedEventType = keyof typeof EVENT_QUEUE_OWNERSHIP;

export type ActiveEventRoute = Readonly<{
  eventType: RoutedEventType;
  schemaVersion: string;
}>;

export class EventRoutingInvariantError extends Error {
  readonly code = "event_routing_invariant_failed" as const;

  constructor() {
    super("Event routing invariant failed");
    this.name = "EventRoutingInvariantError";
  }
}

export const isRoutedEventType = (value: unknown): value is RoutedEventType =>
  typeof value === "string" && Object.hasOwn(EVENT_QUEUE_OWNERSHIP, value);

export const isKnownEventVersion = (
  eventType: RoutedEventType,
  schemaVersion: unknown,
): schemaVersion is string =>
  schemaVersion === "1" ||
  ((eventType === "lead.reopened" || eventType === "contact.identity_added") &&
    schemaVersion === "2");

export const queueForEvent = (eventType: RoutedEventType): QueueName => {
  const queue: QueueName | undefined = EVENT_QUEUE_OWNERSHIP[eventType];
  if (queue === undefined) throw new EventRoutingInvariantError();
  return queue;
};

export const createActiveEventRoutes = (candidates: unknown): readonly ActiveEventRoute[] => {
  if (!Array.isArray(candidates) || candidates.length > 64) {
    throw new EventRoutingInvariantError();
  }

  const identities = new Set<string>();
  const candidateValues: readonly unknown[] = candidates;
  const routes = candidateValues.map((candidate): ActiveEventRoute => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      Object.keys(candidate).length !== 2 ||
      !Object.hasOwn(candidate, "eventType") ||
      !Object.hasOwn(candidate, "schemaVersion")
    ) {
      throw new EventRoutingInvariantError();
    }
    const eventType: unknown = Reflect.get(candidate, "eventType");
    const schemaVersion: unknown = Reflect.get(candidate, "schemaVersion");
    if (!isRoutedEventType(eventType) || !isKnownEventVersion(eventType, schemaVersion)) {
      throw new EventRoutingInvariantError();
    }
    const identity = `${eventType}\u0000${schemaVersion}`;
    if (identities.has(identity)) throw new EventRoutingInvariantError();
    identities.add(identity);
    return Object.freeze({
      eventType,
      schemaVersion,
    });
  });
  return Object.freeze(routes);
};
