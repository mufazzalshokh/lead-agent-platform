import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";

import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createQueueDatabaseRuntimeConfig,
  createTenantDatabaseRuntimeConfig,
} from "../../packages/config/src/index.js";
import {
  createOutboxDispatcherId,
  createOutboxRelayDatabaseRuntime,
  createTenantCanonicalOutboxEventSource,
  createTenantDatabaseRuntime,
  migrationsFolder,
  runMigrations,
  type OutboxRelayClaim,
  type OutboxRelayDatabaseRuntime,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import { createActiveEventRoutes } from "../../apps/worker/src/event-routing.js";
import {
  createWorkerHandlerRegistry,
  type WorkerHandlerContext,
} from "../../apps/worker/src/handler-registry.js";
import {
  createOutboxDispatcher,
  type DispatchClaim,
  type DispatcherRelayPort,
  type OutboxDispatcher,
} from "../../apps/worker/src/outbox-dispatcher.js";
import {
  createPrivateQueueEnvelopeV1,
  type PrivateQueueEnvelopeV1,
} from "../../apps/worker/src/queue-envelope.js";
import {
  createQueueInfrastructure,
  type QueueInfrastructure,
} from "../../apps/worker/src/queue-infrastructure.js";
import { createWorkerRuntime, type WorkerRuntime } from "../../apps/worker/src/worker-runtime.js";

const QUEUE_RUNTIME_ROLE = "lead_agent_queue_runtime";
const TENANT_RUNTIME_ROLE = "lead_agent_runtime";
const BUSINESS_TABLE_COUNT = 52;
const ORGANIZATION_A = "0193f1a8-7f65-7c28-a434-000000000001";
const ORGANIZATION_B = "0193f1a8-7f65-7c28-a434-000000000002";
const ACTIVE_ORGANIZATION_CREATED = createActiveEventRoutes([
  { eventType: "organization.created", schemaVersion: "1" },
]);

const syntheticUuid = (suffix: number): string =>
  `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;

let container: StartedPostgreSqlContainer | undefined;
let ownerPool: Pool | undefined;
let ownerConnectionString: string | undefined;
let relayRuntime: OutboxRelayDatabaseRuntime | undefined;
let tenantRuntime: TenantDatabaseRuntime | undefined;
let queueInfrastructure: QueueInfrastructure | undefined;
let queueConnectionString: string | undefined;
let serverVersion = "";

const database = (): Pool => {
  if (ownerPool === undefined) throw new Error("S8.3 owner pool is not initialized");
  return ownerPool;
};

const relay = (): OutboxRelayDatabaseRuntime => {
  if (relayRuntime === undefined) throw new Error("S8.3 relay runtime is not initialized");
  return relayRuntime;
};

const tenant = (): TenantDatabaseRuntime => {
  if (tenantRuntime === undefined) throw new Error("S8.3 tenant runtime is not initialized");
  return tenantRuntime;
};

const queue = (): QueueInfrastructure => {
  if (queueInfrastructure === undefined) throw new Error("S8.3 queue runtime is not initialized");
  return queueInfrastructure;
};

const requireTestDatabaseUrl = (): string | undefined => {
  const value = process.env["TEST_DATABASE_URL"];
  if (value === undefined) return undefined;
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !/(^|[_-])test([_-]|$)/iu.test(databaseName)
  ) {
    throw new Error("TEST_DATABASE_URL must identify an explicitly named PostgreSQL test database");
  }
  return value;
};

const requireEmptyExternalTestDatabase = async (testPool: Pool): Promise<void> => {
  const tables = await testPool.query<{ count: number }>(
    `select count(*)::integer as count
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('information_schema', 'pg_catalog')`,
  );
  if (tables.rows[0]?.count !== 0) {
    throw new Error("TEST_DATABASE_URL must point to a fresh, empty disposable test database");
  }
};

const configureDisposableRolePassword = async (
  testPool: Pool,
  role: string,
  password: string,
): Promise<void> => {
  const result = await testPool.query<{ statement: string }>(
    "select pg_catalog.format('alter role %I password %L', $1::text, $2::text) as statement",
    [role, password],
  );
  const statement = result.rows[0]?.statement;
  if (statement === undefined) throw new Error("Unable to configure disposable runtime role");
  await testPool.query(statement);
};

const connectionStringForRole = (role: string, password: string): string => {
  if (ownerConnectionString === undefined) throw new Error("Owner connection is not initialized");
  const url = new URL(ownerConnectionString);
  url.username = role;
  url.password = password;
  return url.toString();
};

const insertOrganization = async (id: string, slug: string): Promise<void> => {
  await database().query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values ($1::uuid, $2::varchar, $3::varchar, 'active', 'en', 'Asia/Tashkent')`,
    [id, slug, `S8.3 ${slug}`],
  );
};

const organizationCreatedEnvelope = (input: {
  aggregateVersion: number;
  eventId: string;
  organizationId: string;
}): Record<string, unknown> => ({
  actor: { actor_id: null, actor_type: "system" },
  aggregate_id: input.organizationId,
  aggregate_type: "organization",
  aggregate_version: input.aggregateVersion,
  causation_id: null,
  correlation_id: input.eventId,
  event_id: input.eventId,
  event_type: "organization.created",
  occurred_at: "2026-09-14T10:00:00.000Z",
  organization_id: input.organizationId,
  payload: { default_locale: "en", organization_status: "active" },
  request_id: null,
  schema_id: "OrganizationCreatedDomainEvent.v1",
  schema_version: "1",
});

const insertOrganizationCreatedOutbox = async (input: {
  aggregateVersion: number;
  eventId: string;
  malformedPayload?: boolean;
  organizationId: string;
  payloadOrganizationId?: string;
}): Promise<void> => {
  const envelope = organizationCreatedEnvelope({
    aggregateVersion: input.aggregateVersion,
    eventId: input.eventId,
    organizationId: input.payloadOrganizationId ?? input.organizationId,
  });
  await database().query(
    `insert into outbox_events
      (id, organization_id, event_type, schema_version, aggregate_type,
       aggregate_id, aggregate_version, payload_jsonb, correlation_id,
       causation_id, occurred_at, status, attempt_count, available_at)
     values ($1::uuid, $2::uuid, 'organization.created', '1', 'organization',
       $2::uuid, $3::bigint, $4::jsonb, $1::uuid, null,
       '2026-09-14T10:00:00.000Z'::timestamptz, 'pending', 0,
       '2026-09-14T10:00:00.000Z'::timestamptz)`,
    [
      input.eventId,
      input.organizationId,
      input.aggregateVersion,
      JSON.stringify(input.malformedPayload === true ? { malformed: true } : envelope),
    ],
  );
};

const requireClaim = (
  claims: Map<string, OutboxRelayClaim>,
  input: { leaseToken: string; organizationId: string; outboxEventId: string },
): OutboxRelayClaim => {
  const claim = claims.get(input.outboxEventId);
  if (
    claim === undefined ||
    claim.organizationId !== input.organizationId ||
    claim.leaseToken !== input.leaseToken
  ) {
    throw new Error("S8.3 test relay received an unknown claim identity");
  }
  return claim;
};

const createRelayPort = (
  dispatcherId: string,
  publicationOverride?: (claim: OutboxRelayClaim) => Promise<"lease_lost" | "published">,
): DispatcherRelayPort => {
  const claims = new Map<string, OutboxRelayClaim>();
  return {
    claimBatch: async (input): Promise<readonly DispatchClaim[]> => {
      const claimed = await relay().claimBatch({
        activeRoutes: input.activeRoutes,
        batchSize: input.batchSize,
        dispatcherId: createOutboxDispatcherId(dispatcherId),
        leaseSeconds: input.leaseSeconds,
      });
      for (const claim of claimed) claims.set(claim.outboxEventId, claim);
      return claimed;
    },
    markDeadLettered: (input) =>
      relay().markDeadLettered({
        ...requireClaim(claims, input),
        errorCategory: input.errorCategory,
      }),
    markPublished: (input) => {
      const claim = requireClaim(claims, input);
      return publicationOverride === undefined
        ? relay().markPublished(claim)
        : publicationOverride(claim);
    },
    releaseForRetry: (input) =>
      relay().releaseForRetry({
        ...requireClaim(claims, input),
        availableAt: input.availableAt,
        errorCategory: input.errorCategory,
      }),
  };
};

const createRealDispatcher = (
  dispatcherId: string,
  publicationOverride?: (claim: OutboxRelayClaim) => Promise<"lease_lost" | "published">,
) =>
  createOutboxDispatcher({
    clock: { now: () => new Date() },
    dispatcherId,
    queue: queue(),
    relay: createRelayPort(dispatcherId, publicationOverride),
    tenantEvents: createTenantCanonicalOutboxEventSource(tenant()),
  });

const outboxState = async (eventId: string) => {
  const result = await database().query<{
    attempt_count: number;
    lease_token: string | null;
    status: string;
  }>("select status, attempt_count, lease_token from outbox_events where id = $1::uuid", [eventId]);
  return result.rows[0];
};

const persistedJobs = async () =>
  (
    await database().query<{ data: unknown; id: string; name: string }>(
      "select id, name, data from pgboss.job order by name, id",
    )
  ).rows;

const jobState = async (eventId: string): Promise<string | undefined> => {
  const result = await database().query<{ state: string }>(
    "select state::text from pgboss.job where id = $1::uuid",
    [eventId],
  );
  return result.rows[0]?.state;
};

const idleDispatcher: OutboxDispatcher = Object.freeze({
  dispatchOnce: () =>
    Promise.resolve({
      claimed: 0,
      deadLettered: 0,
      deferred: 0,
      enqueued: 0,
      published: 0,
      reconciled: 0,
      retryReleased: 0,
    }),
});

const waitFor = async (condition: () => Promise<boolean>, timeoutMilliseconds = 15_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for S8.4 worker integration state");
};

beforeAll(async () => {
  const externalUrl = requireTestDatabaseUrl();
  if (externalUrl === undefined) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    container = await new PostgreSqlContainer("postgres:17")
      .withDatabase("lead_agent_s83_test")
      .withUsername("lead_agent_s83_owner")
      .withPassword("s83-local-test-only-owner-password")
      .start();
    ownerConnectionString = container.getConnectionUri();
  } else {
    ownerConnectionString = externalUrl;
  }
  ownerPool = new Pool({ connectionString: ownerConnectionString, max: 12 });
  if (externalUrl !== undefined) await requireEmptyExternalTestDatabase(ownerPool);

  const version = await ownerPool.query<{ server_version: string; server_version_num: string }>(
    "select current_setting('server_version') as server_version, current_setting('server_version_num') as server_version_num",
  );
  const versionNumber = Number(version.rows[0]?.server_version_num);
  if (versionNumber < 170_000 || versionNumber >= 180_000) {
    throw new Error("S8.3 integration tests require PostgreSQL major version 17");
  }
  serverVersion = version.rows[0]?.server_version ?? "";

  const journal: unknown = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  const entries: unknown =
    typeof journal === "object" && journal !== null ? Reflect.get(journal, "entries") : undefined;
  const s8ActiveRouteEntry: unknown = Array.isArray(entries) ? entries[23] : undefined;
  if (
    typeof journal !== "object" ||
    journal === null ||
    !Array.isArray(entries) ||
    typeof s8ActiveRouteEntry !== "object" ||
    s8ActiveRouteEntry === null ||
    Reflect.get(s8ActiveRouteEntry, "tag") !== "0023_s8_active_route_claim"
  ) {
    throw new Error("S8.3 migration journal is invalid");
  }

  await runMigrations(ownerPool);
  await runMigrations(ownerPool);

  const queuePassword = "s83-local-test-only-queue-password";
  const tenantPassword = "s83-local-test-only-tenant-password";
  await configureDisposableRolePassword(ownerPool, QUEUE_RUNTIME_ROLE, queuePassword);
  await configureDisposableRolePassword(ownerPool, TENANT_RUNTIME_ROLE, tenantPassword);
  queueConnectionString = connectionStringForRole(QUEUE_RUNTIME_ROLE, queuePassword);
  const tenantConnectionString = connectionStringForRole(TENANT_RUNTIME_ROLE, tenantPassword);
  relayRuntime = createOutboxRelayDatabaseRuntime(
    createQueueDatabaseRuntimeConfig({
      connectionString: queueConnectionString,
      maxConnections: 6,
    }),
    { onUnexpectedPoolError: () => undefined },
  );
  tenantRuntime = createTenantDatabaseRuntime(
    createTenantDatabaseRuntimeConfig({
      connectionString: tenantConnectionString,
      maxConnections: 12,
      statementTimeoutMilliseconds: 30_000,
    }),
    { onUnexpectedPoolError: () => undefined },
  );
  queueInfrastructure = createQueueInfrastructure(
    createQueueDatabaseRuntimeConfig({
      connectionString: queueConnectionString,
      maxConnections: 6,
    }),
    { random: () => 0 },
  );
  await queueInfrastructure.start();
}, 180_000);

beforeEach(async () => {
  await database().query("delete from pgboss.job");
  await database().query("truncate table outbox_events, organizations cascade");
  await insertOrganization(ORGANIZATION_A, "s83-tenant-a");
  await insertOrganization(ORGANIZATION_B, "s83-tenant-b");
});

afterAll(async () => {
  await queueInfrastructure?.stop();
  await tenantRuntime?.close();
  await relayRuntime?.close();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

describe("S8.3 PostgreSQL 17 dispatcher and pg-boss integration", { timeout: 30_000 }, () => {
  it("bootstraps current head twice with the approved 52-table business manifest", async () => {
    expect(serverVersion).toMatch(/^17\.11(?:\.|\s|$)/u);
    const tables = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(tables.rows).toEqual([{ count: BUSINESS_TABLE_COUNT }]);
    const migrations = await database().query<{ count: number }>(
      "select count(*)::integer as count from drizzle.__drizzle_migrations",
    );
    expect(migrations.rows).toEqual([{ count: 30 }]);
  });

  it("observes pg-boss 12.31.0 returning null for an exact duplicate queue and ID", async () => {
    const claim: DispatchClaim = {
      ...organizationCreatedEnvelope({
        aggregateVersion: 1,
        eventId: syntheticUuid(0x200),
        organizationId: ORGANIZATION_A,
      }),
      aggregateId: ORGANIZATION_A,
      aggregateType: "organization",
      attemptNumber: 1,
      causationId: null,
      correlationId: syntheticUuid(0x200),
      eventType: "organization.created",
      leaseToken: "123e4567-e89b-42d3-a456-426614174000",
      lockedUntil: new Date(),
      organizationId: ORGANIZATION_A,
      outboxEventId: syntheticUuid(0x200),
      schemaVersion: "1",
    };
    const envelope = createPrivateQueueEnvelopeV1({
      aggregateId: claim.aggregateId,
      aggregateType: claim.aggregateType,
      causationId: claim.causationId,
      correlationId: claim.correlationId,
      eventSchemaVersion: claim.schemaVersion,
      eventType: "organization.created",
      organizationId: claim.organizationId,
      outboxEventId: claim.outboxEventId,
    });
    expect(await queue().enqueueDurably("maintenance", claim.outboxEventId, envelope)).toBe(
      claim.outboxEventId,
    );
    expect(await queue().enqueueDurably("maintenance", claim.outboxEventId, envelope)).toBeNull();
    expect(await persistedJobs()).toHaveLength(1);
  });

  it("reloads under tenant RLS, persists identifiers only, then publishes", async () => {
    const eventId = syntheticUuid(0x201);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId,
      organizationId: ORGANIZATION_A,
    });
    const result = await createRealDispatcher("dispatcher.s83-real").dispatchOnce(
      ACTIVE_ORGANIZATION_CREATED,
    );
    expect(result).toMatchObject({ claimed: 1, enqueued: 1, published: 1 });
    expect(await outboxState(eventId)).toMatchObject({ attempt_count: 1, status: "published" });
    const jobs = await persistedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: eventId, name: "maintenance" });
    const envelope = jobs[0]?.data;
    expect(envelope).toEqual(
      createPrivateQueueEnvelopeV1({
        aggregateId: ORGANIZATION_A,
        aggregateType: "organization",
        causationId: null,
        correlationId: eventId,
        eventSchemaVersion: "1",
        eventType: "organization.created",
        organizationId: ORGANIZATION_A,
        outboxEventId: eventId,
      }),
    );
    expect(JSON.stringify(envelope)).not.toMatch(
      /payload|lease|customer|message|prompt|token|password|database_url/iu,
    );
  });

  it("recovers the enqueue-to-marker crash window by exact reconciliation", async () => {
    const eventId = syntheticUuid(0x202);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId,
      organizationId: ORGANIZATION_A,
    });
    const first = createRealDispatcher("dispatcher.s83-crash-a", () =>
      Promise.reject(new Error("synthetic marker outage")),
    );
    expect(await first.dispatchOnce(ACTIVE_ORGANIZATION_CREATED)).toMatchObject({
      claimed: 1,
      deferred: 1,
      published: 0,
    });
    expect(await persistedJobs()).toHaveLength(1);
    expect(await outboxState(eventId)).toMatchObject({ attempt_count: 1, status: "processing" });
    await database().query("update outbox_events set locked_until = available_at where id = $1", [
      eventId,
    ]);

    const second = createRealDispatcher("dispatcher.s83-crash-b");
    expect(await second.dispatchOnce(ACTIVE_ORGANIZATION_CREATED)).toMatchObject({
      claimed: 1,
      published: 1,
      reconciled: 1,
    });
    expect(await outboxState(eventId)).toMatchObject({ attempt_count: 2, status: "published" });
    expect(await persistedJobs()).toHaveLength(1);
  });

  it("fails closed and dead-letters a mismatched deterministic job collision", async () => {
    const eventId = syntheticUuid(0x203);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId,
      organizationId: ORGANIZATION_A,
    });
    const mismatched: PrivateQueueEnvelopeV1 = createPrivateQueueEnvelopeV1({
      aggregateId: ORGANIZATION_B,
      aggregateType: "organization",
      causationId: null,
      correlationId: eventId,
      eventSchemaVersion: "1",
      eventType: "organization.created",
      organizationId: ORGANIZATION_B,
      outboxEventId: eventId,
    });
    await queue().enqueueDurably("maintenance", eventId, mismatched);

    expect(
      await createRealDispatcher("dispatcher.s83-collision").dispatchOnce(
        ACTIVE_ORGANIZATION_CREATED,
      ),
    ).toMatchObject({
      claimed: 1,
      deadLettered: 1,
      published: 0,
    });
    expect(await outboxState(eventId)).toMatchObject({ attempt_count: 1, status: "dead_lettered" });
    expect(await persistedJobs()).toEqual([
      expect.objectContaining({ data: mismatched, id: eventId, name: "maintenance" }),
    ]);
  });

  it("quarantines malformed and tenant-mismatched canonical payloads per item", async () => {
    const malformedId = syntheticUuid(0x204);
    const mismatchId = syntheticUuid(0x205);
    const validId = syntheticUuid(0x206);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId: malformedId,
      malformedPayload: true,
      organizationId: ORGANIZATION_A,
    });
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 2,
      eventId: mismatchId,
      organizationId: ORGANIZATION_A,
      payloadOrganizationId: ORGANIZATION_B,
    });
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 3,
      eventId: validId,
      organizationId: ORGANIZATION_A,
    });

    expect(
      await createRealDispatcher("dispatcher.s83-poison").dispatchOnce(ACTIVE_ORGANIZATION_CREATED),
    ).toMatchObject({
      claimed: 3,
      deadLettered: 2,
      enqueued: 1,
      published: 1,
    });
    expect(await outboxState(malformedId)).toMatchObject({ status: "dead_lettered" });
    expect(await outboxState(mismatchId)).toMatchObject({ status: "dead_lettered" });
    expect(await outboxState(validId)).toMatchObject({ status: "published" });
    expect((await persistedJobs()).map(({ id }) => id)).toEqual([validId]);
  });

  it("lets two dispatchers claim disjoint work and create one job per event", async () => {
    const eventIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const eventId = syntheticUuid(0x220 + index);
      eventIds.push(eventId);
      await insertOrganizationCreatedOutbox({
        aggregateVersion: index + 1,
        eventId,
        organizationId: ORGANIZATION_A,
      });
    }

    const [first, second] = await Promise.all([
      createRealDispatcher("dispatcher.s83-concurrent-a").dispatchOnce(ACTIVE_ORGANIZATION_CREATED),
      createRealDispatcher("dispatcher.s83-concurrent-b").dispatchOnce(ACTIVE_ORGANIZATION_CREATED),
    ]);
    expect(first.claimed + second.claimed).toBe(10);
    expect(first.published + second.published).toBe(10);
    const jobs = await persistedJobs();
    expect(jobs).toHaveLength(10);
    expect(new Set(jobs.map(({ id }) => id))).toEqual(new Set(eventIds));
    const published = await database().query<{ count: number }>(
      "select count(*)::integer as count from outbox_events where status = 'published'",
    );
    expect(published.rows).toEqual([{ count: 10 }]);
  });

  it("keeps inactive pending work entirely untouched in the production-empty state", async () => {
    const eventId = syntheticUuid(0x230);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId,
      organizationId: ORGANIZATION_A,
    });
    expect(await createRealDispatcher("dispatcher.s83-inactive").dispatchOnce([])).toMatchObject({
      claimed: 0,
    });
    expect(await outboxState(eventId)).toEqual({
      attempt_count: 0,
      lease_token: null,
      status: "pending",
    });
    expect(await persistedJobs()).toEqual([]);
  });
});

describe("S8.4 PostgreSQL 17 worker lifecycle and finite registry", { timeout: 30_000 }, () => {
  it("dispatches, validates, tenant-reloads, and invokes the exact registered handler", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is not initialized");
    const eventId = syntheticUuid(0x240);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId,
      organizationId: ORGANIZATION_A,
    });

    const contexts: WorkerHandlerContext[] = [];
    const registry = createWorkerHandlerRegistry([
      {
        eventType: "organization.created",
        handler: (context: WorkerHandlerContext) => {
          contexts.push(context);
          return Promise.resolve();
        },
        handlerVersion: "v1",
        queue: "maintenance",
        schemaVersion: "1",
      },
    ]);
    const workerQueue = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({
        connectionString: queueConnectionString,
        maxConnections: 6,
      }),
    );
    const tenantEvents = createTenantCanonicalOutboxEventSource(tenant());
    let runtime: WorkerRuntime | undefined;
    try {
      runtime = createWorkerRuntime({
        dispatcher: createOutboxDispatcher({
          clock: { now: () => new Date() },
          dispatcherId: "dispatcher.s84-real",
          queue: workerQueue,
          relay: createRelayPort("dispatcher.s84-real"),
          tenantEvents,
        }),
        observability: { onDispatcherError: (error) => void error },
        queue: workerQueue,
        registry,
        tenantEvents,
        tenantRuntime: tenant(),
      });
      await runtime.start();
      await waitFor(() => Promise.resolve(contexts.length === 1));
      await waitFor(async () => {
        return (await jobState(eventId)) === "completed";
      });

      expect(serverVersion).toMatch(/^17\.11(?:\.|\s|$)/u);
      expect(await outboxState(eventId)).toMatchObject({ attempt_count: 1, status: "published" });
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({
        canonicalEvent: {
          event_id: eventId,
          event_type: "organization.created",
          organization_id: ORGANIZATION_A,
          schema_version: "1",
        },
        identity: {
          handlerVersion: "v1",
          idempotencyKey: `v1:${eventId}`,
          outboxEventId: eventId,
        },
        organizationId: ORGANIZATION_A,
        tenant: { organizationId: ORGANIZATION_A },
      });
      expect(contexts[0]).not.toHaveProperty("database");
      expect(contexts[0]).not.toHaveProperty("job");
      expect(runtime.readiness()).toMatchObject({ ready: true, state: "ready" });
    } finally {
      await runtime?.stop();
    }
    expect(runtime?.readiness()).toMatchObject({ ready: false, state: "stopped" });
  });

  it("fails a stale queued schema version instead of silently acknowledging it", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is not initialized");
    const eventId = syntheticUuid(0x241);
    const workerQueue = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({ connectionString: queueConnectionString }),
    );
    const tenantEvents = createTenantCanonicalOutboxEventSource(tenant());
    const runtime = createWorkerRuntime({
      dispatcher: idleDispatcher,
      observability: { onDispatcherError: (error) => void error },
      queue: workerQueue,
      registry: createWorkerHandlerRegistry([
        {
          eventType: "lead.reopened",
          handler: () => Promise.resolve(),
          handlerVersion: "v1",
          queue: "analytics",
          schemaVersion: "1",
        },
      ]),
      tenantEvents,
      tenantRuntime: tenant(),
    });
    try {
      await runtime.start();
      const staleEnvelope = createPrivateQueueEnvelopeV1({
        aggregateId: syntheticUuid(0x242),
        aggregateType: "lead",
        causationId: null,
        correlationId: syntheticUuid(0x243),
        eventSchemaVersion: "2",
        eventType: "lead.reopened",
        organizationId: ORGANIZATION_A,
        outboxEventId: eventId,
      });
      expect(await queue().enqueueDurably("analytics", eventId, staleEnvelope)).toBe(eventId);
      await waitFor(async () => (await jobState(eventId)) === "failed");
      expect(await jobState(eventId)).toBe("failed");
    } finally {
      await runtime.stop();
    }
  });

  it("propagates handler failure through pg-boss with a stable attempt identity", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is not initialized");
    const eventId = syntheticUuid(0x244);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId,
      organizationId: ORGANIZATION_A,
    });
    await database().query(
      `update outbox_events
          set status = 'published',
              published_at = '2026-09-14T10:00:00.000Z'::timestamptz,
              published_claim_token = '00000000-0000-4000-8000-000000000244'::uuid
        where id = $1::uuid`,
      [eventId],
    );
    const identities: string[] = [];
    const workerQueue = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({ connectionString: queueConnectionString }),
    );
    const tenantEvents = createTenantCanonicalOutboxEventSource(tenant());
    const runtime = createWorkerRuntime({
      dispatcher: idleDispatcher,
      observability: { onDispatcherError: (error) => void error },
      queue: workerQueue,
      random: () => 0,
      registry: createWorkerHandlerRegistry([
        {
          eventType: "organization.created",
          handler: (context: WorkerHandlerContext) => {
            identities.push(context.identity.idempotencyKey);
            return Promise.reject(new Error("synthetic S8.4 handler failure"));
          },
          handlerVersion: "v1",
          queue: "maintenance",
          schemaVersion: "1",
        },
      ]),
      tenantEvents,
      tenantRuntime: tenant(),
    });
    try {
      await runtime.start();
      const queued = createPrivateQueueEnvelopeV1({
        aggregateId: ORGANIZATION_A,
        aggregateType: "organization",
        causationId: null,
        correlationId: eventId,
        eventSchemaVersion: "1",
        eventType: "organization.created",
        organizationId: ORGANIZATION_A,
        outboxEventId: eventId,
      });
      expect(await queue().enqueueDurably("maintenance", eventId, queued)).toBe(eventId);
      await waitFor(async () => (await jobState(eventId)) === "failed");
      expect(identities.length).toBeGreaterThan(0);
      expect(new Set(identities)).toEqual(new Set([`v1:${eventId}`]));
      expect(await jobState(eventId)).toBe("failed");
    } finally {
      await runtime.stop();
    }
  });

  it("fails queue mismatch and cross-tenant provenance before invoking the handler", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is not initialized");
    const wrongQueueId = syntheticUuid(0x245);
    const crossTenantId = syntheticUuid(0x246);
    await insertOrganizationCreatedOutbox({
      aggregateVersion: 1,
      eventId: crossTenantId,
      organizationId: ORGANIZATION_A,
    });
    const contexts: WorkerHandlerContext[] = [];
    const workerQueue = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({ connectionString: queueConnectionString }),
    );
    const tenantEvents = createTenantCanonicalOutboxEventSource(tenant());
    const runtime = createWorkerRuntime({
      dispatcher: idleDispatcher,
      observability: { onDispatcherError: (error) => void error },
      queue: workerQueue,
      random: () => 0,
      registry: createWorkerHandlerRegistry([
        {
          eventType: "organization.created",
          handler: (context: WorkerHandlerContext) => {
            contexts.push(context);
            return Promise.resolve();
          },
          handlerVersion: "v1",
          queue: "maintenance",
          schemaVersion: "1",
        },
        {
          eventType: "lead.created",
          handler: (context: WorkerHandlerContext) => {
            contexts.push(context);
            return Promise.resolve();
          },
          handlerVersion: "v1",
          queue: "analytics",
          schemaVersion: "1",
        },
      ]),
      tenantEvents,
      tenantRuntime: tenant(),
    });
    try {
      const wrongQueueEnvelope = createPrivateQueueEnvelopeV1({
        aggregateId: ORGANIZATION_A,
        aggregateType: "organization",
        causationId: null,
        correlationId: wrongQueueId,
        eventSchemaVersion: "1",
        eventType: "organization.created",
        organizationId: ORGANIZATION_A,
        outboxEventId: wrongQueueId,
      });
      const crossTenantEnvelope = createPrivateQueueEnvelopeV1({
        aggregateId: ORGANIZATION_A,
        aggregateType: "organization",
        causationId: null,
        correlationId: crossTenantId,
        eventSchemaVersion: "1",
        eventType: "organization.created",
        organizationId: ORGANIZATION_B,
        outboxEventId: crossTenantId,
      });
      expect(await queue().enqueueDurably("analytics", wrongQueueId, wrongQueueEnvelope)).toBe(
        wrongQueueId,
      );
      expect(await queue().enqueueDurably("maintenance", crossTenantId, crossTenantEnvelope)).toBe(
        crossTenantId,
      );
      await runtime.start();
      await waitFor(
        async () =>
          (await jobState(wrongQueueId)) === "failed" &&
          (await jobState(crossTenantId)) === "failed",
      );
      expect(contexts).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });
});
