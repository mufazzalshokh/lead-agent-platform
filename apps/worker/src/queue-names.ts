export const QUEUE_NAMES = Object.freeze([
  "inbound",
  "ai",
  "outbound_message",
  "staff_notification",
  "analytics",
  "maintenance",
] as const);

export type QueueName = (typeof QUEUE_NAMES)[number];
