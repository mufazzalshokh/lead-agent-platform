import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  EventIdSchema,
  OrganizationIdSchema,
  UuidV7Schema,
  isSchemaValue,
  type EventId,
  type OrganizationId,
  type UuidV7,
} from "../../packages/contracts/src/index.js";
import { createQueueDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import {
  AsyncOperatorDatabaseError,
  createAsyncOperatorDatabaseRuntime,
  migrationsFolder,
  runMigrations,
  type AsyncOperatorDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  createWorkerHandlerRegistry,
  type WorkerHandlerContext,
} from "../../apps/worker/src/handler-registry.js";
import type {
  CanonicalDispatchEvent,
  OutboxDispatcher,
} from "../../apps/worker/src/outbox-dispatcher.js";
import { createPrivateQueueEnvelopeV1 } from "../../apps/worker/src/queue-envelope.js";
import {
  createQueueInfrastructure,
  type QueueInfrastructure,
} from "../../apps/worker/src/queue-infrastructure.js";
import { WorkerExecutionFailure } from "../../apps/worker/src/reliability-policy.js";
import { createWorkerRuntime, type WorkerRuntime } from "../../apps/worker/src/worker-runtime.js";

const QUEUE_ROLE = "lead_agent_queue_runtime";
const OPERATOR_ROLE = "lead_agent_async_operator";
const TENANT_ROLE = "lead_agent_runtime";
const BUSINESS_TABLE_COUNT = 51;
const ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-000000001001";
const OPERATOR_ID = "0193f1a8-7f65-7c28-a434-000000001002";
const SOURCE_IP_HASH = Buffer.alloc(32, 7);
const FINGERPRINT_A = Buffer.alloc(32, 1);
const FINGERPRINT_B = Buffer.alloc(32, 2);

let container: StartedPostgreSqlContainer | undefined;
let ownerPool: Pool | undefined;
let queuePool: Pool | undefined;
let operatorRuntime: AsyncOperatorDatabaseRuntime | undefined;
let ownerConnectionString: string | undefined;
let queueConnectionString: string | undefined;
let serverVersion = "";

const database = (): Pool => {
  if (ownerPool === undefined) throw new Error("S8.5 owner pool is unavailable");
  return ownerPool;
};

const queueDatabase = (): Pool => {
  if (queuePool === undefined) throw new Error("S8.5 queue pool is unavailable");
  return queuePool;
};

const operator = (): AsyncOperatorDatabaseRuntime => {
  if (operatorRuntime === undefined) throw new Error("S8.5 operator runtime is unavailable");
  return operatorRuntime;
};

const syntheticUuid = (suffix: number): string =>
  `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;

const asEventId = (value: string): EventId => {
  if (!isSchemaValue(EventIdSchema, value)) throw new Error("Invalid test event ID");
  return value;
};

const asOrganizationId = (value: string): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, value)) throw new Error("Invalid test organization ID");
  return value;
};

const asUuidV7 = (value: string): UuidV7 => {
  if (!isSchemaValue(UuidV7Schema, value)) throw new Error("Invalid test UUIDv7");
  return value;
};

const requireTestDatabaseUrl = (): string | undefined => {
  const value = process.env["TEST_DATABASE_URL"];
  if (value === undefined) return undefined;
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !/(^|[_-])test([_-]|$)/u.test(databaseName)
  ) {
    throw new Error("TEST_DATABASE_URL must identify an explicitly named PostgreSQL test database");
  }
  return value;
};

const requireEmptyExternalDatabase = async (pool: Pool): Promise<void> => {
  const result = await pool.query<{ count: number }>(
    `select count(*)::integer as count
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('information_schema', 'pg_catalog')`,
  );
  if (result.rows[0]?.count !== 0) {
    throw new Error("TEST_DATABASE_URL must point to an empty disposable test database");
  }
};

const configureRolePassword = async (role: string, password: string): Promise<void> => {
  const statement = await database().query<{ sql: string }>(
    "select pg_catalog.format('alter role %I password %L', $1::text, $2::text) as sql",
    [role, password],
  );
  const sql = statement.rows[0]?.sql;
  if (sql === undefined) throw new Error("Unable to configure disposable test role");
  await database().query(sql);
};

const connectionStringFor = (role: string, password: string): string => {
  if (ownerConnectionString === undefined)
    throw new Error("Owner connection string is unavailable");
  const url = new URL(ownerConnectionString);
  url.username = role;
  url.password = password;
  return url.toString();
};

const insertOrganization = async (): Promise<void> => {
  await database().query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values ($1::uuid, 's85-tenant', 'S8.5 Tenant', 'active', 'en', 'Asia/Tashkent')`,
    [ORGANIZATION_ID],
  );
};

const canonicalEvent = (eventId: string): CanonicalDispatchEvent =>
  Object.freeze({
    aggregate_id: ORGANIZATION_ID,
    aggregate_type: "organization",
    causation_id: null,
    correlation_id: eventId,
    event_id: eventId,
    event_type: "organization.created",
    organization_id: ORGANIZATION_ID,
    schema_version: "1",
  });

const queueEnvelope = (eventId: string) =>
  createPrivateQueueEnvelopeV1({
    aggregateId: ORGANIZATION_ID,
    aggregateType: "organization",
    causationId: null,
    correlationId: eventId,
    eventSchemaVersion: "1",
    eventType: "organization.created",
    organizationId: ORGANIZATION_ID,
    outboxEventId: eventId,
  });

const insertOutbox = async (
  eventId: string,
  status: "dead_lettered" | "published" = "published",
): Promise<void> => {
  const occurredAt = new Date(Date.now() - 5_000);
  await database().query(
    `insert into outbox_events
      (id, organization_id, event_type, schema_version, aggregate_type,
       aggregate_id, aggregate_version, payload_jsonb, correlation_id,
       causation_id, occurred_at, status, attempt_count, available_at,
       published_at, published_claim_token, last_error_category)
     values ($1::uuid, $2::uuid, 'organization.created', '1', 'organization',
       $2::uuid, $3::bigint, '{}'::jsonb, $1::uuid, null, $4::timestamptz,
       $5::varchar, 1, $4::timestamptz,
       case when $5 = 'published' then $4::timestamptz else null end,
       case when $5 = 'published' then '123e4567-e89b-42d3-a456-426614174000'::uuid else null end,
       case when $5 = 'dead_lettered' then 'permanent' else null end)`,
    [eventId, ORGANIZATION_ID, Number.parseInt(eventId.slice(-4), 16) + 1, occurredAt, status],
  );
};

type AcquisitionRow = {
  acquisition_state: string;
  execution_lease_expires_at: Date | null;
  execution_lease_token: string | null;
};

const acquire = async (
  eventId: string,
  fingerprint = FINGERPRINT_A,
  executionNumber = 1,
): Promise<AcquisitionRow> => {
  const result = await queueDatabase().query<AcquisitionRow>(
    `select acquisition_state, execution_lease_token::text, execution_lease_expires_at
       from app.acquire_worker_handler_execution(
         $1::uuid, $2::uuid, 'v1', $3::bytea, $4::integer, 900
       )`,
    [ORGANIZATION_ID, eventId, fingerprint, executionNumber],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected execution acquisition result");
  return row;
};

const waitFor = async (condition: () => Promise<boolean>, timeout = 20_000): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for S8.5 PostgreSQL state");
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

const auditContext = (suffix: number) => ({
  approvalReference: `OPS-S85-${suffix}`,
  auditEventId: asUuidV7(syntheticUuid(0x2000 + suffix)),
  operatorPrincipalId: asUuidV7(OPERATOR_ID),
  reasonCode: "root_cause_repaired",
  requestId: `request.s85.operator.${suffix.toString().padStart(3, "0")}`,
  sourceIpHash: SOURCE_IP_HASH,
});

beforeAll(async () => {
  const externalUrl = requireTestDatabaseUrl();
  if (externalUrl === undefined) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    container = await new PostgreSqlContainer("postgres:17.11")
      .withDatabase("codex_s85_test")
      .withUsername("lead_agent_s85_owner")
      .withPassword("s85-local-test-only-owner-password")
      .start();
    ownerConnectionString = container.getConnectionUri();
  } else {
    ownerConnectionString = externalUrl;
  }
  ownerPool = new Pool({ connectionString: ownerConnectionString, max: 12 });
  if (externalUrl !== undefined) await requireEmptyExternalDatabase(ownerPool);

  const version = await database().query<{ server_version: string; server_version_num: string }>(
    `select current_setting('server_version') as server_version,
            current_setting('server_version_num') as server_version_num`,
  );
  const number = Number(version.rows[0]?.server_version_num);
  if (number < 170_000 || number >= 180_000) {
    throw new Error("S8.5 integration tests require PostgreSQL major version 17");
  }
  serverVersion = version.rows[0]?.server_version ?? "";
  await runMigrations(database());
  await runMigrations(database());

  const queuePassword = "s85-local-test-only-queue-password";
  const operatorPassword = "s85-local-test-only-operator-password";
  await configureRolePassword(QUEUE_ROLE, queuePassword);
  await configureRolePassword(OPERATOR_ROLE, operatorPassword);
  queueConnectionString = connectionStringFor(QUEUE_ROLE, queuePassword);
  queuePool = new Pool({ connectionString: queueConnectionString, max: 8 });
  operatorRuntime = createAsyncOperatorDatabaseRuntime(
    createQueueDatabaseRuntimeConfig({
      connectionString: connectionStringFor(OPERATOR_ROLE, operatorPassword),
      maxConnections: 2,
    }),
    { onUnexpectedPoolError: () => undefined },
  );
}, 180_000);

beforeEach(async () => {
  await database().query("delete from pgboss.job");
  await database().query("delete from app.worker_handler_executions");
  await database().query("delete from platform_audit_events");
  await database().query("truncate table outbox_events, organizations cascade");
  await insertOrganization();
});

afterAll(async () => {
  await operatorRuntime?.close();
  await queuePool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

describe("S8.5 PostgreSQL 17 reliability migration", { timeout: 30_000 }, () => {
  it("bootstraps and reruns 0025 without changing the 51-table business manifest", async () => {
    expect(serverVersion).toMatch(/^17\.11(?:\.|\s|$)/u);
    const journal: unknown = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    );
    const entries: unknown =
      typeof journal === "object" && journal !== null
        ? (journal as Record<string, unknown>)["entries"]
        : undefined;
    expect(Array.isArray(entries) ? entries.at(-1) : undefined).toMatchObject({
      idx: 25,
      tag: "0025_s6_membership_invitation_clock_skew",
    });
    const publicTables = await database().query<{ count: number }>(
      `select count(*)::integer as count from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(publicTables.rows).toEqual([{ count: BUSINESS_TABLE_COUNT }]);
    const ledger = await database().query<{ count: number }>(
      `select count(*)::integer as count from information_schema.tables
        where table_schema = 'app' and table_name = 'worker_handler_executions'`,
    );
    expect(ledger.rows).toEqual([{ count: 1 }]);
  });

  it("precreates six mechanically-derived DLQs and freezes every relevant job option", async () => {
    const queues = await database().query<{
      dead_letter: string | null;
      deletion_seconds: number;
      expire_seconds: number;
      heartbeat_seconds: number;
      name: string;
      retry_backoff: boolean;
      retry_limit: number;
    }>(
      `select name, retry_limit, retry_backoff, expire_seconds,
              deletion_seconds, heartbeat_seconds, dead_letter
         from pgboss.queue order by name`,
    );
    expect(queues.rows.map(({ name }) => name)).toEqual([
      "ai",
      "ai_dlq",
      "analytics",
      "analytics_dlq",
      "inbound",
      "inbound_dlq",
      "maintenance",
      "maintenance_dlq",
      "outbound_message",
      "outbound_message_dlq",
      "staff_notification",
      "staff_notification_dlq",
    ]);
    for (const queue of queues.rows.filter(({ name }) => !name.endsWith("_dlq"))) {
      expect(queue).toMatchObject({
        dead_letter: `${queue.name}_dlq`,
        deletion_seconds: 604_800,
        expire_seconds: 900,
        heartbeat_seconds: 60,
        retry_backoff: false,
        retry_limit: 4,
      });
    }
  });

  it("separates tenant, queue, definer, and platform-operator privileges", async () => {
    const result = await database().query<{
      operator_can_acquire: boolean;
      operator_can_redrive: boolean;
      operator_reads_ledger: boolean;
      queue_can_acquire: boolean;
      queue_can_redrive: boolean;
      queue_reads_ledger: boolean;
      tenant_can_redrive: boolean;
    }>(
      `select
        has_function_privilege($1, 'app.acquire_worker_handler_execution(uuid,uuid,character varying,bytea,integer,integer)', 'EXECUTE') as queue_can_acquire,
        has_function_privilege($1, 'app.operator_redrive_worker_dlq_job(uuid,uuid,uuid,character varying,character varying,uuid,character varying,character varying,character varying,character varying,character varying,character varying,bytea)', 'EXECUTE') as queue_can_redrive,
        has_table_privilege($1, 'app.worker_handler_executions', 'SELECT') as queue_reads_ledger,
        has_function_privilege($2, 'app.acquire_worker_handler_execution(uuid,uuid,character varying,bytea,integer,integer)', 'EXECUTE') as operator_can_acquire,
        has_function_privilege($2, 'app.operator_redrive_worker_dlq_job(uuid,uuid,uuid,character varying,character varying,uuid,character varying,character varying,character varying,character varying,character varying,character varying,bytea)', 'EXECUTE') as operator_can_redrive,
        has_table_privilege($2, 'app.worker_handler_executions', 'SELECT') as operator_reads_ledger,
        has_function_privilege($3, 'app.operator_requeue_dead_outbox_event(uuid,uuid,uuid,uuid,character varying,character varying,character varying,character varying,character varying,character varying,character varying,bytea)', 'EXECUTE') as tenant_can_redrive`,
      [QUEUE_ROLE, OPERATOR_ROLE, TENANT_ROLE],
    );
    expect(result.rows).toEqual([
      {
        operator_can_acquire: false,
        operator_can_redrive: true,
        operator_reads_ledger: false,
        queue_can_acquire: true,
        queue_can_redrive: false,
        queue_reads_ledger: false,
        tenant_can_redrive: false,
      },
    ]);
  });

  it("gives concurrent duplicates one durable owner and enforces monotonic attempts", async () => {
    const eventId = syntheticUuid(0x1100);
    await insertOutbox(eventId);
    const [first, second] = await Promise.all([acquire(eventId), acquire(eventId)]);
    expect([first.acquisition_state, second.acquisition_state].sort()).toEqual([
      "acquired",
      "busy",
    ]);
    const rows = await database().query<{ count: number; attempt_count: number }>(
      `select count(*)::integer as count, max(attempt_count)::integer as attempt_count
         from app.worker_handler_executions where outbox_event_id = $1::uuid`,
      [eventId],
    );
    expect(rows.rows).toEqual([{ attempt_count: 1, count: 1 }]);

    const owner = [first, second].find(({ acquisition_state }) => acquisition_state === "acquired");
    if (owner?.execution_lease_token === null || owner?.execution_lease_token === undefined) {
      throw new Error("Expected one acquired execution lease");
    }
    expect(
      (
        await queueDatabase().query(
          `select app.finish_worker_handler_execution(
             $1::uuid, $2::uuid, 'v1', $3::uuid,
             'retryable_failure', 'RETRYABLE_INFRASTRUCTURE'
           ) as finished`,
          [ORGANIZATION_ID, eventId, owner.execution_lease_token],
        )
      ).rows,
    ).toEqual([{ finished: true }]);
    expect((await acquire(eventId, FINGERPRINT_A, 1)).acquisition_state).toBe("busy");
    expect((await acquire(eventId, FINGERPRINT_A, 3)).acquisition_state).toBe("collision");
    expect((await acquire(eventId, FINGERPRINT_A, 2)).acquisition_state).toBe("acquired");
  });

  it("persists exact success replay and rejects same-identity provenance drift", async () => {
    const eventId = syntheticUuid(0x1101);
    await insertOutbox(eventId);
    const first = await acquire(eventId);
    expect(first.acquisition_state).toBe("acquired");
    expect(
      (
        await queueDatabase().query(
          `select app.finish_worker_handler_execution(
             $1::uuid, $2::uuid, 'v1', $3::uuid, 'succeeded', null
           ) as finished`,
          [ORGANIZATION_ID, eventId, first.execution_lease_token],
        )
      ).rows,
    ).toEqual([{ finished: true }]);
    expect((await acquire(eventId)).acquisition_state).toBe("known_success");
    expect((await acquire(eventId, FINGERPRINT_B)).acquisition_state).toBe("collision");
  });

  it("turns an expired crash-before-effect lease into reconciliation and safe reacquisition", async () => {
    const eventId = syntheticUuid(0x1102);
    await insertOutbox(eventId);
    expect((await acquire(eventId)).acquisition_state).toBe("acquired");
    await database().query(
      `update app.worker_handler_executions
          set lease_expires_at = last_started_at
        where outbox_event_id = $1::uuid`,
      [eventId],
    );
    expect((await acquire(eventId, FINGERPRINT_A, 2)).acquisition_state).toBe(
      "reconciliation_required",
    );
    const resumed = await queueDatabase().query<{ lease_token: string | null }>(
      `select app.resume_worker_handler_execution(
         $1::uuid, $2::uuid, 'v1', $3::bytea, 2, 900
       )::text as lease_token`,
      [ORGANIZATION_ID, eventId, FINGERPRINT_A],
    );
    expect(resumed.rows[0]?.lease_token).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe("S8.5 pg-boss execution and workload DLQ", { timeout: 30_000 }, () => {
  it("runs exactly five retryable executions, isolates poison, and retains safe DLQ provenance", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is unavailable");
    const poisonId = syntheticUuid(0x1200);
    const healthyId = syntheticUuid(0x1201);
    await insertOutbox(poisonId);
    await insertOutbox(healthyId);
    const attempts: string[] = [];
    const contexts: WorkerHandlerContext[] = [];
    const queue: QueueInfrastructure = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({
        connectionString: queueConnectionString,
        maxConnections: 6,
      }),
      { random: () => 0 },
    );
    const runtime: WorkerRuntime = createWorkerRuntime({
      dispatcher: idleDispatcher,
      observability: { onDispatcherError: () => undefined },
      queue,
      random: () => 0,
      registry: createWorkerHandlerRegistry([
        {
          eventType: "organization.created",
          handler: (context: WorkerHandlerContext) => {
            contexts.push(context);
            attempts.push(context.outboxEventId);
            return context.outboxEventId === poisonId
              ? Promise.reject(new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE"))
              : Promise.resolve();
          },
          handlerVersion: "v1",
          queue: "maintenance",
          schemaVersion: "1",
        },
      ]),
      tenantEvents: {
        loadCanonicalEvent: (_organizationId, eventId) => Promise.resolve(canonicalEvent(eventId)),
      },
      tenantRuntime: { verifyReady: () => Promise.resolve() },
    });
    try {
      await runtime.start();
      expect(await queue.enqueueDurably("maintenance", poisonId, queueEnvelope(poisonId))).toBe(
        poisonId,
      );
      expect(await queue.enqueueDurably("maintenance", healthyId, queueEnvelope(healthyId))).toBe(
        healthyId,
      );
      await waitFor(async () => {
        const result = await database().query<{ count: number }>(
          `select count(*)::integer as count from pgboss.job
            where name = 'maintenance_dlq' and source_id = $1::uuid`,
          [poisonId],
        );
        return result.rows[0]?.count === 1;
      });
      await waitFor(async () => {
        const result = await database().query<{ state: string }>(
          "select state::text from pgboss.job where name = 'maintenance' and id = $1::uuid",
          [healthyId],
        );
        return result.rows[0]?.state === "completed";
      });
    } finally {
      await runtime.stop();
    }

    expect(attempts.filter((id) => id === poisonId)).toHaveLength(5);
    expect(attempts.filter((id) => id === healthyId)).toHaveLength(1);
    expect(
      new Set(
        contexts
          .filter(({ outboxEventId }) => outboxEventId === poisonId)
          .map(({ identity }) => identity.idempotencyKey),
      ),
    ).toEqual(new Set([`v1:${poisonId}`]));
    const dlq = await database().query<{
      data: Record<string, unknown>;
      output: Record<string, unknown>;
      source_id: string;
      source_name: string;
      source_retry_count: number;
    }>(
      `select data, output, source_id::text, source_name, source_retry_count
         from pgboss.job where name = 'maintenance_dlq' and source_id = $1::uuid`,
      [poisonId],
    );
    expect(dlq.rows).toEqual([
      expect.objectContaining({
        data: queueEnvelope(poisonId),
        output: { category: "RETRYABLE_INFRASTRUCTURE" },
        source_id: poisonId,
        source_name: "maintenance",
        source_retry_count: 4,
      }),
    ]);
    expect(dlq.rows[0]?.data).not.toHaveProperty("payload");
    const outbox = await database().query<{ status: string }>(
      "select status from outbox_events where id = $1::uuid",
      [poisonId],
    );
    expect(outbox.rows).toEqual([{ status: "published" }]);
  });

  it("stores explicit five-execution, expiration, heartbeat, and workload-DLQ options", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is unavailable");
    const eventId = syntheticUuid(0x1202);
    await insertOutbox(eventId);
    const queue = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({ connectionString: queueConnectionString }),
      { random: () => 0.5 },
    );
    try {
      await queue.start();
      await queue.enqueueDurably("maintenance", eventId, queueEnvelope(eventId));
      const job = await database().query<{
        dead_letter: string;
        expire_seconds: number;
        heartbeat_seconds: number;
        retry_backoff: boolean;
        retry_delay: number;
        retry_limit: number;
      }>(
        `select retry_limit, retry_delay, retry_backoff, expire_seconds,
                heartbeat_seconds, dead_letter
           from pgboss.job where name = 'maintenance' and id = $1::uuid`,
        [eventId],
      );
      expect(job.rows).toEqual([
        {
          dead_letter: "maintenance_dlq",
          expire_seconds: 900,
          heartbeat_seconds: 60,
          retry_backoff: false,
          retry_delay: 3,
          retry_limit: 4,
        },
      ]);
    } finally {
      await queue.stop();
    }
  });

  it("refreshes heartbeats only while a long-running handler remains active", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is unavailable");
    const eventId = syntheticUuid(0x1203);
    await insertOutbox(eventId);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const queue = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({ connectionString: queueConnectionString }),
      { heartbeatRefreshSeconds: 0.05 },
    );
    let registration: Awaited<ReturnType<QueueInfrastructure["registerWorker"]>> | undefined;
    try {
      await queue.start();
      registration = await queue.registerWorker("maintenance", async () => {
        started.resolve();
        await release.promise;
        return Object.freeze({ status: "completed" });
      });
      await queue.enqueueDurably("maintenance", eventId, queueEnvelope(eventId));
      await started.promise;
      const first = await database().query<{ heartbeat_on: Date }>(
        `select heartbeat_on from pgboss.job
          where name = 'maintenance' and id = $1::uuid and state = 'active'`,
        [eventId],
      );
      const initialHeartbeat = first.rows[0]?.heartbeat_on;
      expect(initialHeartbeat).toBeInstanceOf(Date);
      await waitFor(async () => {
        const refreshed = await database().query<{ heartbeat_on: Date }>(
          "select heartbeat_on from pgboss.job where name = 'maintenance' and id = $1::uuid",
          [eventId],
        );
        return (
          initialHeartbeat !== undefined &&
          (refreshed.rows[0]?.heartbeat_on.getTime() ?? 0) > initialHeartbeat.getTime()
        );
      });
      release.resolve();
      await waitFor(async () => {
        const result = await database().query<{ state: string }>(
          "select state::text from pgboss.job where name = 'maintenance' and id = $1::uuid",
          [eventId],
        );
        return result.rows[0]?.state === "completed";
      });
      const completed = await database().query<{ heartbeat_on: Date }>(
        "select heartbeat_on from pgboss.job where name = 'maintenance' and id = $1::uuid",
        [eventId],
      );
      const finalHeartbeat = completed.rows[0]?.heartbeat_on;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      const after = await database().query<{ heartbeat_on: Date }>(
        "select heartbeat_on from pgboss.job where name = 'maintenance' and id = $1::uuid",
        [eventId],
      );
      expect(after.rows[0]?.heartbeat_on).toEqual(finalHeartbeat);
    } finally {
      release.resolve();
      if (registration !== undefined) await queue.stopWorker(registration);
      await queue.stop();
    }
  });

  it("supervises the exact 15-minute active expiration into the bounded retry path", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is unavailable");
    const eventId = syntheticUuid(0x1204);
    await insertOutbox(eventId);
    const queue = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({ connectionString: queueConnectionString }),
      { superviseIntervalSeconds: 1 },
    );
    try {
      await queue.start();
      await queue.enqueueDurably("maintenance", eventId, queueEnvelope(eventId));
      await database().query(
        `update pgboss.job
            set state = 'active',
                started_on = clock_timestamp() - interval '901 seconds',
                heartbeat_on = clock_timestamp()
          where name = 'maintenance' and id = $1::uuid`,
        [eventId],
      );
      await waitFor(async () => {
        const result = await database().query<{ retry_count: number; state: string }>(
          `select retry_count, state::text from pgboss.job
            where name = 'maintenance' and id = $1::uuid`,
          [eventId],
        );
        return result.rows[0]?.state === "retry" && result.rows[0]?.retry_count === 0;
      });
    } finally {
      await queue.stop();
    }
  });
});

describe("S8.5 audited platform-operator recovery", { timeout: 30_000 }, () => {
  const insertDlqFixture = async (eventId: string, state: "permanent_failure" | "succeeded") => {
    await insertOutbox(eventId);
    await database().query(
      `insert into app.worker_handler_executions
        (handler_version, outbox_event_id, organization_id, input_fingerprint,
         state, attempt_count, first_started_at, last_started_at, completed_at,
         safe_failure_category)
       values ('v1', $1::uuid, $2::uuid, $3::bytea, $4::varchar, 5,
         clock_timestamp() - interval '1 minute', clock_timestamp() - interval '1 minute',
         clock_timestamp(), $5::varchar)`,
      [
        eventId,
        ORGANIZATION_ID,
        FINGERPRINT_A,
        state,
        state === "succeeded" ? null : "RETRYABLE_INFRASTRUCTURE",
      ],
    );
    const dlqId = "123e4567-e89b-42d3-a456-426614174100";
    await database().query(
      `insert into pgboss.job
        (id, name, data, state, retry_limit, retry_count, retry_delay,
         retry_backoff, expire_seconds, deletion_seconds, keep_until,
         heartbeat_seconds, source_name, source_id, source_created_on,
         source_retry_count)
       values ($1::uuid, 'maintenance_dlq', $2::jsonb, 'created', 0, 0, 0,
         false, 900, 2592000, clock_timestamp() + interval '10 years', 60,
         'maintenance', $3::uuid, clock_timestamp() - interval '1 minute', 4)`,
      [dlqId, JSON.stringify(queueEnvelope(eventId)), eventId],
    );
    return dlqId;
  };

  it("redrives one exact failed job atomically while preserving logical identity", async () => {
    const eventId = syntheticUuid(0x1300);
    const dlqJobId = await insertDlqFixture(eventId, "permanent_failure");
    const redrivenId = await operator().redriveWorkerDlqJob({
      ...auditContext(1),
      dlqJobId,
      eventType: "organization.created",
      expectedState: "created",
      handlerVersion: "v1",
      outboxEventId: asEventId(eventId),
      schemaVersion: "1",
      sourceQueue: "maintenance",
    });
    expect(redrivenId).not.toBe(eventId);
    const jobs = await database().query<{ id: string; name: string; state: string }>(
      `select id::text, name, state::text from pgboss.job
        where id in ($1::uuid, $2::uuid) order by name`,
      [dlqJobId, redrivenId],
    );
    expect(jobs.rows).toEqual([
      { id: redrivenId, name: "maintenance", state: "created" },
      { id: dlqJobId, name: "maintenance_dlq", state: "completed" },
    ]);
    const ledger = await database().query<{ attempt_count: number; state: string }>(
      `select attempt_count, state from app.worker_handler_executions
        where handler_version = 'v1' and outbox_event_id = $1::uuid`,
      [eventId],
    );
    expect(ledger.rows).toEqual([{ attempt_count: 0, state: "reconciliation_required" }]);
    const audit = await database().query<{
      action: string;
      metadata_jsonb: Record<string, unknown>;
    }>("select action, metadata_jsonb from platform_audit_events where target_id = $1::uuid", [
      eventId,
    ]);
    expect(audit.rows).toEqual([expect.objectContaining({ action: "job.redriven" })]);
    expect(audit.rows[0]?.metadata_jsonb).not.toHaveProperty("payload");
  });

  it("denies generic replay of a known successful logical effect", async () => {
    const eventId = syntheticUuid(0x1301);
    const dlqJobId = await insertDlqFixture(eventId, "succeeded");
    await expect(
      operator().redriveWorkerDlqJob({
        ...auditContext(2),
        dlqJobId,
        eventType: "organization.created",
        expectedState: "created",
        handlerVersion: "v1",
        outboxEventId: asEventId(eventId),
        schemaVersion: "1",
        sourceQueue: "maintenance",
      }),
    ).rejects.toBeInstanceOf(AsyncOperatorDatabaseError);
    const states = await database().query<{ state: string }>(
      "select state::text from pgboss.job where id = $1::uuid",
      [dlqJobId],
    );
    expect(states.rows).toEqual([{ state: "created" }]);
  });

  it("denies redrive while logical execution evidence is nonterminal", async () => {
    const eventId = syntheticUuid(0x1303);
    const dlqJobId = await insertDlqFixture(eventId, "permanent_failure");
    await database().query(
      `update app.worker_handler_executions
       set state = 'in_progress', attempt_count = 5,
           lease_token = $2::uuid,
           lease_expires_at = clock_timestamp() + interval '15 minutes',
           completed_at = null, safe_failure_category = null
       where handler_version = 'v1' and outbox_event_id = $1::uuid`,
      [eventId, syntheticUuid(0x3303)],
    );
    await expect(
      operator().redriveWorkerDlqJob({
        ...auditContext(4),
        dlqJobId,
        eventType: "organization.created",
        expectedState: "created",
        handlerVersion: "v1",
        outboxEventId: asEventId(eventId),
        schemaVersion: "1",
        sourceQueue: "maintenance",
      }),
    ).rejects.toBeInstanceOf(AsyncOperatorDatabaseError);
    const states = await database().query<{ state: string }>(
      "select state::text from pgboss.job where id = $1::uuid",
      [dlqJobId],
    );
    expect(states.rows).toEqual([{ state: "created" }]);
    const audit = await database().query<{ count: number }>(
      "select count(*)::integer as count from platform_audit_events where target_id = $1::uuid",
      [eventId],
    );
    expect(audit.rows).toEqual([{ count: 0 }]);
  });

  it("requeues an exact dead outbox ID and makes audit failure roll back mutation", async () => {
    const eventId = syntheticUuid(0x1302);
    await insertOutbox(eventId, "dead_lettered");
    const duplicateAuditId = syntheticUuid(0x2300);
    await database().query(
      `insert into platform_audit_events
        (id, operator_principal_id, action, target_organization_id, target_type,
         target_id, approval_reference, reason_code, result, request_id,
         source_ip_hash, occurred_at, metadata_jsonb)
       values ($1::uuid, $2::uuid, 'fixture.created', $3::uuid, 'fixture', null,
         'OPS-FIXTURE', 'test_fixture', 'succeeded', 'request.s85.fixture.001',
         $4::bytea, clock_timestamp(), '{}'::jsonb)`,
      [duplicateAuditId, OPERATOR_ID, ORGANIZATION_ID, SOURCE_IP_HASH],
    );
    await expect(
      operator().requeueDeadOutboxEvent({
        ...auditContext(3),
        auditEventId: asUuidV7(duplicateAuditId),
        eventType: "organization.created",
        expectedErrorCategory: "permanent",
        expectedState: "dead_lettered",
        organizationId: asOrganizationId(ORGANIZATION_ID),
        outboxEventId: asEventId(eventId),
        schemaVersion: "1",
      }),
    ).rejects.toBeInstanceOf(AsyncOperatorDatabaseError);
    expect(
      (
        await database().query<{ status: string }>(
          "select status from outbox_events where id = $1",
          [eventId],
        )
      ).rows,
    ).toEqual([{ status: "dead_lettered" }]);

    await expect(
      operator().requeueDeadOutboxEvent({
        ...auditContext(4),
        eventType: "organization.created",
        expectedErrorCategory: "permanent",
        expectedState: "dead_lettered",
        organizationId: asOrganizationId(ORGANIZATION_ID),
        outboxEventId: asEventId(eventId),
        schemaVersion: "1",
      }),
    ).resolves.toBeUndefined();
    const outbox = await database().query<{ id: string; status: string }>(
      "select id::text, status from outbox_events where id = $1::uuid",
      [eventId],
    );
    expect(outbox.rows).toEqual([{ id: eventId, status: "pending" }]);
    const audit = await database().query<{ action: string }>(
      "select action from platform_audit_events where target_id = $1::uuid",
      [eventId],
    );
    expect(audit.rows).toEqual([{ action: "outbox.requeued" }]);
  });
});
