import type { Pool, PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

const INGRESS_ROLE = "lead_agent_ingress";
const RUNTIME_ROLE = "lead_agent_runtime";
const DEFINER_ROLE = "lead_agent_inbound_route_definer";
const RESOLVER_SIGNATURE = "app.resolve_inbound_route(character varying,bytea)";

type ResolverRole = typeof INGRESS_ROLE | typeof RUNTIME_ROLE;

type ResolverFixtures = Readonly<{
  channelA: string;
  channelB: string;
  organizationA: string;
  organizationB: string;
  routeHashA: string;
  routeHashB: string;
  routeHashDisabled: string;
}>;

type InboundRouteResolverHarness = Readonly<{
  fixtures: ResolverFixtures;
  privilegedPool: () => Pool;
  seed: () => Promise<void>;
}>;

type ResolvedRouteRow = Readonly<{
  channel_connection_id: string;
  organization_id: string;
}>;

const withRole = async <Result>(
  pool: Pool,
  role: ResolverRole,
  callback: (client: PoolClient) => Promise<Result>,
): Promise<Result> => {
  const client = await pool.connect();
  try {
    if (role === INGRESS_ROLE) {
      await client.query("set role lead_agent_ingress");
    } else {
      await client.query("set role lead_agent_runtime");
    }
    return await callback(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query("reset role");
    client.release();
  }
};

const resolveAsIngress = async (
  pool: Pool,
  routeType: string | null,
  routeKeyHash: Uint8Array | null,
): Promise<ResolvedRouteRow[]> =>
  withRole(pool, INGRESS_ROLE, async (client) => {
    const result = await client.query<ResolvedRouteRow>(
      `select organization_id::text as organization_id,
              channel_connection_id::text as channel_connection_id
         from app.resolve_inbound_route($1::varchar, $2::bytea)`,
      [routeType, routeKeyHash],
    );
    return result.rows;
  });

const byteHash = (value: string): Buffer => Buffer.from(value, "utf8");

export const registerInboundRouteResolverTests = (harness: InboundRouteResolverHarness): void => {
  describe("S5.6 narrow pre-tenant inbound route resolver", () => {
    it("installs the exact hardened function contract and dedicated owner", async () => {
      const contract = await harness.privilegedPool().query<{
        argument_types: string;
        can_ingress_execute: boolean;
        can_runtime_execute: boolean;
        owner_name: string;
        parallel_safety: string;
        proconfig: string[] | null;
        public_execute_revoked: boolean;
        result_type: string;
        security_definer: boolean;
        strict_inputs: boolean;
        volatility: string;
      }>(
        `select pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
                p.prosecdef as security_definer,
                p.proisstrict as strict_inputs,
                p.provolatile as volatility,
                p.proparallel as parallel_safety,
                p.proconfig,
                pg_catalog.pg_get_function_identity_arguments(p.oid) as argument_types,
                pg_catalog.pg_get_function_result(p.oid) as result_type,
                pg_catalog.has_function_privilege($1, p.oid, 'EXECUTE') as can_ingress_execute,
                pg_catalog.has_function_privilege($2, p.oid, 'EXECUTE') as can_runtime_execute,
                not exists (
                  select 1
                    from pg_catalog.aclexplode(
                      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
                    ) as function_acl
                   where function_acl.grantee = 0
                     and function_acl.privilege_type = 'EXECUTE'
                ) as public_execute_revoked
           from pg_catalog.pg_proc p
          where p.oid = $3::regprocedure`,
        [INGRESS_ROLE, RUNTIME_ROLE, RESOLVER_SIGNATURE],
      );

      expect(contract.rows).toEqual([
        {
          argument_types: "input_route_type character varying, input_route_key_hash bytea",
          can_ingress_execute: true,
          can_runtime_execute: false,
          owner_name: DEFINER_ROLE,
          parallel_safety: "r",
          proconfig: ["search_path=pg_catalog"],
          public_execute_revoked: true,
          result_type: "TABLE(organization_id uuid, channel_connection_id uuid)",
          security_definer: true,
          strict_inputs: true,
          volatility: "s",
        },
      ]);

      const role = await harness.privilegedPool().query<{
        ingress_can_assume: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolreplication: boolean;
        rolsuper: boolean;
        runtime_can_assume: boolean;
      }>(
        `select r.rolcanlogin, r.rolsuper, r.rolinherit, r.rolcreatedb,
                r.rolcreaterole, r.rolreplication, r.rolbypassrls,
                pg_catalog.pg_has_role($1, r.oid, 'MEMBER') as ingress_can_assume,
                pg_catalog.pg_has_role($2, r.oid, 'MEMBER') as runtime_can_assume
           from pg_catalog.pg_roles r
          where r.rolname = $3`,
        [INGRESS_ROLE, RUNTIME_ROLE, DEFINER_ROLE],
      );
      expect(role.rows).toEqual([
        {
          ingress_can_assume: false,
          rolbypassrls: true,
          rolcanlogin: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolsuper: false,
          runtime_can_assume: false,
        },
      ]);
    });

    it("keeps ingress table-blind while permitting only exact active resolution", async () => {
      await harness.seed();

      await withRole(harness.privilegedPool(), INGRESS_ROLE, async (client) => {
        await expect(client.query("select id from public.inbound_routes")).rejects.toMatchObject({
          code: "42501",
        });
        await expect(client.query("select id from public.contacts")).rejects.toMatchObject({
          code: "42501",
        });

        const result = await client.query<ResolvedRouteRow>(
          `select organization_id::text as organization_id,
                  channel_connection_id::text as channel_connection_id
             from app.resolve_inbound_route($1::varchar, $2::bytea)`,
          ["widget_key", byteHash(harness.fixtures.routeHashA)],
        );
        expect(result.rows).toEqual([
          {
            channel_connection_id: harness.fixtures.channelA,
            organization_id: harness.fixtures.organizationA,
          },
        ]);
        expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual([
          "channel_connection_id",
          "organization_id",
        ]);
      });
    });

    it("resolves two tenants only through their exact canonical route pairs", async () => {
      await harness.seed();

      await expect(
        resolveAsIngress(
          harness.privilegedPool(),
          "widget_key",
          byteHash(harness.fixtures.routeHashA),
        ),
      ).resolves.toEqual([
        {
          channel_connection_id: harness.fixtures.channelA,
          organization_id: harness.fixtures.organizationA,
        },
      ]);
      await expect(
        resolveAsIngress(
          harness.privilegedPool(),
          "telegram_webhook",
          byteHash(harness.fixtures.routeHashB),
        ),
      ).resolves.toEqual([
        {
          channel_connection_id: harness.fixtures.channelB,
          organization_id: harness.fixtures.organizationB,
        },
      ]);
      await expect(
        resolveAsIngress(
          harness.privilegedPool(),
          "widget_key",
          byteHash(harness.fixtures.routeHashB),
        ),
      ).resolves.toEqual([]);
    });

    it.each([
      {
        label: "unknown hash",
        routeHash: byteHash("synthetic-s56-unknown-route"),
        routeType: "widget_key",
      },
      {
        label: "disabled route",
        routeHash: byteHash("synthetic-s56-disabled-route"),
        routeType: "widget_key",
      },
      {
        label: "wrong route type",
        routeHash: byteHash("synthetic-s56-widget-route-a"),
        routeType: "telegram_webhook",
      },
      {
        label: "noncanonical route type",
        routeHash: byteHash("synthetic-s56-widget-route-a"),
        routeType: "widget_key' or true --",
      },
      { label: "empty hash", routeHash: Buffer.alloc(0), routeType: "widget_key" },
      {
        label: "null route type",
        routeHash: byteHash("synthetic-s56-widget-route-a"),
        routeType: null,
      },
      { label: "null route hash", routeHash: null, routeType: "widget_key" },
    ] as const)("fails closed for $label", async ({ routeHash, routeType }) => {
      await harness.seed();
      await expect(
        resolveAsIngress(harness.privilegedPool(), routeType, routeHash),
      ).resolves.toEqual([]);
    });

    it("grants ingress only the resolver surface and denies ordinary runtime execution", async () => {
      const privileges = await harness.privilegedPool().query<{
        ingress_app_create: boolean;
        ingress_app_usage: boolean;
        ingress_table_grants: number;
        runtime_resolver_execute: boolean;
      }>(
        `select
           pg_catalog.has_schema_privilege($1, 'app', 'USAGE') as ingress_app_usage,
           pg_catalog.has_schema_privilege($1, 'app', 'CREATE') as ingress_app_create,
           pg_catalog.has_function_privilege($2, $3, 'EXECUTE') as runtime_resolver_execute,
           (select count(*)::integer
              from information_schema.role_table_grants
             where grantee = $1) as ingress_table_grants`,
        [INGRESS_ROLE, RUNTIME_ROLE, RESOLVER_SIGNATURE],
      );
      expect(privileges.rows).toEqual([
        {
          ingress_app_create: false,
          ingress_app_usage: true,
          ingress_table_grants: 0,
          runtime_resolver_execute: false,
        },
      ]);

      const definerGrants = await harness.privilegedPool().query<{
        privilege_type: string;
        table_name: string;
      }>(
        `select table_name, privilege_type
           from information_schema.role_table_grants
          where grantee = $1
          order by table_name, privilege_type`,
        [DEFINER_ROLE],
      );
      expect(definerGrants.rows).toEqual([
        { privilege_type: "SELECT", table_name: "inbound_routes" },
      ]);

      const ingressFunctions = await harness.privilegedPool().query<{
        function_name: string;
      }>(
        `select pg_catalog.format(
                  '%I.%I(%s)',
                  n.nspname,
                  p.proname,
                  pg_catalog.pg_get_function_identity_arguments(p.oid)
                ) as function_name
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('app', 'public')
            and pg_catalog.has_function_privilege($1, p.oid, 'EXECUTE')
          order by function_name`,
        [INGRESS_ROLE],
      );
      expect(ingressFunctions.rows).toEqual([
        {
          function_name:
            "app.resolve_inbound_route(input_route_type character varying, input_route_key_hash bytea)",
        },
      ]);

      await withRole(harness.privilegedPool(), RUNTIME_ROLE, async (client) => {
        await expect(
          client.query("select * from app.resolve_inbound_route($1::varchar, $2::bytea)", [
            "widget_key",
            byteHash(harness.fixtures.routeHashA),
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      });
    });

    it("uses the frozen exact unique lookup and contains no broad matching path", async () => {
      const index = await harness.privilegedPool().query<{ indexdef: string }>(
        `select indexdef
           from pg_catalog.pg_indexes
          where schemaname = 'public'
            and indexname = 'inbound_routes_route_type_route_key_hash_unique'`,
      );
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0]?.indexdef).toContain("UNIQUE INDEX");
      expect(index.rows[0]?.indexdef).toContain("(route_type, route_key_hash)");

      const definition = await harness
        .privilegedPool()
        .query<{ definition: string }>(
          "select pg_catalog.pg_get_functiondef($1::regprocedure) as definition",
          [RESOLVER_SIGNATURE],
        );
      const normalizedDefinition = definition.rows[0]?.definition.toLowerCase() ?? "";
      expect(normalizedDefinition).toContain("route.route_type = input_route_type");
      expect(normalizedDefinition).toContain("route.route_key_hash = input_route_key_hash");
      expect(normalizedDefinition).toContain("route.status = 'active'");
      expect(normalizedDefinition).not.toMatch(/\slike\s|\silike\s|\bformat\s*\(|\bexecute\s/);

      await harness.seed();
      const client = await harness.privilegedPool().connect();
      try {
        await client.query("begin");
        await client.query("set local enable_seqscan = off");
        const plan = await client.query<QueryResultRow>(
          `explain (costs off)
           select organization_id, channel_connection_id
             from public.inbound_routes
            where route_type = $1::varchar
              and route_key_hash = $2::bytea
              and status = 'active'`,
          ["widget_key", byteHash(harness.fixtures.routeHashA)],
        );
        const planText = plan.rows.map((row) => String(row["QUERY PLAN"])).join("\n");
        expect(planText).toContain("Index Scan");
        expect(planText).not.toContain("Seq Scan");
        await client.query("rollback");
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    });

    it("preserves FORCE RLS and the frozen inbound-route policy", async () => {
      const relation = await harness.privilegedPool().query<{
        relforcerowsecurity: boolean;
        relrowsecurity: boolean;
      }>(
        `select relrowsecurity, relforcerowsecurity
           from pg_catalog.pg_class
          where oid = 'public.inbound_routes'::regclass`,
      );
      expect(relation.rows).toEqual([{ relforcerowsecurity: true, relrowsecurity: true }]);

      const policies = await harness.privilegedPool().query<{
        cmd: string;
        policyname: string;
        roles: string[];
      }>(
        `select policyname, cmd, roles::text[] as roles
           from pg_catalog.pg_policies
          where schemaname = 'public'
            and tablename = 'inbound_routes'
          order by policyname`,
      );
      expect(policies.rows).toEqual([
        {
          cmd: "ALL",
          policyname: "inbound_routes_tenant_isolation",
          roles: [RUNTIME_ROLE],
        },
      ]);
    });
  });
};
