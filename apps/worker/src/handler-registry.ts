import {
  createActiveEventRoutes,
  isKnownEventVersion,
  isRoutedEventType,
  queueForEvent,
  type ActiveEventRoute,
  type RoutedEventType,
} from "./event-routing.js";
import type { CanonicalDispatchEvent } from "./outbox-dispatcher.js";
import { QUEUE_NAMES, type QueueName } from "./queue-names.js";

const HANDLER_VERSION_PATTERN = /^v[1-9][0-9]{0,5}$/u;

export type WorkerAttemptMetadata = Readonly<{
  attemptNumber: number;
  jobId: string;
  retryLimit: number;
}>;

export type WorkerHandlerIdentity = Readonly<{
  handlerVersion: string;
  idempotencyKey: string;
  outboxEventId: string;
  providerIdempotencyKey: string;
}>;

export type WorkerTenantApplicationContext = Readonly<{
  organizationId: string;
}>;

export type WorkerHandlerContext = Readonly<{
  attempt: WorkerAttemptMetadata;
  canonicalEvent: CanonicalDispatchEvent;
  causationId: string | null;
  correlationId: string;
  identity: WorkerHandlerIdentity;
  organizationId: string;
  outboxEventId: string;
  signal: AbortSignal;
  tenant: WorkerTenantApplicationContext;
}>;

export type WorkerEventHandler = (context: WorkerHandlerContext) => Promise<void>;

export type WorkerReconciliationResult =
  | Readonly<{ state: "not_executed" }>
  | Readonly<{ state: "succeeded" }>
  | Readonly<{ state: "permanent_failure" }>
  | Readonly<{ state: "unresolved" }>;

export type WorkerEventReconciler = (
  context: WorkerHandlerContext,
) => Promise<WorkerReconciliationResult>;

export type WorkerHandlerRegistration = Readonly<{
  eventType: RoutedEventType;
  handler: WorkerEventHandler;
  handlerVersion: string;
  queue: QueueName;
  reconcile?: WorkerEventReconciler;
  schemaVersion: string;
}>;

export type WorkerHandlerRegistry = Readonly<{
  activeQueues: readonly QueueName[];
  activeRoutes: readonly ActiveEventRoute[];
  registrations: readonly WorkerHandlerRegistration[];
  resolve: (
    eventType: RoutedEventType,
    schemaVersion: string,
  ) => WorkerHandlerRegistration | undefined;
}>;

export class WorkerHandlerRegistryError extends Error {
  readonly code = "worker_handler_registry_invalid" as const;

  constructor() {
    super("Worker handler registry validation failed");
    this.name = "WorkerHandlerRegistryError";
  }
}

const requiredRegistrationKeys = Object.freeze([
  "eventType",
  "handler",
  "handlerVersion",
  "queue",
  "schemaVersion",
]);

const registrationIdentity = (eventType: string, schemaVersion: string): string =>
  `${eventType}\u0000${schemaVersion}`;

const isWorkerEventHandler = (value: unknown): value is WorkerEventHandler =>
  typeof value === "function";

const isWorkerEventReconciler = (value: unknown): value is WorkerEventReconciler =>
  typeof value === "function";

const requireRegistration = (candidate: unknown): WorkerHandlerRegistration => {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new WorkerHandlerRegistryError();
  }
  const keys = Object.keys(candidate).sort();
  const expectedKeys = Reflect.has(candidate, "reconcile")
    ? [...requiredRegistrationKeys, "reconcile"].sort()
    : requiredRegistrationKeys;
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new WorkerHandlerRegistryError();
  }

  const eventType: unknown = Reflect.get(candidate, "eventType");
  const schemaVersion: unknown = Reflect.get(candidate, "schemaVersion");
  const queue: unknown = Reflect.get(candidate, "queue");
  const handlerVersion: unknown = Reflect.get(candidate, "handlerVersion");
  const handler: unknown = Reflect.get(candidate, "handler");
  const reconcile: unknown = Reflect.get(candidate, "reconcile");
  if (
    !isRoutedEventType(eventType) ||
    !isKnownEventVersion(eventType, schemaVersion) ||
    typeof queue !== "string" ||
    !(QUEUE_NAMES as readonly string[]).includes(queue) ||
    queue !== queueForEvent(eventType) ||
    typeof handlerVersion !== "string" ||
    !HANDLER_VERSION_PATTERN.test(handlerVersion) ||
    !isWorkerEventHandler(handler) ||
    (reconcile !== undefined && !isWorkerEventReconciler(reconcile))
  ) {
    throw new WorkerHandlerRegistryError();
  }

  return Object.freeze({
    eventType,
    handler,
    handlerVersion,
    queue,
    ...(reconcile === undefined ? {} : { reconcile }),
    schemaVersion,
  });
};

export const createWorkerHandlerRegistry = (candidates: unknown): WorkerHandlerRegistry => {
  if (!Array.isArray(candidates) || candidates.length > 64) {
    throw new WorkerHandlerRegistryError();
  }

  const byIdentity = new Map<string, WorkerHandlerRegistration>();
  const values: readonly unknown[] = candidates;
  const registrations = values.map((candidate) => {
    const registration = requireRegistration(candidate);
    const identity = registrationIdentity(registration.eventType, registration.schemaVersion);
    if (byIdentity.has(identity)) throw new WorkerHandlerRegistryError();
    byIdentity.set(identity, registration);
    return registration;
  });
  const frozenRegistrations = Object.freeze(registrations);
  const activeRoutes = createActiveEventRoutes(
    frozenRegistrations.map(({ eventType, schemaVersion }) => ({ eventType, schemaVersion })),
  );
  const activeQueueSet = new Set(frozenRegistrations.map(({ queue }) => queue));
  const activeQueues = Object.freeze(QUEUE_NAMES.filter((queue) => activeQueueSet.has(queue)));

  return Object.freeze({
    activeQueues,
    activeRoutes,
    registrations: frozenRegistrations,
    resolve: (eventType: RoutedEventType, schemaVersion: string) =>
      byIdentity.get(registrationIdentity(eventType, schemaVersion)),
  });
};

export const PRODUCTION_HANDLER_REGISTRY = createWorkerHandlerRegistry([]);

export const createWorkerHandlerIdentity = (
  handlerVersion: string,
  outboxEventId: string,
): WorkerHandlerIdentity =>
  Object.freeze({
    handlerVersion,
    idempotencyKey: `${handlerVersion}:${outboxEventId}`,
    outboxEventId,
    providerIdempotencyKey: outboxEventId,
  });
