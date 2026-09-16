import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import {
  createTelegramBusinessUseCases,
  type TelegramNormalizedUpdate,
} from "../../packages/application/src/index.js";
import {
  createCanonicalInboundPersistenceStore,
  createTelegramPersistenceStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import { executeTenantQuery } from "../../packages/database/src/runtime/tenant.js";
import { normalizeTelegramUpdate } from "../../packages/integrations/src/telegram/normalizer.js";
import {
  ChannelConnectionIdSchema,
  isSchemaValue,
  type OrganizationId,
} from "../../packages/contracts/src/index.js";
import {
  authorization,
  businessMessage,
  dataProtection,
  digest,
  IDS,
  NONCE,
  NOW,
} from "../telegram/fixtures.js";

type Options = Readonly<{ privilegedPool(): Pool; runtime(): TenantDatabaseRuntime }>;
const OTHER_CHANNEL = "0193f1a8-7f65-7c28-a434-000000000011";
const ROUTE_ID = "0193f1a8-7f65-7c28-a434-000000000012";
const hash = Buffer.from(digest(NONCE));
export const registerTelegramBusinessPersistenceTests = (options: Options): void => {
  const seed = async (type = "telegram", status = "pending") => {
    const pool = options.privilegedPool();
    await pool.query(
      `insert into organizations (id,slug,display_name,status,default_locale,default_time_zone) values ($1,'s11-a','S11 A','active','en','Asia/Tashkent'),($2,'s11-b','S11 B','active','en','Asia/Tashkent')`,
      [IDS.organization, IDS.otherOrganization],
    );
    await pool.query(
      `insert into channel_connections (id,organization_id,channel_type,status,display_name) values ($1,$2,$3,$4,'S11 connection'),($5,$6,'telegram','pending','S11 other')`,
      [IDS.channel, IDS.organization, type, status, OTHER_CHANNEL, IDS.otherOrganization],
    );
  };
  const call = async (
    name: "create" | "rotate" | "disable",
    values: readonly unknown[],
    tenant: OrganizationId = IDS.organization,
  ) =>
    options.runtime().withTenantTransaction(tenant, async (session) => {
      const placeholders = values.map((_value, index) => `$${index + 1}`).join(",");
      const functions = {
        create: "app.create_telegram_inbound_route",
        rotate: "app.rotate_telegram_inbound_route",
        disable: "app.disable_telegram_inbound_route",
      };
      const result = await executeTenantQuery<{ changed: boolean }>(session, () => ({
        text: `select ${functions[name]}(${placeholders}) as changed`,
        values: [...values],
      }));
      return result.rows[0]?.changed;
    });
  const create = (routeHash = hash, channelId = IDS.channel) =>
    call("create", [ROUTE_ID, channelId, routeHash]);
  const ingress = async (routeHash: Uint8Array) => {
    const client = await options.privilegedPool().connect();
    try {
      await client.query("set role lead_agent_ingress");
      const result = await client.query<{ organization_id: string; channel_connection_id: string }>(
        "select organization_id::text, channel_connection_id::text from app.resolve_inbound_route('telegram_webhook', $1::bytea)",
        [Buffer.from(routeHash)],
      );
      return result.rows;
    } finally {
      await client.query("reset role");
      client.release();
    }
  };
  const roleCall = async (callback: (client: PoolClient) => Promise<void>) => {
    const client = await options.privilegedPool().connect();
    try {
      await client.query("set role lead_agent_runtime");
      await client.query("begin");
      await client.query("select set_config('app.organization_id', '', true)");
      await callback(client);
    } finally {
      await client.query("rollback");
      await client.query("reset role");
      client.release();
    }
  };
  describe("S11.A migration 0026 Telegram controlled route management", () => {
    it("creates an exact pending tenant Telegram route with safe idempotency", async () => {
      await seed();
      expect(await create()).toBe(true);
      expect(await create()).toBe(true);
      expect(await ingress(hash)).toEqual([
        { organization_id: IDS.organization, channel_connection_id: IDS.channel },
      ]);
      expect(await create(Buffer.alloc(32, 88))).toBe(false);
      expect(await call("create", [IDS.message, IDS.channel, Buffer.alloc(32, 89)])).toBe(false);
      expect(await ingress(hash)).toHaveLength(1);
    });
    it.each(["widget", "instagram", "whatsapp"])("denies initial %s routes", async (type) => {
      await seed(type);
      expect(await create()).toBe(false);
    });
    it.each(["active", "disabled", "revoked"])(
      "denies non-onboarding %s initial creation",
      async (status) => {
        await seed("telegram", status);
        expect(await create()).toBe(false);
      },
    );
    it("denies cross-tenant/nonexistent connections and malformed hashes", async () => {
      await seed();
      expect(await call("create", [ROUTE_ID, OTHER_CHANNEL, hash])).toBe(false);
      expect(await call("create", [ROUTE_ID, IDS.message, hash])).toBe(false);
      for (const bytes of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33), null])
        expect(await call("create", [ROUTE_ID, IDS.channel, bytes])).toBe(false);
    });
    it("fails closed for missing tenant context on every function", async () => {
      await seed();
      await roleCall(async (client) => {
        expect(
          (
            await client.query<{ changed: boolean }>(
              "select app.create_telegram_inbound_route($1,$2,$3::bytea) as changed",
              [ROUTE_ID, IDS.channel, hash],
            )
          ).rows[0]?.changed,
        ).toBe(false);
        expect(
          (
            await client.query<{ changed: boolean }>(
              "select app.rotate_telegram_inbound_route($1::uuid,$2::bytea,$3::bytea) as changed",
              [IDS.channel, hash, Buffer.alloc(32, 4)],
            )
          ).rows[0]?.changed,
        ).toBe(false);
        expect(
          (
            await client.query<{ changed: boolean }>(
              "select app.disable_telegram_inbound_route($1) as changed",
              [IDS.channel],
            )
          ).rows[0]?.changed,
        ).toBe(false);
      });
    });
    it("rotates nonce → owner → business with stale CAS denial and old lookup disappearance", async () => {
      await seed();
      await create();
      const owner = Buffer.alloc(32, 3);
      const connection = Buffer.alloc(32, 4);
      expect(await call("rotate", [IDS.channel, hash, owner])).toBe(true);
      expect(await ingress(hash)).toEqual([]);
      expect(await ingress(owner)).toHaveLength(1);
      expect(await call("rotate", [IDS.channel, hash, connection])).toBe(false);
      expect(await call("rotate", [IDS.channel, owner, connection])).toBe(true);
      expect(await ingress(owner)).toEqual([]);
      expect(await ingress(connection)).toHaveLength(1);
      expect(await call("rotate", [IDS.channel, connection, connection])).toBe(false);
      expect(await call("rotate", [IDS.channel, connection, Buffer.alloc(31)])).toBe(false);
    });
    it("allows exactly one concurrent CAS winner", async () => {
      await seed();
      await create();
      expect(
        (
          await Promise.all([
            call("rotate", [IDS.channel, hash, Buffer.alloc(32, 5)]),
            call("rotate", [IDS.channel, hash, Buffer.alloc(32, 6)]),
          ])
        ).sort(),
      ).toEqual([false, true]);
    });
    it("does not steal global hashes or rotate/disable other tenants", async () => {
      await seed();
      await create();
      const otherHash = Buffer.alloc(32, 7);
      expect(await call("create", [IDS.message, OTHER_CHANNEL, hash], IDS.otherOrganization)).toBe(
        false,
      );
      expect(
        await call("create", [IDS.message, OTHER_CHANNEL, otherHash], IDS.otherOrganization),
      ).toBe(true);
      expect(await call("rotate", [IDS.channel, hash, otherHash])).toBe(false);
      expect(await call("rotate", [OTHER_CHANNEL, otherHash, Buffer.alloc(32, 8)])).toBe(false);
      expect(await call("disable", [OTHER_CHANNEL])).toBe(false);
      expect(await ingress(otherHash)).toHaveLength(1);
    });
    it("cannot rotate a wrong-channel route", async () => {
      await seed("widget");
      await options
        .privilegedPool()
        .query(
          "insert into inbound_routes(id,organization_id,channel_connection_id,route_type,route_key_hash,status) values($1,$2,$3,'widget_key',$4,'active')",
          [ROUTE_ID, IDS.organization, IDS.channel, hash],
        );
      expect(await call("rotate", [IDS.channel, hash, Buffer.alloc(32, 9)])).toBe(false);
      expect(await call("disable", [IDS.channel])).toBe(false);
      expect(
        (
          await options
            .privilegedPool()
            .query("select * from app.resolve_inbound_route('widget_key',$1::bytea)", [hash])
        ).rows,
      ).toHaveLength(1);
    });
    it("disables without deleting history and safely repeats", async () => {
      await seed();
      await create();
      expect(await call("disable", [IDS.channel])).toBe(true);
      expect(await call("disable", [IDS.channel])).toBe(true);
      expect(await ingress(hash)).toEqual([]);
      const disabledRoute = (
        await options
          .privilegedPool()
          .query<{ status: string; rotated_at: Date | null }>(
            "select status,rotated_at from inbound_routes where id=$1",
            [ROUTE_ID],
          )
      ).rows[0];
      expect(disabledRoute?.status).toBe("disabled");
      expect(disabledRoute?.rotated_at).toBeInstanceOf(Date);
    });
    it("keeps EXECUTE-only runtime authority, ingress lookup-only, and NOLOGIN ownership", async () => {
      const pool = options.privilegedPool();
      const functions = [
        "app.create_telegram_inbound_route(uuid,uuid,bytea)",
        "app.rotate_telegram_inbound_route(uuid,bytea,bytea)",
        "app.disable_telegram_inbound_route(uuid)",
      ];
      for (const signature of functions) {
        const result = await pool.query(
          "select p.prosecdef, p.proconfig, r.rolname, r.rolcanlogin, has_function_privilege('lead_agent_runtime',p.oid,'EXECUTE') as runtime_execute, has_function_privilege('lead_agent_ingress',p.oid,'EXECUTE') as ingress_execute, exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=$1::regprocedure",
          [signature],
        );
        expect(result.rows[0]).toMatchObject({
          prosecdef: true,
          proconfig: ["search_path=pg_catalog"],
          rolname: "lead_agent_inbound_route_definer",
          rolcanlogin: false,
          runtime_execute: true,
          ingress_execute: false,
          public_execute: false,
        });
      }
      for (const role of ["lead_agent_runtime", "lead_agent_ingress"])
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect(
            (
              await pool.query<{ allowed: boolean }>(
                "select has_table_privilege($1,'public.inbound_routes',$2) as allowed",
                [role, privilege],
              )
            ).rows[0]?.allowed,
          ).toBe(false);
      expect(
        (
          await pool.query(
            "select relrowsecurity,relforcerowsecurity from pg_class where oid='public.inbound_routes'::regclass",
          )
        ).rows[0],
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });
  const boundFixture = async () => {
    await seed();
    const pool = options.privilegedPool();
    await pool.query("delete from channel_connections where id=$1", [IDS.channel]);
    await pool.query(
      "insert into users(id,email_ciphertext,email_lookup_hash,display_name_ciphertext,status) values($1,$2,$3,$4,'active')",
      [IDS.user, Buffer.from("synthetic"), Buffer.alloc(32, 90), Buffer.from("synthetic")],
    );
    await pool.query(
      "insert into memberships(id,organization_id,user_id,role,status,location_scope,activated_at) values($1,$2,$3,'owner','active','all',$4)",
      [IDS.membership, IDS.organization, IDS.user, NOW],
    );
    const persistence = createTelegramPersistenceStore(options.runtime());
    const useCases = createTelegramBusinessUseCases({
      botUsername: "SyntheticBusinessBot",
      callbackAcknowledger: { answerCallbackQuery: () => Promise.resolve() },
      canonicalStore: createCanonicalInboundPersistenceStore(options.runtime()),
      clock: () => NOW,
      dataProtector: dataProtection,
      persistence,
      platformProvisioner: { ensureWebhook: () => Promise.resolve() },
      randomNonce: () => NONCE,
      routeResolver: {
        resolveInboundRoute: async (_type, routeHash) => {
          const rows = await ingress(routeHash);
          const row = rows[0];
          if (row === undefined) return null;
          // All identifiers are generated by the database and verified against the fixture's tenant.
          const connection = await pool.query<{ id: string }>(
            "select id::text from channel_connections where id=$1 and organization_id=$2",
            [row.channel_connection_id, IDS.organization],
          );
          const value = connection.rows[0]?.id;
          if (!isSchemaValue(ChannelConnectionIdSchema, value))
            throw new Error("Invalid Telegram route fixture");
          return { channelConnectionId: value, organizationId: IDS.organization };
        },
      },
    });
    await useCases.beginOnboarding({
      authorization: await authorization(),
      displayName: "Business DM",
    });
    await useCases.processUpdate({
      kind: "onboarding_start",
      nonce: NONCE,
      ownerUserId: "456",
      updateId: "1",
    });
    await useCases.processUpdate({
      kind: "business_connection",
      businessConnectionId: "business-test-1",
      ownerUserId: "456",
      canReply: true,
      isEnabled: true,
      establishedAt: NOW.toISOString(),
      updateId: "2",
    });
    return { pool, useCases };
  };
  describe("S11.A real Telegram canonical persistence", () => {
    it.each(["resolved", "closed"])(
      "preserves %s history and creates a new conversation cycle without phone",
      async (status) => {
        const { pool, useCases } = await boundFixture();
        await useCases.processUpdate(normalizeTelegramUpdate(businessMessage(), NOW));
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
        await useCases.processUpdate(
          normalizeTelegramUpdate({ ...businessMessage({ message_id: 8 }), update_id: 101 }, NOW),
        );
        expect(
          (
            await pool.query<{ status: string }>("select status from conversations where id=$1", [
              first,
            ])
          ).rows[0]?.status,
        ).toBe(status);
        expect(
          (
            await pool.query("select * from conversations where organization_id=$1", [
              IDS.organization,
            ])
          ).rows,
        ).toHaveLength(2);
        expect(
          (await pool.query("select * from contact_identities where identity_type='phone'")).rows,
        ).toHaveLength(0);
      },
    );
    it("handles concurrent duplicates, active reuse and reordered distinct customer messages atomically", async () => {
      const { pool, useCases } = await boundFixture();
      const incoming: TelegramNormalizedUpdate = normalizeTelegramUpdate(businessMessage(), NOW);
      expect(
        (await Promise.all([useCases.processUpdate(incoming), useCases.processUpdate(incoming)]))
          .map((result) => result.status)
          .sort(),
      ).toEqual(["accepted", "duplicate"]);
      await useCases.processUpdate(
        normalizeTelegramUpdate(
          { ...businessMessage({ message_id: 8, date: NOW.getTime() / 1000 - 60 }), update_id: 99 },
          NOW,
        ),
      );
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
      expect(
        (
          await pool.query<{ count: number }>(
            "select count(*)::int as count from audit_events where organization_id=$1",
            [IDS.organization],
          )
        ).rows[0]?.count,
      ).toBeGreaterThan(0);
      expect(
        (
          await pool.query<{ count: number }>(
            "select count(*)::int as count from outbox_events where organization_id=$1",
            [IDS.organization],
          )
        ).rows[0]?.count,
      ).toBeGreaterThan(0);
    });
  });
};
