import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  createInstagramBusinessUseCases,
  instagramAccountRouteHash,
  instagramConversationIdentity,
  type CredentialSecretStore,
  type InstagramInboundMessage,
} from "../../packages/application/src/index.js";
import {
  ChannelConnectionIdSchema,
  OrganizationIdSchema,
  ContactIdSchema,
  isSchemaValue,
  type OrganizationId,
} from "../../packages/contracts/src/index.js";
import {
  createInstagramPersistenceStore,
  createCanonicalInboundPersistenceStore,
  createStaffConversationQueryStore,
  createThreadAutomationControlStore,
  migrationsFolder,
  runMigrations,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import { executeTenantQuery } from "../../packages/database/src/runtime/tenant.js";
import {
  ACCOUNT_ID,
  CUSTOMER_ID,
  IDS,
  NONCE,
  NOW,
  TOKEN,
  authorization,
  dataProtection,
  digest,
  instagramConfig,
} from "../instagram/fixtures.js";

type Options = Readonly<{ privilegedPool(): Pool; runtime(): TenantDatabaseRuntime }>;
const OTHER_CHANNEL = "0193f1a8-7f65-7c28-a434-000000000011";
const ROUTE_ID = "0193f1a8-7f65-7c28-a434-000000000012";
export const registerInstagramBusinessPersistenceTests = (options: Options): void => {
  const seed = async (type = "instagram") => {
    const pool = options.privilegedPool();
    await pool.query(
      "insert into organizations(id,slug,display_name,status,default_locale,default_time_zone) values($1,'ig-a','IG A','active','en','Asia/Tashkent'),($2,'ig-b','IG B','active','en','Asia/Tashkent')",
      [IDS.organization, IDS.otherOrganization],
    );
    await pool.query(
      "insert into channel_connections(id,organization_id,channel_type,status,display_name) values($1,$2,$3,'pending','IG A'),($4,$5,'instagram','pending','IG B')",
      [IDS.channel, IDS.organization, type, OTHER_CHANNEL, IDS.otherOrganization],
    );
  };
  const call = async (
    name: "create" | "rotate" | "disable",
    values: readonly unknown[],
    tenant: OrganizationId = IDS.organization,
  ) =>
    options.runtime().withTenantTransaction(tenant, async (session) => {
      const functions = {
        create: "app.create_instagram_inbound_route",
        rotate: "app.rotate_instagram_inbound_route",
        disable: "app.disable_instagram_inbound_route",
      };
      const result = await executeTenantQuery<{ changed: boolean }>(session, () => ({
        text: `select ${functions[name]}(${values.map((_value, index) => `$${index + 1}`).join(",")}) as changed`,
        values: [...values],
      }));
      return result.rows[0]?.changed;
    });
  const ingress = async (hash: Uint8Array) => {
    const client = await options.privilegedPool().connect();
    try {
      await client.query("set role lead_agent_ingress");
      return (
        await client.query<{ organization_id: string; channel_connection_id: string }>(
          "select organization_id::text,channel_connection_id::text from app.resolve_inbound_route('instagram_webhook',$1::bytea)",
          [Buffer.from(hash)],
        )
      ).rows;
    } finally {
      await client.query("reset role");
      client.release();
    }
  };
  describe("S11.B PostgreSQL 0027 narrow Instagram route security", () => {
    it("upgrades an actual S11.A database through the migration runner and reruns idempotently", async () => {
      const source = options.privilegedPool().options.connectionString;
      if (typeof source !== "string") throw new Error("Disposable migration test URL required");
      const url = new URL(source);
      if (!/test/iu.test(decodeURIComponent(url.pathname)))
        throw new Error("Migration upgrade requires test-named source database");
      const name = `test_s11b_upgrade_${randomBytes(8).toString("hex")}`;
      if (!/^test_s11b_upgrade_[a-f0-9]{16}$/u.test(name))
        throw new Error("Invalid disposable upgrade database name");
      await options.privilegedPool().query(`create database "${name}"`);
      url.pathname = `/${name}`;
      const pool = new Pool({ connectionString: url.toString(), max: 1 });
      try {
        const version = await pool.query<{ major: number }>(
          "select current_setting('server_version_num')::integer / 10000 as major",
        );
        expect(version.rows[0]?.major).toBe(17);
        const journal: unknown = JSON.parse(
          await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
        );
        if (
          typeof journal !== "object" ||
          journal === null ||
          !("entries" in journal) ||
          !Array.isArray(journal.entries)
        )
          throw new Error("Invalid migration journal");
        await pool.query(
          "create schema drizzle; create table drizzle.__drizzle_migrations(id serial primary key,hash text not null,created_at bigint)",
        );
        const entries: readonly unknown[] = journal.entries;
        for (const entry of entries.slice(0, 27)) {
          if (
            typeof entry !== "object" ||
            entry === null ||
            !("tag" in entry) ||
            typeof entry.tag !== "string" ||
            !/^00[0-2][0-9]_[a-z0-9_]+$/u.test(entry.tag) ||
            !("when" in entry) ||
            typeof entry.when !== "number"
          )
            throw new Error("Invalid historical migration identity");
          const sql = await readFile(join(migrationsFolder, `${entry.tag}.sql`), "utf8");
          await pool.query("begin");
          try {
            for (const statement of sql
              .split("--> statement-breakpoint")
              .map((value) => value.trim())
              .filter(Boolean))
              await pool.query(statement);
            await pool.query(
              "insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)",
              [createHash("sha256").update(sql).digest("hex"), entry.when],
            );
            await pool.query("commit");
          } catch (error) {
            await pool.query("rollback");
            throw error;
          }
        }
        const tables = async () =>
          (
            await pool.query<{ count: number }>(
              "select count(*)::integer as count from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
            )
          ).rows[0]?.count;
        expect(await tables()).toBe(51);
        const identityCheck = async () =>
          (
            await pool.query<{ definition: string }>(
              "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.contact_identities'::regclass and conname='contact_identities_identity_type_check'",
            )
          ).rows[0]?.definition;
        expect(await identityCheck()).not.toContain("instagram_user");
        await runMigrations(pool);
        expect(await identityCheck()).toContain("instagram_user");
        expect(await tables()).toBe(52);
        await runMigrations(pool);
        expect(
          (
            await pool.query<{ count: number }>(
              "select count(*)::integer as count from drizzle.__drizzle_migrations",
            )
          ).rows[0]?.count,
        ).toBe(30);
      } finally {
        await pool.end();
        await options.privilegedPool().query(`drop database "${name}"`);
      }
    }, 120000);
    it("creates an exact pending route, repeats safely, and prevents global hash theft", async () => {
      await seed();
      const hash = digest(NONCE);
      expect(await call("create", [ROUTE_ID, IDS.channel, hash])).toBe(true);
      expect(await call("create", [ROUTE_ID, IDS.channel, hash])).toBe(true);
      expect(await ingress(hash)).toEqual([
        { organization_id: IDS.organization, channel_connection_id: IDS.channel },
      ]);
      expect(await call("create", [IDS.message, OTHER_CHANNEL, hash], IDS.otherOrganization)).toBe(
        false,
      );
    });
    it.each(["telegram", "widget", "whatsapp"])(
      "denies wrong channel %s without weakening its routing",
      async (type) => {
        await seed(type);
        expect(await call("create", [ROUTE_ID, IDS.channel, digest(NONCE)])).toBe(false);
      },
    );
    it("rejects malformed hashes, unknown channels and cross-tenant mutation", async () => {
      await seed();
      for (const hash of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33), null])
        expect(await call("create", [ROUTE_ID, IDS.channel, hash])).toBe(false);
      expect(await call("create", [ROUTE_ID, OTHER_CHANNEL, digest(NONCE)])).toBe(false);
      expect(await call("create", [ROUTE_ID, IDS.message, digest(NONCE)])).toBe(false);
      expect(await call("disable", [OTHER_CHANNEL])).toBe(false);
    });
    it("has one concurrent CAS winner, invalidates old lookups, and disables without deleting history", async () => {
      await seed();
      const state = digest(NONCE);
      await call("create", [ROUTE_ID, IDS.channel, state]);
      const hashes = [instagramAccountRouteHash(ACCOUNT_ID), instagramAccountRouteHash("111")];
      const results = await Promise.all(
        hashes.map((hash) => call("rotate", [IDS.channel, state, hash])),
      );
      expect([...results].sort()).toEqual([false, true]);
      expect(await ingress(state)).toEqual([]);
      expect(await call("rotate", [IDS.channel, state, Buffer.alloc(32, 3)])).toBe(false);
      expect(await call("disable", [IDS.channel])).toBe(true);
      expect(await call("disable", [IDS.channel])).toBe(true);
      for (const hash of hashes) expect(await ingress(hash)).toEqual([]);
      expect(
        (
          await options
            .privilegedPool()
            .query("select status from inbound_routes where id=$1", [ROUTE_ID])
        ).rows,
      ).toEqual([{ status: "disabled" }]);
    });
    it("fails closed without context and retains owner, grants and FORCE RLS", async () => {
      await seed();
      const client = await options.privilegedPool().connect();
      try {
        await client.query("set role lead_agent_runtime");
        await client.query("begin");
        await client.query("select set_config('app.organization_id','',true)");
        expect(
          (
            await client.query<{ changed: boolean }>(
              "select app.create_instagram_inbound_route($1,$2,$3::bytea) as changed",
              [ROUTE_ID, IDS.channel, Buffer.from(digest(NONCE))],
            )
          ).rows[0]?.changed,
        ).toBe(false);
      } finally {
        await client.query("rollback");
        await client.query("reset role");
        client.release();
      }
      const permissions = await options
        .privilegedPool()
        .query<{ runtime: boolean; ingress: boolean; owner: string; search_path: string[] }>(
          "select has_function_privilege('lead_agent_runtime',p.oid,'EXECUTE') as runtime,has_function_privilege('lead_agent_ingress',p.oid,'EXECUTE') as ingress,pg_get_userbyid(p.proowner) as owner,p.proconfig as search_path from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname in('create_instagram_inbound_route','rotate_instagram_inbound_route','disable_instagram_inbound_route')",
        );
      expect(permissions.rows).toHaveLength(3);
      for (const row of permissions.rows)
        expect(row).toMatchObject({
          runtime: true,
          ingress: false,
          owner: "lead_agent_inbound_route_definer",
          search_path: ["search_path=pg_catalog"],
        });
      expect(
        (
          await options
            .privilegedPool()
            .query(
              "select relrowsecurity,relforcerowsecurity from pg_class where oid='public.contact_identities'::regclass",
            )
        ).rows[0],
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });
  const contactFixture = async () => {
    await seed();
    await options
      .privilegedPool()
      .query(
        "insert into contacts(id,organization_id,status,first_seen_at,last_seen_at) values($1,$2,'active',$5,$5),($3,$4,'active',$5,$5)",
        [IDS.contact, IDS.organization, IDS.conversation, IDS.otherOrganization, NOW],
      );
  };
  const identity = (
    type: string,
    id: string = IDS.message,
    organization: string = IDS.organization,
    contact: string = IDS.contact,
    channel: string | null = IDS.channel,
  ) =>
    options
      .privilegedPool()
      .query(
        "insert into contact_identities(id,organization_id,contact_id,channel_connection_id,identity_type,lookup_hash,value_ciphertext,hash_key_version,validation_status,status,verified_at) values($1,$2,$3,$4,$5,$6,$7,1,'verified','active',$8)",
        [
          id,
          organization,
          contact,
          channel,
          type,
          Buffer.from(digest(CUSTOMER_ID)),
          Buffer.from(
            dataProtection.protectContactIdentity({
              organizationId: IDS.organization,
              channelConnectionId: IDS.channel,
              identityType: "instagram_user",
              value: CUSTOMER_ID,
            }),
          ),
          NOW,
        ],
      );
  describe("S11.B protected tenant/channel Instagram identity schema", () => {
    it.each(["instagram_user", "telegram_user", "widget_participant", "phone", "email"])(
      "retains approved identity vocabulary %s",
      async (type) => {
        await contactFixture();
        await identity(type);
        expect(
          (await options.privilegedPool().query("select identity_type from contact_identities"))
            .rows,
        ).toEqual([{ identity_type: type }]);
      },
    );
    it("rejects unknown vocabulary, missing Instagram channel and foreign tenant channels", async () => {
      await contactFixture();
      await expect(identity("arbitrary")).rejects.toMatchObject({ code: "23514" });
      await expect(
        identity("instagram_user", IDS.message, IDS.organization, IDS.contact, null),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        identity("instagram_user", IDS.message, IDS.organization, IDS.contact, OTHER_CHANNEL),
      ).rejects.toMatchObject({ code: "23503" });
    });
    it("preserves exact same-channel uniqueness, while distinct tenants and channels do not collide", async () => {
      await contactFixture();
      await identity("instagram_user");
      await expect(identity("instagram_user", IDS.lead)).rejects.toMatchObject({ code: "23505" });
      await identity(
        "instagram_user",
        IDS.lead,
        IDS.otherOrganization,
        IDS.conversation,
        OTHER_CHANNEL,
      );
      await options
        .privilegedPool()
        .query(
          "insert into channel_connections(id,organization_id,channel_type,status,display_name) values($1,$2,'instagram','pending','IG second')",
          [IDS.membership, IDS.organization],
        );
      await identity("instagram_user", IDS.user, IDS.organization, IDS.contact, IDS.membership);
      const rows = await options
        .privilegedPool()
        .query<{ value_ciphertext: Buffer; lookup_hash: Buffer }>(
          "select value_ciphertext,lookup_hash from contact_identities",
        );
      expect(rows.rows).toHaveLength(3);
      for (const row of rows.rows) {
        expect(row.value_ciphertext.toString()).not.toContain(CUSTOMER_ID);
        expect(row.lookup_hash.toString()).not.toContain(CUSTOMER_ID);
      }
    });
  });
  const boundFixture = async () => {
    await seed();
    const pool = options.privilegedPool();
    await pool.query(
      "insert into users(id,email_ciphertext,email_lookup_hash,display_name_ciphertext,status) values($1,$2,$3,$2,'active')",
      [IDS.user, Buffer.from("synthetic"), Buffer.alloc(32, 93)],
    );
    await pool.query(
      "insert into memberships(id,organization_id,user_id,role,status,location_scope,activated_at) values($1,$2,$3,'owner','active','all',$4)",
      [IDS.membership, IDS.organization, IDS.user, NOW],
    );
    const values = new Map<string, string>();
    const credentials: CredentialSecretStore = {
      put: (value) => {
        const ref = "testsecret://instagram/1";
        values.set(ref, value);
        return Promise.resolve(ref);
      },
      get: (ref) => Promise.resolve(values.get(ref) ?? null),
      delete: (ref) => {
        values.delete(ref);
        return Promise.resolve();
      },
    };
    const useCases = createInstagramBusinessUseCases({
      appId: instagramConfig.appId,
      oauthRedirectUri: instagramConfig.oauthRedirectUri,
      clock: () => NOW,
      randomState: () => NONCE,
      dataProtector: dataProtection,
      eligibilityStore: createThreadAutomationControlStore(options.runtime()),
      canonicalStore: createCanonicalInboundPersistenceStore(options.runtime()),
      persistence: createInstagramPersistenceStore(options.runtime()),
      credentials,
      oauth: {
        exchangeCode: () =>
          Promise.resolve({ accountId: ACCOUNT_ID, token: TOKEN, expiresInSeconds: 5184000 }),
        subscribeMessages: () => Promise.resolve(),
        refreshToken: () => Promise.reject(new Error("Not used")),
      },
      routeResolver: {
        resolveInboundRoute: async (_type, hash) => {
          const row = (await ingress(hash))[0];
          if (row === undefined) return null;
          if (
            !isSchemaValue(ChannelConnectionIdSchema, row.channel_connection_id) ||
            !isSchemaValue(OrganizationIdSchema, row.organization_id)
          )
            throw new Error("Invalid trusted Instagram route");
          return {
            channelConnectionId: row.channel_connection_id,
            organizationId: row.organization_id,
          };
        },
      },
    });
    await useCases.beginOnboarding({
      authorization: await authorization(),
      displayName: "Instagram Professional",
    });
    await useCases.completeOnboarding({ code: "synthetic-code", state: NONCE });
    const activeChannelValue = (
      await pool.query<{ id: unknown }>(
        `select id::text as id from channel_connections
          where organization_id=$1 and channel_type='instagram' and status='active'`,
        [IDS.organization],
      )
    ).rows[0]?.id;
    if (!isSchemaValue(ChannelConnectionIdSchema, activeChannelValue)) {
      throw new Error("Missing active Instagram fixture channel");
    }
    const activeChannel = activeChannelValue;
    const threadHash = dataProtection.threadHash({
      channelConnectionId: activeChannel,
      externalConversationId: instagramConversationIdentity(ACCOUNT_ID, CUSTOMER_ID),
      organizationId: IDS.organization,
    });
    await pool.query(
      `insert into thread_automation_controls
       (id,organization_id,channel_connection_id,external_thread_hash,eligibility_state,
        decision_source,reason_code,version,created_at,updated_at)
       values($1,$2,$3,$4,'business_eligible','platform_policy','verified_test_business_thread',1,$5,$5)`,
      [IDS.control, IDS.organization, activeChannel, Buffer.from(threadHash), NOW],
    );
    return { pool, useCases };
  };
  const incoming: InstagramInboundMessage = {
    accountId: ACCOUNT_ID,
    customerId: CUSTOMER_ID,
    messageId: "mid.synthetic",
    occurredAt: NOW.toISOString(),
    content: { type: "text", text: "Salom" },
  };
  describe("S11.B real canonical Instagram atomic persistence", () => {
    it("deduplicates concurrent mids, reuses active grouping and does not regress reordered activity", async () => {
      const { pool, useCases } = await boundFixture();
      expect(
        (await Promise.all([useCases.processMessage(incoming), useCases.processMessage(incoming)]))
          .map((result) => result.status)
          .sort(),
      ).toEqual(["accepted", "duplicate"]);
      await useCases.processMessage({
        ...incoming,
        messageId: "mid.older",
        occurredAt: new Date(NOW.getTime() - 60000).toISOString(),
      });
      for (const table of ["contacts", "leads", "conversations"])
        expect(
          (
            await pool.query<{ count: number }>(
              `select count(*)::int as count from ${table} where organization_id=$1`,
              [IDS.organization],
            )
          ).rows[0]?.count,
        ).toBe(1);
      expect(
        (
          await pool.query<{ count: number }>(
            "select count(*)::int as count from messages where organization_id=$1",
            [IDS.organization],
          )
        ).rows[0]?.count,
      ).toBe(2);
      expect(
        (
          await pool.query<{ last_activity_at: Date }>(
            "select last_activity_at from conversations where organization_id=$1",
            [IDS.organization],
          )
        ).rows[0]?.last_activity_at,
      ).toEqual(NOW);
      const events = await pool.query(
        "select event_type,schema_version,payload_jsonb from outbox_events where event_type='contact.identity_added'",
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]).toMatchObject({
        event_type: "contact.identity_added",
        schema_version: "2",
        payload_jsonb: {
          schema_id: "ContactIdentityAddedDomainEvent.v2",
          schema_version: "2",
          payload: { identity_type: "instagram_user" },
        },
      });
      expect(JSON.stringify(events.rows)).not.toContain(CUSTOMER_ID);
      expect(
        (
          await pool.query<{ count: number }>(
            "select count(*)::int as count from audit_events where organization_id=$1",
            [IDS.organization],
          )
        ).rows[0]?.count,
      ).toBeGreaterThan(0);
      expect(
        (await pool.query("select * from contact_identities where identity_type='phone'")).rows,
      ).toHaveLength(0);
      const contact = (
        await pool.query<{ id: string }>("select id::text from contacts where organization_id=$1", [
          IDS.organization,
        ])
      ).rows[0]?.id;
      if (!isSchemaValue(ContactIdSchema, contact)) throw new Error("Invalid persisted contact");
      const queryStore = createStaffConversationQueryStore(options.runtime());
      expect(
        (await queryStore.getContact({ authorization: await authorization(), contactId: contact }))
          ?.identities[0]?.identity_type,
      ).toBe("instagram_user");
    });
    it.each(["resolved", "closed"])(
      "preserves %s history and creates only a new distinct-message cycle",
      async (status) => {
        const { pool, useCases } = await boundFixture();
        await useCases.processMessage(incoming);
        const first = (
          await pool.query<{ id: string }>(
            "select id::text from conversations where organization_id=$1",
            [IDS.organization],
          )
        ).rows[0]?.id;
        await pool.query(
          "update conversations set status=$1::text,automation_mode='paused',resolved_at=last_activity_at,closed_at=case when $1::text='closed' then last_activity_at else null end where id=$2",
          [status, first],
        );
        expect(await useCases.processMessage(incoming)).toEqual({ status: "duplicate" });
        await useCases.processMessage({ ...incoming, messageId: "mid.next" });
        expect(
          (
            await pool.query<{ status: string }>("select status from conversations where id=$1", [
              first,
            ])
          ).rows[0]?.status,
        ).toBe(status);
        expect(
          (
            await pool.query("select id from conversations where organization_id=$1", [
              IDS.organization,
            ])
          ).rows,
        ).toHaveLength(2);
      },
    );
    it("rejects channel-type mismatch and rolls back all business/audit/outbox writes", async () => {
      const { pool, useCases } = await boundFixture();
      await pool.query(
        "update channel_connections set channel_type='telegram' where status='active' and organization_id=$1",
        [IDS.organization],
      );
      expect(await useCases.processMessage(incoming)).toEqual({ status: "ignored" });
      for (const table of ["contacts", "leads", "conversations", "messages", "outbox_events"])
        expect((await pool.query(`select id from ${table}`)).rows).toHaveLength(0);
    });
  });
};
