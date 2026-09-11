import type { IdentityDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import {
  LocationIdSchema,
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type LocationId,
  type OrganizationId,
  type UserId,
} from "../../packages/contracts/src/index.js";
import {
  AuthorizationResolutionRoleError,
  createAuthorizationDatabaseRuntime,
  type AuthorizationDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  AuthorizationDeniedError,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
} from "../../packages/security/src/index.js";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const AUTH_ROLE = "lead_agent_auth";
const DEFINER_ROLE = "lead_agent_identity_definer";
const ORGANIZATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46501";
const ORGANIZATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46502";
const ORGANIZATION_UNKNOWN_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46503";
const USER_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46504";
const USER_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46505";
const LOCATION_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46506";
const LOCATION_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46507";
const LOCATION_FOREIGN_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46508";

if (
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_A_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_B_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_UNKNOWN_VALUE) ||
  !isSchemaValue(UserIdSchema, USER_A_VALUE) ||
  !isSchemaValue(UserIdSchema, USER_B_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_A_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_B_VALUE) ||
  !isSchemaValue(LocationIdSchema, LOCATION_FOREIGN_VALUE)
) {
  throw new TypeError("Invalid synthetic authorization database identifiers");
}

const ORGANIZATION_A: OrganizationId = ORGANIZATION_A_VALUE;
const ORGANIZATION_B: OrganizationId = ORGANIZATION_B_VALUE;
const ORGANIZATION_UNKNOWN: OrganizationId = ORGANIZATION_UNKNOWN_VALUE;
const USER_A: UserId = USER_A_VALUE;
const USER_B: UserId = USER_B_VALUE;
const LOCATION_A: LocationId = LOCATION_A_VALUE;
const LOCATION_B: LocationId = LOCATION_B_VALUE;
const LOCATION_FOREIGN: LocationId = LOCATION_FOREIGN_VALUE;

export type AuthorizationResolutionHarness = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => AuthorizationDatabaseRuntime;
  runtimeConfiguration: () => IdentityDatabaseRuntimeConfig;
}>;

const insertOrganization = (pool: Pool, id: OrganizationId, slug: string): Promise<unknown> =>
  pool.query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values ($1, $2, 'Synthetic Authorization Clinic', 'active', 'en', 'Asia/Tashkent')`,
    [id, slug],
  );

const insertUser = (pool: Pool, id: UserId): Promise<unknown> =>
  pool.query("insert into users (id, status) values ($1, 'active')", [id]);

const insertMembership = (
  pool: Pool,
  id: string,
  organizationId: OrganizationId,
  userId: UserId,
  role: "owner" | "admin" | "staff" | "analyst",
  status: "invited" | "active" | "suspended" | "revoked",
  locationScope: "all" | "restricted",
): Promise<unknown> =>
  pool.query(
    `insert into memberships
      (id, organization_id, user_id, role, status, location_scope,
       invited_at, activated_at, revoked_at)
     values (
       $1, $2, $3, $4::varchar, $5::varchar, $6::varchar,
       case when $5::varchar = 'invited' then now() else null end,
       case when $5::varchar = 'active' then now() else null end,
       case when $5::varchar = 'revoked' then now() else null end
     )`,
    [id, organizationId, userId, role, status, locationScope],
  );

const insertLocation = (
  pool: Pool,
  id: LocationId,
  organizationId: OrganizationId,
  code: string,
): Promise<unknown> =>
  pool.query(
    "insert into locations (id, organization_id, code, status) values ($1, $2, $3, 'active')",
    [id, organizationId, code],
  );

const insertScope = (
  pool: Pool,
  organizationId: OrganizationId,
  membershipId: string,
  locationId: LocationId,
  createdByUserId: UserId,
): Promise<unknown> =>
  pool.query(
    `insert into membership_location_scopes
      (organization_id, membership_id, location_id, created_by_user_id)
     values ($1, $2, $3, $4)`,
    [organizationId, membershipId, locationId, createdByUserId],
  );

const sessionFor = (userId: UserId): AuthenticatedApplicationSession => {
  const now = new Date();
  return Object.freeze({
    absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1_000),
    authenticationLevel: "mfa",
    authenticationTime: now,
    createdAt: now,
    idleExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    lastSeenAt: now,
    rotatedAt: now,
    rotationDue: false,
    sessionId: "0193f1a8-7f65-7c28-a434-a10796c46509",
    userId,
  });
};

const withRole = async (
  pool: Pool,
  role: string,
  callback: (client: PoolClient) => Promise<void>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(`set role ${role}`);
    await callback(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query("reset role");
    client.release();
  }
};

export const registerAuthorizationResolutionTests = (
  harness: AuthorizationResolutionHarness,
): void => {
  describe("S6.4 current Membership authorization resolution", { timeout: 30_000 }, () => {
    it("resolves an exact active all-location Membership without stale scope authority", async () => {
      const pool = harness.privilegedPool();
      const membershipId = "0193f1a8-7f65-7c28-a434-a10796c46510";
      await insertOrganization(pool, ORGANIZATION_A, "s64-all-scope");
      await insertUser(pool, USER_A);
      await insertMembership(pool, membershipId, ORGANIZATION_A, USER_A, "admin", "active", "all");
      await insertLocation(pool, LOCATION_A, ORGANIZATION_A, "all-scope-location");
      await insertScope(pool, ORGANIZATION_A, membershipId, LOCATION_A, USER_A);

      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_A),
      ).resolves.toEqual({
        allowedLocationIds: [],
        locationScope: "all",
        membershipId,
        organizationId: ORGANIZATION_A,
        role: "admin",
        status: "active",
        userId: USER_A,
      });
    });

    it("returns the exact ordered restricted scope and preserves restricted empty as deny-all data", async () => {
      const pool = harness.privilegedPool();
      const membershipA = "0193f1a8-7f65-7c28-a434-a10796c46511";
      const membershipB = "0193f1a8-7f65-7c28-a434-a10796c46512";
      await insertOrganization(pool, ORGANIZATION_A, "s64-restricted-a");
      await insertOrganization(pool, ORGANIZATION_B, "s64-restricted-b");
      await insertUser(pool, USER_A);
      await insertMembership(
        pool,
        membershipA,
        ORGANIZATION_A,
        USER_A,
        "staff",
        "active",
        "restricted",
      );
      await insertMembership(
        pool,
        membershipB,
        ORGANIZATION_B,
        USER_A,
        "analyst",
        "active",
        "restricted",
      );
      await insertLocation(pool, LOCATION_A, ORGANIZATION_A, "restricted-a");
      await insertLocation(pool, LOCATION_B, ORGANIZATION_A, "restricted-b");
      await insertScope(pool, ORGANIZATION_A, membershipA, LOCATION_B, USER_A);
      await insertScope(pool, ORGANIZATION_A, membershipA, LOCATION_A, USER_A);

      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_A),
      ).resolves.toMatchObject({
        allowedLocationIds: [LOCATION_A, LOCATION_B],
        locationScope: "restricted",
        membershipId: membershipA,
      });
      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_B),
      ).resolves.toMatchObject({
        allowedLocationIds: [],
        locationScope: "restricted",
        membershipId: membershipB,
      });
    });

    it("authorizes only active status and keeps every denied selector anti-enumerating", async () => {
      const pool = harness.privilegedPool();
      const membershipId = "0193f1a8-7f65-7c28-a434-a10796c46513";
      await insertOrganization(pool, ORGANIZATION_A, "s64-status");
      await insertUser(pool, USER_A);
      await insertUser(pool, USER_B);
      await insertMembership(
        pool,
        membershipId,
        ORGANIZATION_A,
        USER_A,
        "staff",
        "invited",
        "restricted",
      );

      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_A),
      ).resolves.toBeNull();
      await expect(
        resolveAuthorizationContext(sessionFor(USER_A), ORGANIZATION_A, harness.runtime()),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);

      await pool.query(
        "update memberships set status = 'active', activated_at = now() where id = $1",
        [membershipId],
      );
      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_A),
      ).resolves.toMatchObject({ status: "active" });

      await pool.query("update memberships set status = 'suspended' where id = $1", [membershipId]);
      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_A),
      ).resolves.toBeNull();

      await pool.query(
        "update memberships set status = 'revoked', revoked_at = now() where id = $1",
        [membershipId],
      );
      const denied = [
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_A),
        harness.runtime().resolveCurrentMembership(USER_B, ORGANIZATION_A),
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_UNKNOWN),
      ];
      await expect(Promise.all(denied)).resolves.toEqual([null, null, null]);
    });

    it("resolves multi-Organization authority independently and reloads role and scope changes", async () => {
      const pool = harness.privilegedPool();
      const membershipA = "0193f1a8-7f65-7c28-a434-a10796c46514";
      const membershipB = "0193f1a8-7f65-7c28-a434-a10796c46515";
      await insertOrganization(pool, ORGANIZATION_A, "s64-multi-a");
      await insertOrganization(pool, ORGANIZATION_B, "s64-multi-b");
      await insertUser(pool, USER_A);
      await insertMembership(pool, membershipA, ORGANIZATION_A, USER_A, "admin", "active", "all");
      await insertMembership(
        pool,
        membershipB,
        ORGANIZATION_B,
        USER_A,
        "analyst",
        "active",
        "restricted",
      );
      await insertLocation(pool, LOCATION_A, ORGANIZATION_A, "multi-a");
      await insertLocation(pool, LOCATION_FOREIGN, ORGANIZATION_B, "multi-b");
      await insertScope(pool, ORGANIZATION_B, membershipB, LOCATION_FOREIGN, USER_A);

      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_A),
      ).resolves.toMatchObject({ role: "admin", allowedLocationIds: [] });
      await expect(
        harness.runtime().resolveCurrentMembership(USER_A, ORGANIZATION_B),
      ).resolves.toMatchObject({ role: "analyst", allowedLocationIds: [LOCATION_FOREIGN] });

      await pool.query(
        "update memberships set role = 'staff', location_scope = 'restricted' where id = $1",
        [membershipA],
      );
      await insertScope(pool, ORGANIZATION_A, membershipA, LOCATION_A, USER_A);
      await expect(
        resolveAuthorizationContext(sessionFor(USER_A), ORGANIZATION_A, harness.runtime()),
      ).resolves.toMatchObject({
        allowedLocationIds: [LOCATION_A],
        organizationId: ORGANIZATION_A,
        role: "staff",
      });
    });

    it("keeps impossible role scopes and foreign Location grants structurally denied", async () => {
      const pool = harness.privilegedPool();
      const membershipId = "0193f1a8-7f65-7c28-a434-a10796c46516";
      await insertOrganization(pool, ORGANIZATION_A, "s64-constraints-a");
      await insertOrganization(pool, ORGANIZATION_B, "s64-constraints-b");
      await insertUser(pool, USER_A);
      await insertMembership(pool, membershipId, ORGANIZATION_A, USER_A, "owner", "active", "all");
      await insertLocation(pool, LOCATION_FOREIGN, ORGANIZATION_B, "foreign-location");

      await expect(
        pool.query("update memberships set location_scope = 'restricted' where id = $1", [
          membershipId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        insertScope(pool, ORGANIZATION_A, membershipId, LOCATION_FOREIGN, USER_A),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("requires the dedicated auth login role for the application adapter", async () => {
      const wrongRoleRuntime = createAuthorizationDatabaseRuntime(harness.runtimeConfiguration(), {
        onUnexpectedPoolError: () => undefined,
      });
      try {
        await expect(
          wrongRoleRuntime.resolveCurrentMembership(USER_A, ORGANIZATION_A),
        ).rejects.toBeInstanceOf(AuthorizationResolutionRoleError);
      } finally {
        await wrongRoleRuntime.close();
      }
    });

    it("grants only exact resolver execution and denies direct Membership enumeration", async () => {
      const pool = harness.privilegedPool();
      await insertOrganization(pool, ORGANIZATION_A, "s64-grants");
      await insertUser(pool, USER_A);
      await insertMembership(
        pool,
        "0193f1a8-7f65-7c28-a434-a10796c46517",
        ORGANIZATION_A,
        USER_A,
        "staff",
        "active",
        "restricted",
      );

      await withRole(pool, AUTH_ROLE, async (client) => {
        await client.query("begin");
        const result = await client.query<{ membership_id: string }>(
          "select membership_id::text as membership_id from app.resolve_membership_authorization($1::uuid, $2::uuid)",
          [USER_A, ORGANIZATION_A],
        );
        expect(result.rows).toHaveLength(1);
        for (const table of ["memberships", "membership_location_scopes"]) {
          await client.query("savepoint denied_table");
          await expect(client.query(`select * from ${table}`)).rejects.toMatchObject({
            code: "42501",
          });
          await client.query("rollback to savepoint denied_table");
          await client.query("release savepoint denied_table");
        }
      });

      for (const role of [
        "lead_agent_runtime",
        "lead_agent_ingress",
        "lead_agent_inbound_route_definer",
      ]) {
        await withRole(pool, role, async (client) => {
          await expect(
            client.query("select * from app.resolve_membership_authorization($1::uuid, $2::uuid)", [
              USER_A,
              ORGANIZATION_A,
            ]),
          ).rejects.toMatchObject({ code: "42501" });
        });
      }
    });

    it("freezes resolver ownership, RLS policy, columns, and safe function shape", async () => {
      const pool = harness.privilegedPool();
      const functionState = await pool.query<{
        definition: string;
        owner_name: string;
        proconfig: string[] | null;
        proisstrict: boolean;
        proparallel: string;
        prosecdef: boolean;
        provolatile: string;
        result_type: string;
      }>(
        `select pg_catalog.pg_get_userbyid(proc.proowner) as owner_name,
                proc.prosecdef, proc.provolatile, proc.proisstrict, proc.proparallel,
                proc.proconfig, pg_catalog.pg_get_function_result(proc.oid) as result_type,
                pg_catalog.pg_get_functiondef(proc.oid) as definition
           from pg_catalog.pg_proc proc
          where proc.oid = 'app.resolve_membership_authorization(uuid,uuid)'::regprocedure`,
      );
      expect(functionState.rows).toHaveLength(1);
      expect(functionState.rows[0]).toMatchObject({
        owner_name: DEFINER_ROLE,
        proconfig: ["search_path=pg_catalog"],
        proisstrict: true,
        proparallel: "r",
        prosecdef: true,
        provolatile: "v",
        result_type:
          "TABLE(resolution_state text, membership_id uuid, organization_id uuid, user_id uuid, status character varying, role character varying, location_scope character varying, allowed_location_ids uuid[])",
      });
      const definition = functionState.rows[0]?.definition.toLowerCase();
      expect(definition).toContain("public.memberships");
      expect(definition).toContain("public.membership_location_scopes");
      expect(definition).toContain("membership.user_id = input_user_id");
      expect(definition).toContain("membership.organization_id = input_organization_id");
      expect(definition).toContain("membership.status = 'active'");
      expect(definition).toContain("set_config('app.organization_id'");
      expect(definition).toContain("true");
      expect(definition).not.toContain("public.users");
      expect(definition).not.toContain("public.organizations");
      expect(definition).not.toMatch(/\bexecute\b/u);
      expect(definition).not.toMatch(/\bformat\s*\(/u);

      const policies = await pool.query<{
        cmd: string;
        policyname: string;
        roles: string;
      }>(
        `select policyname, cmd, roles::text
           from pg_catalog.pg_policies
          where policyname = any($1::text[])
          order by policyname`,
        [
          [
            "membership_location_scopes_authorization_resolution",
            "memberships_authorization_resolution",
          ],
        ],
      );
      expect(policies.rows).toEqual([
        {
          cmd: "SELECT",
          policyname: "membership_location_scopes_authorization_resolution",
          roles: `{${DEFINER_ROLE}}`,
        },
        {
          cmd: "SELECT",
          policyname: "memberships_authorization_resolution",
          roles: `{${DEFINER_ROLE}}`,
        },
      ]);

      const definerRole = await pool.query<{
        rolbypassrls: boolean;
        rolcanlogin: boolean;
      }>(
        `select rolcanlogin, rolbypassrls
           from pg_catalog.pg_roles
          where rolname = $1`,
        [DEFINER_ROLE],
      );
      expect(definerRole.rows).toEqual([{ rolbypassrls: false, rolcanlogin: false }]);

      const grants = await pool.query<{
        auth_execute: boolean;
        auth_memberships_select: boolean;
        definer_invited_at_select: boolean;
        definer_location_id_select: boolean;
        definer_membership_role_select: boolean;
        definer_memberships_full_select: boolean;
        public_execute: boolean;
      }>(
        `select
          pg_catalog.has_function_privilege(
            $1, 'app.resolve_membership_authorization(uuid,uuid)', 'EXECUTE'
          ) as auth_execute,
          pg_catalog.has_function_privilege(
            'public', 'app.resolve_membership_authorization(uuid,uuid)', 'EXECUTE'
          ) as public_execute,
          pg_catalog.has_table_privilege($1, 'public.memberships', 'SELECT')
            as auth_memberships_select,
          pg_catalog.has_table_privilege($2, 'public.memberships', 'SELECT')
            as definer_memberships_full_select,
          pg_catalog.has_column_privilege($2, 'public.memberships', 'role', 'SELECT')
            as definer_membership_role_select,
          pg_catalog.has_column_privilege($2, 'public.memberships', 'invited_at', 'SELECT')
            as definer_invited_at_select,
          pg_catalog.has_column_privilege(
            $2, 'public.membership_location_scopes', 'location_id', 'SELECT'
          ) as definer_location_id_select`,
        [AUTH_ROLE, DEFINER_ROLE],
      );
      expect(grants.rows[0]).toEqual({
        auth_execute: true,
        auth_memberships_select: false,
        definer_invited_at_select: false,
        definer_location_id_select: true,
        definer_membership_role_select: true,
        definer_memberships_full_select: false,
        public_execute: false,
      });
    });
  });
};
