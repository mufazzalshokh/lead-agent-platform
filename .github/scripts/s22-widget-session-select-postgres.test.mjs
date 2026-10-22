import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import {
  collectWidgetSessionSelection,
  parseSelectionScope,
  runReadOnlySelection,
  selectionForceRlsSql,
  selectionForceRlsTableNames,
  selectionOrganization,
} from "./s22-widget-session-select-readonly.mjs";

const { Client } = pg;
const databaseName = "lead_agent_s22_widget_selector_test";
const runtimeRole = "lead_agent_runtime";
const runtimePassword = "disposable-widget-selector-runtime-only";
const oldSelectionForceRlsSql = `select count(*)::integer as count,
           bool_and(c.relrowsecurity and c.relforcerowsecurity
             and c.relowner<>(select oid from pg_catalog.pg_roles where rolname=current_user)) as safe
           from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname=any($2::text[])`;

const ids = Object.freeze({
  organizationA: selectionOrganization,
  organizationB: "01a12000-0000-7000-8000-000000000100",
  channelA: "01a12000-0000-7000-8000-000000000001",
  originA: "01a12000-0000-7000-8000-000000000002",
  sessionA: "01a12000-0000-7000-8000-000000000003",
  channelASecond: "01a12000-0000-7000-8000-000000000004",
  originASecond: "01a12000-0000-7000-8000-000000000005",
  sessionASecond: "01a12000-0000-7000-8000-000000000006",
  channelB: "01a12000-0000-7000-8000-000000000101",
  originB: "01a12000-0000-7000-8000-000000000102",
  sessionB: "01a12000-0000-7000-8000-000000000103",
});

const requireLocalDisposableUrl = (raw, label) => {
  assert.equal(typeof raw, "string", `${label} must be explicitly configured`);
  const url = new URL(raw);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), `${label} protocol`);
  assert.equal(url.hostname, "localhost", `${label} host`);
  assert.equal(url.pathname, `/${databaseName}`, `${label} database`);
  assert.ok(url.port === "" || url.port === "5432", `${label} port`);
  assert.equal(url.search, "", `${label} options are forbidden`);
  assert.equal(url.hash, "", `${label} fragment is forbidden`);
  assert.notEqual(url.username, "", `${label} user`);
  assert.notEqual(url.password, "", `${label} password`);
  return url;
};

const adminUrl = requireLocalDisposableUrl(
  process.env.S22_WIDGET_SELECTOR_TEST_DATABASE_URL,
  "selector test database URL",
);
const runtimeUrl = new URL(adminUrl);
runtimeUrl.username = runtimeRole;
runtimeUrl.password = runtimePassword;
requireLocalDisposableUrl(runtimeUrl.toString(), "derived runtime database URL");

const clientFor = (url, applicationName) =>
  new Client({
    application_name: applicationName,
    connectionString: url.toString(),
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    ssl: false,
  });

const configureTimeouts = async (client) => {
  await client.query("set statement_timeout='5s'");
  await client.query("set lock_timeout='1s'");
  await client.query("set idle_in_transaction_session_timeout='10s'");
};

const userObjects = async (client) =>
  (
    await client.query(
      `select 'schema' as kind,n.nspname as schema_name,n.nspname as object_name
       from pg_catalog.pg_namespace n
       where n.nspname not like 'pg_%' and n.nspname not in ('information_schema','public')
       union all
       select 'relation',n.nspname,c.relname from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid=c.relnamespace
       where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
       union all
       select 'routine',n.nspname,p.proname from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid=p.pronamespace
       where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
       order by kind,schema_name,object_name`,
    )
  ).rows;

const createFixture = async (admin, scope, issuedAt, lastSeenAt, expiresAt) => {
  await admin.query("begin");
  try {
    await admin.query(
      `create role lead_agent_runtime login password '${runtimePassword}'
         nosuperuser nobypassrls nocreatedb nocreaterole noinherit`,
    );
    await admin.query("create schema app");
    await admin.query(
      `create function app.current_organization_id() returns uuid
       language sql stable security invoker set search_path=pg_catalog
       as $$select nullif(pg_catalog.current_setting('app.organization_id',true),'')::uuid$$`,
    );
    await admin.query("revoke all on function app.current_organization_id() from public");
    await admin.query(
      `create table public.channel_connections (
         id uuid primary key, organization_id uuid not null,
         channel_type varchar(16) not null, status varchar(16) not null
       )`,
    );
    await admin.query(
      `create table public.widget_allowed_origins (
         id uuid primary key, organization_id uuid not null, channel_connection_id uuid not null,
         match_type varchar(24) not null, scheme varchar(8) not null,
         normalized_host varchar(253) not null, port integer, status varchar(16) not null
       )`,
    );
    await admin.query(
      `create table public.widget_sessions (
         id uuid primary key, organization_id uuid not null, channel_connection_id uuid not null,
         widget_allowed_origin_id uuid not null, status varchar(16) not null,
         contact_id uuid, conversation_id uuid, issued_at timestamptz not null,
         last_seen_at timestamptz not null, expires_at timestamptz not null,
         revoked_at timestamptz, version bigint not null
       )`,
    );
    for (const table of selectionForceRlsTableNames) {
      assert.match(table, /^[a-z_]+$/u);
      await admin.query(`alter table public.${table} enable row level security`);
      await admin.query(`alter table public.${table} force row level security`);
      await admin.query(
        `create policy ${table}_tenant_isolation on public.${table}
         to lead_agent_runtime using (organization_id=app.current_organization_id())
         with check (organization_id=app.current_organization_id())`,
      );
      await admin.query(`revoke all on table public.${table} from public`);
      await admin.query(`grant select on table public.${table} to lead_agent_runtime`);
    }
    await admin.query("grant usage on schema public,app to lead_agent_runtime");
    await admin.query(
      "grant execute on function app.current_organization_id() to lead_agent_runtime",
    );
    await admin.query(
      `grant connect on database lead_agent_s22_widget_selector_test to lead_agent_runtime`,
    );
    await admin.query(
      `insert into channel_connections (id,organization_id,channel_type,status) values
       ($1,$2,'widget','active'),($3,$4,'widget','active')`,
      [ids.channelA, ids.organizationA, ids.channelB, ids.organizationB],
    );
    await admin.query(
      `insert into widget_allowed_origins
       (id,organization_id,channel_connection_id,match_type,scheme,normalized_host,port,status)
       values ($1,$2,$3,'exact','https',$4,$5,'active'),
              ($6,$7,$8,'exact','https',$4,$5,'active')`,
      [
        ids.originA,
        ids.organizationA,
        ids.channelA,
        scope.host,
        scope.port,
        ids.originB,
        ids.organizationB,
        ids.channelB,
      ],
    );
    await admin.query(
      `insert into widget_sessions
       (id,organization_id,channel_connection_id,widget_allowed_origin_id,status,
        contact_id,conversation_id,issued_at,last_seen_at,expires_at,revoked_at,version)
       values ($1,$2,$3,$4,'active',null,null,$5,$6,$7,null,2),
              ($8,$9,$10,$11,'active',null,null,$5,$6,$7,null,2)`,
      [
        ids.sessionA,
        ids.organizationA,
        ids.channelA,
        ids.originA,
        issuedAt,
        lastSeenAt,
        expiresAt,
        ids.sessionB,
        ids.organizationB,
        ids.channelB,
        ids.originB,
      ],
    );
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  }
};

const destroyFixture = async (admin) => {
  await admin.query("begin");
  try {
    await admin.query(
      "drop table if exists public.widget_sessions,public.widget_allowed_origins,public.channel_connections cascade",
    );
    await admin.query("drop schema if exists app cascade");
    await admin.query("drop owned by lead_agent_runtime");
    await admin.query("drop role lead_agent_runtime");
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  }
};

test(
  "real PostgreSQL selector uses corrected parameter typing, FORCE RLS and bounded rollback-only reads",
  { timeout: 45_000 },
  async (context) => {
    assert.deepEqual(selectionForceRlsTableNames, [
      "widget_sessions",
      "widget_allowed_origins",
      "channel_connections",
    ]);
    assert.equal(
      selectionForceRlsSql,
      `${oldSelectionForceRlsSql} and $1::uuid is not null`,
      "the regression must exercise the exported fixed SQL without a local substitute",
    );
    assert.match(
      runReadOnlySelection.toString(),
      /current_database\(\)='lead_agent_staging'/u,
      "the production full-run staging database guard must remain intact",
    );

    const now = Date.now();
    const scope = parseSelectionScope({
      origin: "https://selector-fixture.cloudshell.dev",
      from: new Date(now - 60_000).toISOString(),
      until: new Date(now + 240_000).toISOString(),
    });
    const issuedAt = new Date(now - 20_000);
    const lastSeenAt = new Date(now - 10_000);
    const expiresAt = new Date(now + 7_200_000);
    const admin = clientFor(adminUrl, "s22-widget-selector-fixture-admin");
    let adminConnected = false;
    let runtime;
    let fixtureCreated = false;
    let rollbacks = 0;
    try {
      await admin.connect();
      adminConnected = true;
      await configureTimeouts(admin);
      const identity = (
        await admin.query(
          `select current_database() as database,current_user,
           (select rolsuper from pg_catalog.pg_roles where rolname=current_user) as superuser`,
        )
      ).rows[0];
      assert.equal(identity.database, databaseName);
      assert.equal(identity.superuser, true, "fixture setup requires the disposable service owner");
      const serverVersion = Number(
        (await admin.query("show server_version_num")).rows[0].server_version_num,
      );
      assert.ok(
        serverVersion >= 170_000 && serverVersion < 180_000,
        "selector proof requires PostgreSQL major 17",
      );
      assert.deepEqual(await userObjects(admin), [], "selector database must start empty");
      assert.equal(
        (
          await admin.query(
            "select count(*)::integer as count from pg_catalog.pg_roles where rolname=$1",
            [runtimeRole],
          )
        ).rows[0].count,
        0,
        "the fixture must not reuse a cluster runtime role",
      );

      await createFixture(admin, scope, issuedAt, lastSeenAt, expiresAt);
      fixtureCreated = true;
      runtime = clientFor(runtimeUrl, "s22-widget-selector-runtime-proof");
      await runtime.connect();
      await configureTimeouts(runtime);
      const role = (
        await runtime.query(
          `select current_user,session_user,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole
           from pg_catalog.pg_roles where rolname=current_user`,
        )
      ).rows[0];
      assert.deepEqual(role, {
        current_user: runtimeRole,
        session_user: runtimeRole,
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });

      const withReadOnlyTenant = async (organizationId, operation) => {
        let begun = false;
        try {
          await runtime.query("begin transaction read only");
          begun = true;
          await runtime.query("set local row_security=on");
          await runtime.query("select set_config('app.organization_id',$1,true)", [organizationId]);
          const guard = (
            await runtime.query(
              `select current_setting('transaction_read_only')='on' as read_only,
               current_setting('row_security')='on' as row_security,
               current_setting('app.organization_id')=$1 as tenant_matches`,
              [organizationId],
            )
          ).rows[0];
          assert.deepEqual(guard, {
            read_only: true,
            row_security: true,
            tenant_matches: true,
          });
          const read = async (text, extra = []) =>
            (await runtime.query({ text, values: [organizationId, ...extra] })).rows;
          return await operation(read);
        } finally {
          if (begun) {
            await runtime.query("rollback");
            rollbacks++;
            const reset = await runtime.query(
              "select nullif(current_setting('app.organization_id',true),'') as organization_id",
            );
            assert.equal(reset.rows[0].organization_id, null);
          }
        }
      };

      await context.test("the exact pre-fix extended query fails with SQLSTATE 42P18", async () => {
        await assert.rejects(
          () =>
            withReadOnlyTenant(ids.organizationA, async (read) => {
              await read(oldSelectionForceRlsSql, [selectionForceRlsTableNames]);
            }),
          (error) => {
            assert.equal(error.code, "42P18");
            return true;
          },
        );
        assert.equal((await runtime.query("select 1 as usable")).rows[0].usable, 1);
      });

      await context.test(
        "the exported correction proves exactly three forced non-owned RLS tables",
        async () => {
          const rows = await withReadOnlyTenant(ids.organizationA, (read) =>
            read(selectionForceRlsSql, [selectionForceRlsTableNames]),
          );
          assert.deepEqual(rows, [{ count: 3, safe: true }]);
        },
      );

      await context.test(
        "the actual collector selects one tenant while a same-origin foreign tenant stays invisible",
        async () => {
          const reports = [];
          const observed = await withReadOnlyTenant(ids.organizationA, async (read) => {
            const selected = await collectWidgetSessionSelection(read, scope, (assertion, value) =>
              reports.push({ assertion, value }),
            );
            const visible = await read(
              "select id::text from widget_sessions where $1::uuid is not null order by id",
            );
            const foreign = await read(
              "select id::text from widget_sessions where organization_id=$2 and $1::uuid is not null",
              [ids.organizationB],
            );
            return { selected, visible, foreign };
          });
          assert.equal(observed.selected.session_id, ids.sessionA);
          assert.deepEqual(observed.visible, [{ id: ids.sessionA }]);
          assert.deepEqual(observed.foreign, []);
          assert.deepEqual(
            reports.map(({ assertion }) => assertion),
            ["exact_active_widget_origin", "fresh_unbound_widget_session"],
          );
        },
      );

      await context.test("same-tenant exact origins fail closed as ambiguous", async () => {
        await admin.query(
          "insert into channel_connections (id,organization_id,channel_type,status) values ($1,$2,'widget','active')",
          [ids.channelASecond, ids.organizationA],
        );
        await admin.query(
          `insert into widget_allowed_origins
           (id,organization_id,channel_connection_id,match_type,scheme,normalized_host,port,status)
           values ($1,$2,$3,'exact','https',$4,$5,'active')`,
          [ids.originASecond, ids.organizationA, ids.channelASecond, scope.host, scope.port],
        );
        await assert.rejects(
          () =>
            withReadOnlyTenant(ids.organizationA, (read) =>
              collectWidgetSessionSelection(read, scope, () => {}),
            ),
          { code: "EXACT_ORIGIN_AMBIGUOUS" },
        );
        await admin.query("update widget_allowed_origins set status='disabled' where id=$1", [
          ids.originASecond,
        ]);
      });

      await context.test("same-tenant fresh sessions fail closed as ambiguous", async () => {
        await admin.query(
          `insert into widget_sessions
           (id,organization_id,channel_connection_id,widget_allowed_origin_id,status,
            contact_id,conversation_id,issued_at,last_seen_at,expires_at,revoked_at,version)
           values ($1,$2,$3,$4,'active',null,null,$5,$6,$7,null,2)`,
          [
            ids.sessionASecond,
            ids.organizationA,
            ids.channelA,
            ids.originA,
            issuedAt,
            lastSeenAt,
            expiresAt,
          ],
        );
        await assert.rejects(
          () =>
            withReadOnlyTenant(ids.organizationA, (read) =>
              collectWidgetSessionSelection(read, scope, () => {}),
            ),
          { code: "FRESH_SESSION_AMBIGUOUS" },
        );
      });

      assert.equal(rollbacks, 5, "every runtime-role proof must finish with an explicit rollback");
      const fixtureCounts = (
        await admin.query(
          `select (select count(*)::integer from channel_connections) as channels,
           (select count(*)::integer from widget_allowed_origins) as origins,
           (select count(*)::integer from widget_sessions) as sessions`,
        )
      ).rows[0];
      assert.deepEqual(fixtureCounts, { channels: 3, origins: 3, sessions: 3 });
    } finally {
      try {
        if (runtime !== undefined) await runtime.end();
      } finally {
        try {
          if (fixtureCreated) {
            await destroyFixture(admin);
            assert.deepEqual(await userObjects(admin), []);
            assert.equal(
              (
                await admin.query(
                  "select count(*)::integer as count from pg_catalog.pg_roles where rolname=$1",
                  [runtimeRole],
                )
              ).rows[0].count,
              0,
            );
          }
        } finally {
          if (adminConnected) await admin.end();
        }
      }
    }
  },
);
