import {
  DOMAIN_EVENT_NAMES,
  DomainEventSchemasByVersion,
} from "../../packages/contracts/src/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  EVENT_QUEUE_OWNERSHIP,
  createActiveEventRoutes,
  isRoutedEventType,
  queueForEvent,
  type ActiveEventRoute,
  type RoutedEventType,
} from "../../apps/worker/src/event-routing.js";
import { PRODUCTION_HANDLER_REGISTRY } from "../../apps/worker/src/handler-registry.js";
import {
  createOutboxDispatcher,
  type CanonicalDispatchEvent,
  type DispatchClaim,
  type DispatcherRelayPort,
} from "../../apps/worker/src/outbox-dispatcher.js";
import {
  PRIVATE_JOB_SCHEMA_VERSION,
  createPrivateQueueEnvelopeV1,
  requirePrivateQueueEnvelopeV1,
  type PrivateQueueEnvelopeV1,
} from "../../apps/worker/src/queue-envelope.js";
import type {
  ExistingQueueJob,
  QueueInfrastructure,
  QueueName,
} from "../../apps/worker/src/queue-infrastructure.js";

const ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-000000000001";
const OUTBOX_EVENT_ID = "0193f1a8-7f65-7c28-a434-000000000002";
const CORRELATION_ID = "0193f1a8-7f65-7c28-a434-000000000003";
const FIXED_NOW = new Date("2026-09-14T12:00:00.000Z");

const claimFor = (
  suffix: number,
  eventType: RoutedEventType = "organization.created",
): DispatchClaim => {
  const id = `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;
  return Object.freeze({
    aggregateId: eventType === "organization.created" ? ORGANIZATION_ID : id,
    aggregateType: eventType === "organization.created" ? "organization" : "conversation",
    attemptNumber: 1,
    causationId: null,
    correlationId: CORRELATION_ID,
    eventType,
    leaseToken: "123e4567-e89b-42d3-a456-426614174000",
    lockedUntil: new Date(FIXED_NOW.getTime() + 60_000),
    organizationId: ORGANIZATION_ID,
    outboxEventId: id,
    schemaVersion: "1",
  });
};

const canonicalFor = (claim: DispatchClaim): CanonicalDispatchEvent =>
  Object.freeze({
    aggregate_id: claim.aggregateId,
    aggregate_type: claim.aggregateType,
    causation_id: claim.causationId,
    correlation_id: claim.correlationId,
    event_id: claim.outboxEventId,
    event_type: claim.eventType,
    organization_id: claim.organizationId,
    schema_version: claim.schemaVersion,
  });

const envelopeFor = (claim: DispatchClaim): PrivateQueueEnvelopeV1 =>
  createPrivateQueueEnvelopeV1({
    aggregateId: claim.aggregateId,
    aggregateType: claim.aggregateType,
    causationId: claim.causationId,
    correlationId: claim.correlationId,
    eventSchemaVersion: claim.schemaVersion,
    eventType: (() => {
      if (!isRoutedEventType(claim.eventType)) throw new Error("Invalid test event type");
      return claim.eventType;
    })(),
    organizationId: claim.organizationId,
    outboxEventId: claim.outboxEventId,
  });

const createRelay = (claims: readonly DispatchClaim[]) => {
  const published: string[] = [];
  const deadLettered: string[] = [];
  const released: { at: Date; id: string }[] = [];
  let receivedRoutes: readonly ActiveEventRoute[] = [];
  const relay: DispatcherRelayPort = {
    claimBatch: (input) => {
      receivedRoutes = input.activeRoutes;
      return Promise.resolve(claims);
    },
    markDeadLettered: (input) => {
      deadLettered.push(input.outboxEventId);
      return Promise.resolve(true);
    },
    markPublished: (input) => {
      published.push(input.outboxEventId);
      return Promise.resolve("published");
    },
    releaseForRetry: (input) => {
      released.push({ at: input.availableAt, id: input.outboxEventId });
      return Promise.resolve(true);
    },
  };
  return { deadLettered, published, receivedRoutes: () => receivedRoutes, relay, released };
};

const createMemoryQueue = () => {
  const jobs = new Map<string, ExistingQueueJob>();
  const queue: Pick<QueueInfrastructure, "enqueueDurably" | "inspectExistingJobForReconciliation"> =
    {
      enqueueDurably: (queueName, jobId, envelope) => {
        if (jobs.has(jobId)) return Promise.resolve(null);
        jobs.set(jobId, Object.freeze({ data: envelope, id: jobId, queue: queueName }));
        return Promise.resolve(jobId);
      },
      inspectExistingJobForReconciliation: (jobId) => {
        const existing = jobs.get(jobId);
        return Promise.resolve(Object.freeze(existing === undefined ? [] : [existing]));
      },
    };
  return { jobs, queue };
};

describe("S8.3 finite routing and private queue envelope", () => {
  it("owns all 63 semantic events exactly once with the frozen queue counts", () => {
    expect(Object.keys(EVENT_QUEUE_OWNERSHIP).sort()).toEqual([...DOMAIN_EVENT_NAMES].sort());
    expect(Object.keys(EVENT_QUEUE_OWNERSHIP)).toHaveLength(63);
    const counts = Object.values(EVENT_QUEUE_OWNERSHIP).reduce<Record<QueueName, number>>(
      (result, queue) => ({ ...result, [queue]: result[queue] + 1 }),
      {
        ai: 0,
        analytics: 0,
        inbound: 0,
        maintenance: 0,
        outbound_message: 0,
        staff_notification: 0,
      },
    );
    expect(counts).toEqual({
      ai: 1,
      analytics: 39,
      inbound: 0,
      maintenance: 21,
      outbound_message: 1,
      staff_notification: 1,
    });
    expect(
      Object.values(DomainEventSchemasByVersion).reduce(
        (count, versions) => count + Object.keys(versions).length,
        0,
      ),
    ).toBe(64);
  });

  it("preserves explicit effect intent and never maps a canonical event to inbound", () => {
    expect(queueForEvent("message.received")).toBe("ai");
    expect(queueForEvent("message.response_queued")).toBe("outbound_message");
    expect(queueForEvent("notification.created")).toBe("staff_notification");
    expect(queueForEvent("appointment_request.customer_confirmation_requested")).toBe("analytics");
    expect(queueForEvent("handoff.requested")).toBe("analytics");
    expect(Object.values(EVENT_QUEUE_OWNERSHIP)).not.toContain("inbound");
  });

  it("keeps production activation empty and versions independently activated", () => {
    expect(PRODUCTION_HANDLER_REGISTRY.activeRoutes).toEqual([]);
    expect(
      createActiveEventRoutes([
        { eventType: "lead.reopened", schemaVersion: "1" },
        { eventType: "lead.reopened", schemaVersion: "2" },
      ]),
    ).toEqual([
      { eventType: "lead.reopened", schemaVersion: "1" },
      { eventType: "lead.reopened", schemaVersion: "2" },
    ]);
    expect(() =>
      createActiveEventRoutes([{ eventType: "lead.reopened", schemaVersion: "3" }]),
    ).toThrowError("Event routing invariant failed");
    expect(() =>
      createActiveEventRoutes([
        { eventType: "message.received", schemaVersion: "1" },
        { eventType: "message.received", schemaVersion: "1" },
      ]),
    ).toThrowError("Event routing invariant failed");
  });

  it("validates the exact private V1 identifier-only shape and rejects future versions", () => {
    const envelope = envelopeFor(claimFor(2));
    expect(Object.keys(envelope)).toEqual([
      "job_schema_version",
      "outbox_event_id",
      "organization_id",
      "event_type",
      "event_schema_version",
      "aggregate_type",
      "aggregate_id",
      "correlation_id",
    ]);
    expect(envelope.job_schema_version).toBe(PRIVATE_JOB_SCHEMA_VERSION);
    expect(envelope).not.toHaveProperty("payload");
    expect(envelope).not.toHaveProperty("lease_token");
    expect(envelope).not.toHaveProperty("queue");
    expect(envelope).not.toHaveProperty("handler");
    expect(() =>
      requirePrivateQueueEnvelopeV1({ ...envelope, job_schema_version: "2" }),
    ).toThrowError("Private queue envelope validation failed");
    expect(() =>
      requirePrivateQueueEnvelopeV1({ ...envelope, customer_text: "forbidden" }),
    ).toThrowError("Private queue envelope validation failed");
  });
});

describe("S8.3 bounded outbox dispatcher", () => {
  it("passes an empty active set to claim and performs no downstream work", async () => {
    const relay = createRelay([]);
    const queue = createMemoryQueue();
    const loadCanonicalEvent = vi.fn();
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-empty",
      queue: queue.queue,
      relay: relay.relay,
      tenantEvents: { loadCanonicalEvent },
    });
    await expect(
      dispatcher.dispatchOnce(PRODUCTION_HANDLER_REGISTRY.activeRoutes),
    ).resolves.toEqual({
      claimed: 0,
      deadLettered: 0,
      deferred: 0,
      enqueued: 0,
      published: 0,
      reconciled: 0,
      retryReleased: 0,
    });
    expect(relay.receivedRoutes()).toEqual([]);
    expect(loadCanonicalEvent).not.toHaveBeenCalled();
    expect(queue.jobs.size).toBe(0);
  });

  it("reloads canonical provenance, durably enqueues, then marks published", async () => {
    const claim = claimFor(10);
    const relay = createRelay([claim]);
    const queue = createMemoryQueue();
    const loadCanonicalEvent = vi.fn(() => Promise.resolve(canonicalFor(claim)));
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-happy",
      queue: queue.queue,
      relay: relay.relay,
      tenantEvents: { loadCanonicalEvent },
    });

    await expect(
      dispatcher.dispatchOnce(
        createActiveEventRoutes([{ eventType: "organization.created", schemaVersion: "1" }]),
      ),
    ).resolves.toMatchObject({ claimed: 1, enqueued: 1, published: 1 });
    expect(loadCanonicalEvent).toHaveBeenCalledWith(claim.organizationId, claim.outboxEventId);
    expect(relay.published).toEqual([claim.outboxEventId]);
    expect(queue.jobs.get(claim.outboxEventId)?.data).toEqual(envelopeFor(claim));
  });

  it("reconciles an exact durable job after the enqueue-to-marker crash window", async () => {
    const claim = claimFor(11);
    const relay = createRelay([claim]);
    const queue = createMemoryQueue();
    queue.jobs.set(
      claim.outboxEventId,
      Object.freeze({
        data: envelopeFor(claim),
        id: claim.outboxEventId,
        queue: "maintenance",
      }),
    );
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-reconcile",
      queue: queue.queue,
      relay: relay.relay,
      tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalFor(claim)) },
    });

    await expect(
      dispatcher.dispatchOnce(
        createActiveEventRoutes([{ eventType: "organization.created", schemaVersion: "1" }]),
      ),
    ).resolves.toMatchObject({ claimed: 1, published: 1, reconciled: 1 });
    expect(queue.jobs.size).toBe(1);
  });

  it("dead-letters a deterministic job collision without overwriting it", async () => {
    const claim = claimFor(12);
    const relay = createRelay([claim]);
    const queue = createMemoryQueue();
    queue.jobs.set(
      claim.outboxEventId,
      Object.freeze({
        data: { ...envelopeFor(claim), organization_id: OUTBOX_EVENT_ID },
        id: claim.outboxEventId,
        queue: "maintenance",
      }),
    );
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-collision",
      queue: queue.queue,
      relay: relay.relay,
      tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalFor(claim)) },
    });

    await expect(
      dispatcher.dispatchOnce(
        createActiveEventRoutes([{ eventType: "organization.created", schemaVersion: "1" }]),
      ),
    ).resolves.toMatchObject({ claimed: 1, deadLettered: 1, published: 0 });
    expect(relay.deadLettered).toEqual([claim.outboxEventId]);
    expect(relay.published).toEqual([]);
  });

  it("rejects claim provenance mismatches as permanent before enqueue", async () => {
    const claim = claimFor(13);
    const relay = createRelay([claim]);
    const queue = createMemoryQueue();
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-provenance",
      queue: queue.queue,
      relay: relay.relay,
      tenantEvents: {
        loadCanonicalEvent: () =>
          Promise.resolve({ ...canonicalFor(claim), organization_id: OUTBOX_EVENT_ID }),
      },
    });
    await dispatcher.dispatchOnce(
      createActiveEventRoutes([{ eventType: "organization.created", schemaVersion: "1" }]),
    );
    expect(relay.deadLettered).toEqual([claim.outboxEventId]);
    expect(queue.jobs.size).toBe(0);
  });

  it("releases a pre-enqueue transient failure at the frozen five-second delay", async () => {
    const claim = claimFor(14);
    const relay = createRelay([claim]);
    const queue = createMemoryQueue();
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-transient",
      queue: queue.queue,
      relay: relay.relay,
      tenantEvents: { loadCanonicalEvent: () => Promise.reject(new Error("synthetic")) },
    });
    await dispatcher.dispatchOnce(
      createActiveEventRoutes([{ eventType: "organization.created", schemaVersion: "1" }]),
    );
    expect(relay.released).toEqual([
      { at: new Date(FIXED_NOW.getTime() + 5_000), id: claim.outboxEventId },
    ]);
    expect(queue.jobs.size).toBe(0);
  });

  it("leaves the lease for reconciliation when enqueue outcome is uncertain", async () => {
    const claim = claimFor(15);
    const relay = createRelay([claim]);
    const memoryQueue = createMemoryQueue();
    const queue = {
      ...memoryQueue.queue,
      enqueueDurably: () => Promise.reject(new Error("synthetic")),
    };
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-uncertain",
      queue,
      relay: relay.relay,
      tenantEvents: { loadCanonicalEvent: () => Promise.resolve(canonicalFor(claim)) },
    });
    await expect(
      dispatcher.dispatchOnce(
        createActiveEventRoutes([{ eventType: "organization.created", schemaVersion: "1" }]),
      ),
    ).resolves.toMatchObject({ claimed: 1, deferred: 1, retryReleased: 0 });
    expect(relay.released).toEqual([]);
    expect(relay.deadLettered).toEqual([]);
  });

  it("never exceeds ten concurrent enqueue operations", async () => {
    const claims = Array.from({ length: 12 }, (_, index) => claimFor(0x100 + index));
    const relay = createRelay(claims);
    const jobs = new Map<string, ExistingQueueJob>();
    let active = 0;
    let maximum = 0;
    const queue: Pick<
      QueueInfrastructure,
      "enqueueDurably" | "inspectExistingJobForReconciliation"
    > = {
      enqueueDurably: async (queueName, jobId, envelope) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        jobs.set(jobId, Object.freeze({ data: envelope, id: jobId, queue: queueName }));
        active -= 1;
        return jobId;
      },
      inspectExistingJobForReconciliation: (jobId) => {
        const existing = jobs.get(jobId);
        return Promise.resolve(Object.freeze(existing === undefined ? [] : [existing]));
      },
    };
    const dispatcher = createOutboxDispatcher({
      clock: { now: () => FIXED_NOW },
      dispatcherId: "dispatcher.s83-bounded",
      queue,
      relay: relay.relay,
      tenantEvents: {
        loadCanonicalEvent: (_organizationId, eventId) => {
          const claim = claims.find(({ outboxEventId }) => outboxEventId === eventId);
          if (claim === undefined) return Promise.reject(new Error("missing fixture"));
          return Promise.resolve(canonicalFor(claim));
        },
      },
    });

    await expect(
      dispatcher.dispatchOnce(
        createActiveEventRoutes([{ eventType: "organization.created", schemaVersion: "1" }]),
      ),
    ).resolves.toMatchObject({ claimed: 12, enqueued: 12, published: 12 });
    expect(maximum).toBeLessThanOrEqual(10);
    expect(maximum).toBeGreaterThan(1);
  });
});
