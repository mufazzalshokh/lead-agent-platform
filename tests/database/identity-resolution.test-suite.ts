import type { IdentityDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import {
  IdentityResolutionRoleError,
  createIdentityDatabaseRuntime,
  type IdentityDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  ExternalIdentityDeniedError,
  ExternalIdentityUnmappedError,
  createOidcIdentityVerifier,
  type ValidatedOidcIdentity,
} from "../../packages/security/src/index.js";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const ISSUER = "https://synthetic-tenant.auth0.example/";
const OTHER_ISSUER = "https://synthetic-other.auth0.example/";
const AUTH_ROLE = "lead_agent_auth";
const IDENTITY_DEFINER_ROLE = "lead_agent_identity_definer";
const USER_A = "0193f1a8-7f65-7c28-a434-a10796c46211";

export type IdentityResolutionHarness = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => IdentityDatabaseRuntime;
  runtimeConfiguration: () => IdentityDatabaseRuntimeConfig;
}>;

const validatedIdentity = async (
  subject: string,
  issuer = ISSUER,
): Promise<ValidatedOidcIdentity> =>
  createOidcIdentityVerifier({
    verifyEvidence: () => Promise.resolve(Object.freeze({ issuer, subject })),
  }).verify({ idToken: "synthetic-verified-token", expectedNonce: "synthetic-nonce" });

const insertUser = async (
  pool: Pool,
  id: string,
  status: "active" | "deleted" | "suspended" = "active",
  emailMarker?: string,
): Promise<void> => {
  await pool.query(
    "insert into users " +
      "(id, email_ciphertext, email_lookup_hash, status) " +
      "values ($1, $2, $3, $4)",
    [
      id,
      emailMarker === undefined ? null : Buffer.from("ciphertext-" + emailMarker),
      emailMarker === undefined ? null : Buffer.from("lookup-hash-" + emailMarker),
      status,
    ],
  );
};

const insertIdentity = async (
  pool: Pool,
  id: string,
  userId: string,
  subject: string,
  status: "active" | "disabled" | "unlinked" = "active",
  issuer = ISSUER,
): Promise<void> => {
  await pool.query(
    "insert into external_identities " +
      "(id, user_id, issuer, subject, status, linked_at, disabled_at, unlinked_at) " +
      "values ($1, $2, $3, $4, $5::varchar, now(), " +
      "case when $5::varchar = 'disabled' then now() else null end, " +
      "case when $5::varchar = 'unlinked' then now() else null end)",
    [id, userId, issuer, subject, status],
  );
};

const withRole = async (
  pool: Pool,
  role: string,
  callback: (client: PoolClient) => Promise<void>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("set role " + role);
    await callback(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query("reset role");
    client.release();
  }
};

export const registerIdentityResolutionTests = (harness: IdentityResolutionHarness): void => {
  describe("S6.2 external identity resolution", { timeout: 30_000 }, () => {
    it("resolves only the exact active issuer and subject to an active User", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      await insertIdentity(pool, "0193f1a8-7f65-7c28-a434-a10796c46221", USER_A, "auth0|user-a");

      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|user-a")),
      ).resolves.toBe(USER_A);
      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|user-a", OTHER_ISSUER)),
      ).rejects.toBeInstanceOf(ExternalIdentityUnmappedError);
      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|USER-A")),
      ).rejects.toBeInstanceOf(ExternalIdentityUnmappedError);
      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|user-a ")),
      ).rejects.toBeInstanceOf(ExternalIdentityUnmappedError);
    });

    it.each(["disabled", "unlinked"] as const)("denies a %s external identity", async (status) => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      await insertIdentity(
        pool,
        "0193f1a8-7f65-7c28-a434-a10796c46222",
        USER_A,
        "auth0|" + status,
        status,
      );

      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|" + status)),
      ).rejects.toBeInstanceOf(ExternalIdentityDeniedError);
    });

    it.each(["suspended", "deleted"] as const)("denies a %s linked User", async (status) => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A, status);
      await insertIdentity(pool, "0193f1a8-7f65-7c28-a434-a10796c46223", USER_A, "auth0|" + status);

      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|" + status)),
      ).rejects.toBeInstanceOf(ExternalIdentityDeniedError);
    });

    it("does not auto-link by email or create tenant authority", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A, "active", "shared-email");
      await insertIdentity(pool, "0193f1a8-7f65-7c28-a434-a10796c46224", USER_A, "auth0|linked");

      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|different-subject")),
      ).rejects.toBeInstanceOf(ExternalIdentityUnmappedError);
      expect((await pool.query("select id from memberships")).rows).toEqual([]);
      expect((await pool.query("select id from organizations")).rows).toEqual([]);
      expect((await pool.query("select count(*)::integer as count from users")).rows).toEqual([
        { count: 1 },
      ]);
      expect(
        (await pool.query("select count(*)::integer as count from external_identities")).rows,
      ).toEqual([{ count: 1 }]);
    });

    it("allows multiple exact identities to resolve to one User without linking writes", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      await insertIdentity(pool, "0193f1a8-7f65-7c28-a434-a10796c46225", USER_A, "auth0|primary");
      await insertIdentity(pool, "0193f1a8-7f65-7c28-a434-a10796c46226", USER_A, "auth0|secondary");

      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|primary")),
      ).resolves.toBe(USER_A);
      await expect(
        harness.runtime().resolve(await validatedIdentity("auth0|secondary")),
      ).resolves.toBe(USER_A);
    });

    it("requires the dedicated auth login role before invoking the resolver", async () => {
      const wrongRoleRuntime = createIdentityDatabaseRuntime(harness.runtimeConfiguration(), {
        onUnexpectedPoolError: () => undefined,
      });
      try {
        await expect(
          wrongRoleRuntime.resolve(await validatedIdentity("auth0|unknown")),
        ).rejects.toBeInstanceOf(IdentityResolutionRoleError);
      } finally {
        await wrongRoleRuntime.close();
      }
    });

    it("allows only the auth role to invoke the resolver and denies direct table access", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      await insertIdentity(
        pool,
        "0193f1a8-7f65-7c28-a434-a10796c46227",
        USER_A,
        "auth0|role-proof",
      );

      await withRole(pool, AUTH_ROLE, async (client) => {
        await client.query("begin");
        const result = await client.query<{ resolution_state: string; user_id: string | null }>(
          "select resolution_state, user_id::text as user_id " +
            "from app.resolve_external_identity($1::varchar, $2::varchar)",
          [ISSUER, "auth0|role-proof"],
        );
        expect(result.rows).toEqual([{ resolution_state: "authenticated", user_id: USER_A }]);

        for (const table of ["external_identities", "users"]) {
          await client.query("savepoint denied_table");
          await expect(client.query("select * from " + table)).rejects.toMatchObject({
            code: "42501",
          });
          await client.query("rollback to savepoint denied_table");
          await client.query("release savepoint denied_table");
        }
      });

      for (const role of ["lead_agent_runtime", "lead_agent_ingress"]) {
        await withRole(pool, role, async (client) => {
          await expect(
            client.query("select * from app.resolve_external_identity($1::varchar, $2::varchar)", [
              ISSUER,
              "auth0|role-proof",
            ]),
          ).rejects.toMatchObject({ code: "42501" });
        });
      }
    });

    it("freezes exact role attributes and least-privilege grants", async () => {
      const pool = harness.privilegedPool();
      const roles = await pool.query<{
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolname: string;
        rolreplication: boolean;
        rolsuper: boolean;
      }>(
        "select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, " +
          "rolcanlogin, rolreplication, rolbypassrls from pg_catalog.pg_roles " +
          "where rolname = any($1::text[]) order by rolname",
        [[AUTH_ROLE, IDENTITY_DEFINER_ROLE]],
      );
      expect(roles.rows).toEqual([
        {
          rolbypassrls: false,
          rolcanlogin: true,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: true,
          rolname: AUTH_ROLE,
          rolreplication: false,
          rolsuper: false,
        },
        {
          rolbypassrls: false,
          rolcanlogin: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolname: IDENTITY_DEFINER_ROLE,
          rolreplication: false,
          rolsuper: false,
        },
      ]);

      const grants = await pool.query<{
        auth_external_select: boolean;
        auth_function_execute: boolean;
        auth_users_select: boolean;
        definer_email_select: boolean;
        definer_identity_status_select: boolean;
        definer_subject_select: boolean;
        definer_user_status_select: boolean;
        ingress_function_execute: boolean;
        public_function_execute: boolean;
        runtime_function_execute: boolean;
      }>(
        `select
          pg_catalog.has_table_privilege($1, 'public.external_identities', 'SELECT')
            as auth_external_select,
          pg_catalog.has_table_privilege($1, 'public.users', 'SELECT')
            as auth_users_select,
          pg_catalog.has_function_privilege(
            $1,
            'app.resolve_external_identity(character varying,character varying)',
            'EXECUTE'
          ) as auth_function_execute,
          pg_catalog.has_column_privilege(
            $2, 'public.external_identities', 'subject', 'SELECT'
          ) as definer_subject_select,
          pg_catalog.has_column_privilege(
            $2, 'public.external_identities', 'status', 'SELECT'
          ) as definer_identity_status_select,
          pg_catalog.has_column_privilege($2, 'public.users', 'status', 'SELECT')
            as definer_user_status_select,
          pg_catalog.has_column_privilege($2, 'public.users', 'email_ciphertext', 'SELECT')
            as definer_email_select,
          pg_catalog.has_function_privilege(
            'lead_agent_runtime',
            'app.resolve_external_identity(character varying,character varying)',
            'EXECUTE'
          ) as runtime_function_execute,
          pg_catalog.has_function_privilege(
            'lead_agent_ingress',
            'app.resolve_external_identity(character varying,character varying)',
            'EXECUTE'
          ) as ingress_function_execute,
          pg_catalog.has_function_privilege(
            'public',
            'app.resolve_external_identity(character varying,character varying)',
            'EXECUTE'
          ) as public_function_execute`,
        [AUTH_ROLE, IDENTITY_DEFINER_ROLE],
      );
      expect(grants.rows[0]).toEqual({
        auth_external_select: false,
        auth_function_execute: true,
        auth_users_select: false,
        definer_email_select: false,
        definer_identity_status_select: true,
        definer_subject_select: true,
        definer_user_status_select: true,
        ingress_function_execute: false,
        public_function_execute: false,
        runtime_function_execute: false,
      });

      const memberships = await pool.query<{ count: number }>(
        `select count(*)::integer as count
           from pg_catalog.pg_auth_members membership
           join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
           join pg_catalog.pg_roles member_role on member_role.oid = membership.member
          where granted_role.rolname = $1
            and member_role.rolname = any($2::text[])`,
        [IDENTITY_DEFINER_ROLE, [AUTH_ROLE, "lead_agent_runtime", "lead_agent_ingress"]],
      );
      expect(memberships.rows).toEqual([{ count: 0 }]);
    });

    it("keeps the resolver SECURITY DEFINER function narrow and invoker-safe", async () => {
      const functionState = await harness.privilegedPool().query<{
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
          where proc.oid =
            'app.resolve_external_identity(character varying,character varying)'::regprocedure`,
      );
      expect(functionState.rows).toHaveLength(1);
      expect(functionState.rows[0]).toMatchObject({
        owner_name: IDENTITY_DEFINER_ROLE,
        proconfig: ["search_path=pg_catalog"],
        proisstrict: true,
        proparallel: "r",
        prosecdef: true,
        provolatile: "s",
        result_type: "TABLE(resolution_state text, user_id uuid)",
      });

      const definition = functionState.rows[0]?.definition.toLowerCase();
      expect(definition).toContain("public.external_identities");
      expect(definition).toContain("public.users");
      expect(definition).toContain("identity.issuer = input_issuer");
      expect(definition).toContain("identity.subject = input_subject");
      expect(definition).toContain("identity.status = 'active'");
      expect(definition).toContain("application_user.status = 'active'");
      expect(definition).not.toContain("memberships");
      expect(definition).not.toContain("organizations");
      expect(definition).not.toMatch(/\bexecute\b/);
      expect(definition).not.toMatch(/\bformat\s*\(/);
    });
  });
};
