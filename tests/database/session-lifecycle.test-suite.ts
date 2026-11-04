import type { IdentityDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import { UserIdSchema, isSchemaValue, type UserId } from "../../packages/contracts/src/index.js";
import {
  SessionDatabaseRoleError,
  createSessionDatabaseRuntime,
  createSessionConnectionProbe,
  SessionDatabaseError,
  type SessionDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  SESSION_POLICY,
  SessionAuthenticationRequiredError,
  authenticateExternalIdentity,
  createApplicationSessionLifecycle,
  createOidcIdentityVerifier,
  createSessionAuthenticationEvidence,
  hashSessionToken,
} from "../../packages/security/src/index.js";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { createApi } from "../../apps/api/src/auth/plugin.js";
import { createS22SessionProbe } from "../../apps/api/src/diagnostics/s22-connection-fault.js";
import {
  digestProbeSession,
  S22_CONNECTION_FAULT_HEADER,
} from "../../apps/api/src/diagnostics/s22-connection-fault-admission.js";
import { loadS22ConnectionFaultProfile } from "../../packages/config/src/index.js";
import { probeEnvironment, probeProfileValue } from "../security/s22-connection-fault-fixtures.js";
import { staffFixture } from "../instagram/staff-fixtures.js";
import { NOW } from "../telegram/fixtures.js";

const AUTH_ROLE = "lead_agent_auth";
const DEFINER_ROLE = "lead_agent_identity_definer";
const USER_A_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46311";
const USER_B_VALUE = "0193f1a8-7f65-7c28-a434-a10796c46312";
if (!isSchemaValue(UserIdSchema, USER_A_VALUE) || !isSchemaValue(UserIdSchema, USER_B_VALUE)) {
  throw new TypeError("Invalid synthetic session User IDs");
}
const USER_A: UserId = USER_A_VALUE;
const USER_B: UserId = USER_B_VALUE;

export type SessionLifecycleHarness = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => SessionDatabaseRuntime;
  runtimeConfiguration: () => IdentityDatabaseRuntimeConfig;
  probeConfiguration: () => IdentityDatabaseRuntimeConfig;
}>;

const createEvidence = async (userId: UserId, authenticationLevel = "mfa") => {
  const authentication = await authenticateExternalIdentity(
    createOidcIdentityVerifier({
      verifyEvidence: () =>
        Promise.resolve({
          issuer: "https://synthetic-session.auth0.example/",
          subject: `auth0|${userId}`,
        }),
    }),
    { resolve: () => Promise.resolve(userId) },
    { expectedNonce: "synthetic-nonce", idToken: "synthetic-verified-only" },
  );
  return createSessionAuthenticationEvidence(authentication, {
    authenticationLevel,
    authenticationTime: new Date(Date.now() - 1_000),
  });
};

const insertUser = (pool: Pool, userId: UserId, status = "active"): Promise<unknown> =>
  pool.query("insert into users (id, status) values ($1, $2)", [userId, status]);

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

const activeSessionCount = async (pool: Pool, userId: UserId): Promise<number> => {
  const result = await pool.query<{ count: number }>(
    "select count(*)::integer as count from auth_sessions where user_id = $1 and status = 'active'",
    [userId],
  );
  return result.rows[0]?.count ?? -1;
};

export const registerSessionLifecycleTests = (harness: SessionLifecycleHarness): void => {
  describe("S6.3 application-owned session lifecycle", { timeout: 30_000 }, () => {
    it("S22 HTTP uses real role-checked PostgreSQL for baseline, real TCP cuts for failure, and normal-pool recovery", async () => {
      await insertUser(harness.privilegedPool(), USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const issued = await lifecycle.createSession(await createEvidence(USER_A));
      const auth = staffFixture();
      const profileValue = {
        ...probeProfileValue(),
        sessionDigest: digestProbeSession(issued.session.sessionId),
      };
      const loaded = loadS22ConnectionFaultProfile(
        { ...probeEnvironment(), S22_CONNECTION_FAULT_PROFILE: JSON.stringify(profileValue) },
        NOW,
      );
      if (loaded.state !== "ready") throw new Error("Invalid synthetic HTTP probe profile");
      const profile = loaded.profile;
      const clock = { now: NOW.getTime(), mono: 0 };
      const receipts: unknown[] = [];
      const probe = createS22SessionProbe(
        profile,
        harness.probeConfiguration(),
        {},
        (receipt) => receipts.push(receipt),
        { wall: () => clock.now, monotonic: () => clock.mono },
      );
      const sealed = auth.staffAuth.envelopeProtector.sealSession({
        csrfSecret: issued.csrfSecret,
        expiresAt: issued.session.absoluteExpiresAt,
        sessionToken: issued.sessionToken,
      });
      const headers = {
        ...auth.headers,
        "sec-fetch-site": "same-origin",
        cookie: `__Host-lead-session=${sealed}; __Host-lead-csrf=${issued.csrfSecret}`,
      };
      const api = createApi({
        staffAuth: {
          ...auth.staffAuth,
          clock: () => new Date(),
          sessions: lifecycle,
          sessionConnectionProbe: probe,
        },
      });
      api.addHook("onReady", () => probe.start());
      api.addHook("onClose", () => probe.close());
      let nonce = "-";
      try {
        // One setup GET, 4 baseline, 23 fault and 2 recovery: 30 total, below 44.
        expect(
          (await api.inject({ method: "GET", url: "/v1/staff/auth/session", headers })).statusCode,
        ).toBe(200);
        for (let sequence = 1; sequence <= 29; sequence++) {
          clock.now =
            sequence <= 4
              ? profile.baselineAt + (sequence - 1) * 15000
              : sequence <= 27
                ? profile.faultAt + (sequence - 5) * 15000
                : profile.expiresAt + (sequence - 28) * 30000;
          clock.mono = clock.now - NOW.getTime();
          const response = await api.inject({
            method: "GET",
            url: "/v1/staff/auth/session",
            headers: {
              ...headers,
              [S22_CONNECTION_FAULT_HEADER]: `${profile.exerciseId}:${sequence}:${nonce}:read`,
            },
          });
          expect(response.statusCode).toBe(sequence >= 5 && sequence <= 27 ? 500 : 200);
          const metadata: unknown = JSON.parse(
            String(response.headers[S22_CONNECTION_FAULT_HEADER]),
          );
          if (
            typeof metadata !== "object" ||
            metadata === null ||
            !("nonce" in metadata) ||
            typeof metadata.nonce !== "string"
          )
            throw new Error("Invalid probe metadata");
          expect(metadata).toMatchObject({ sequence });
          nonce = metadata.nonce;
          if (sequence === 4) expect(metadata).toMatchObject({ state: "admitted" });
          if (sequence === 29) expect(metadata).toMatchObject({ state: "recovered" });
          expect(response.body).not.toContain(issued.sessionToken);
          expect(response.headers["set-cookie"]).toBeUndefined();
        }
        expect(receipts).toHaveLength(29);
        expect(JSON.stringify(receipts)).not.toContain(issued.sessionToken);
        expect(JSON.stringify(receipts)).not.toContain(issued.session.sessionId);
        expect(JSON.stringify(receipts)).not.toContain(
          harness.probeConfiguration().connectionString,
        );
      } finally {
        await api.close();
      }
    });

    it("S22 resolves through real PostgreSQL, cuts only the probe, and preserves the shared pool and revocation", async () => {
      await insertUser(harness.privilegedPool(), USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const issued = await lifecycle.createSession(await createEvidence(USER_A));
      const hash = hashSessionToken(issued.sessionToken);
      if (hash === undefined) throw new Error("Invalid synthetic token");
      const poolErrors: Error[] = [];
      const probe = await createSessionConnectionProbe(
        harness.probeConfiguration(),
        {
          onUnexpectedPoolError: (error) => poolErrors.push(error),
        },
        process.env,
      );
      try {
        expect(await probe.resolveSession(hash, () => false)).toMatchObject({
          sessionId: issued.session.sessionId,
          userId: USER_A,
        });
        await expect(probe.resolveSession(hash, () => true)).rejects.toBeInstanceOf(
          SessionDatabaseError,
        );
        expect(await lifecycle.resolveSession(issued.sessionToken)).toMatchObject({
          sessionId: issued.session.sessionId,
        });
        expect(await probe.resolveSession(hash, () => false)).toMatchObject({
          sessionId: issued.session.sessionId,
        });
        await lifecycle.revokeSession(issued.sessionToken);
        expect(await probe.resolveSession(hash, () => false)).toBeNull();
        await expect(lifecycle.resolveSession(issued.sessionToken)).rejects.toBeInstanceOf(
          SessionAuthenticationRequiredError,
        );
        expect(poolErrors).toEqual([]);
      } finally {
        await probe.close();
      }
    });

    it("S22 probe retains the non-owner authentication-role check with real PostgreSQL", async () => {
      const errors: Error[] = [];
      const probe = await createSessionConnectionProbe(
        harness.runtimeConfiguration(),
        {
          onUnexpectedPoolError: (error) => errors.push(error),
        },
        process.env,
      );
      try {
        await expect(probe.resolveSession(Buffer.alloc(32), () => false)).rejects.toBeInstanceOf(
          SessionDatabaseRoleError,
        );
        expect(errors).toEqual([]);
      } finally {
        await probe.close();
      }
    });

    it("creates hash-only credentials with frozen lifetimes and no tenant authority", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const issued = await lifecycle.createSession(await createEvidence(USER_A));

      const persisted = await pool.query<{
        absolute_seconds: number;
        csrf_secret_hash: Buffer;
        idle_seconds: number;
        session_token_hash: Buffer;
        status: string;
      }>(
        `select session_token_hash, csrf_secret_hash, status,
                extract(epoch from (idle_expires_at - created_at))::integer as idle_seconds,
                extract(epoch from (absolute_expires_at - created_at))::integer as absolute_seconds
           from auth_sessions where id = $1`,
        [issued.session.sessionId],
      );
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toMatchObject({
        absolute_seconds: SESSION_POLICY.absoluteLifetimeMilliseconds / 1_000,
        idle_seconds: SESSION_POLICY.idleTimeoutMilliseconds / 1_000,
        status: "active",
      });
      expect(persisted.rows[0]?.session_token_hash).toEqual(
        Buffer.from(hashSessionToken(issued.sessionToken)!),
      );
      expect(persisted.rows[0]?.csrf_secret_hash).toHaveLength(32);
      expect(persisted.rows[0]?.csrf_secret_hash).not.toEqual(
        Buffer.from(hashSessionToken(issued.sessionToken)!),
      );
      expect(JSON.stringify(persisted.rows)).not.toContain(issued.sessionToken);
      expect(JSON.stringify(persisted.rows)).not.toContain(issued.csrfSecret);
      expect((await pool.query("select id from memberships")).rows).toEqual([]);
      expect((await pool.query("select id from organizations")).rows).toEqual([]);
      expect(issued.session).not.toHaveProperty("organizationId");
      expect(issued.session).not.toHaveProperty("membershipId");
      expect(issued.session).not.toHaveProperty("role");
      expect(issued.session).not.toHaveProperty("permissions");
      expect(issued.session).not.toHaveProperty("locationScope");
    });

    it("rejects nonexistent and inactive Users without minting a session", async () => {
      const pool = harness.privilegedPool();
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      await expect(lifecycle.createSession(await createEvidence(USER_A))).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      await insertUser(pool, USER_B, "suspended");
      await expect(lifecycle.createSession(await createEvidence(USER_B))).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      expect((await pool.query("select id from auth_sessions")).rows).toEqual([]);
    });

    it("resolves exact tokens, advances activity monotonically, and never extends absolute expiry", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const issued = await lifecycle.createSession(await createEvidence(USER_A));
      const originalAbsolute = issued.session.absoluteExpiresAt;

      await pool.query(
        `update auth_sessions
            set authentication_time = now() - interval '5 hours',
                created_at = now() - interval '5 hours',
                rotated_at = now() - interval '5 hours',
                last_seen_at = now() - interval '59 minutes',
                idle_expires_at = now() + interval '1 minute',
                absolute_expires_at = $2
          where id = $1`,
        [issued.session.sessionId, originalAbsolute],
      );
      const resolved = await lifecycle.resolveSession(issued.sessionToken);
      expect(resolved.userId).toBe(USER_A);
      expect(resolved.rotationDue).toBe(true);
      expect(resolved.lastSeenAt.getTime()).toBeGreaterThan(issued.session.lastSeenAt.getTime());
      expect(resolved.absoluteExpiresAt).toEqual(originalAbsolute);
      expect(resolved.idleExpiresAt.getTime()).toBeLessThanOrEqual(originalAbsolute.getTime());

      await expect(
        lifecycle.resolveSession("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
      ).rejects.toBeInstanceOf(SessionAuthenticationRequiredError);
      await expect(lifecycle.resolveSession("malformed")).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
    });

    it("fails closed at idle and absolute boundaries and records terminal status", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const idleExpired = await lifecycle.createSession(await createEvidence(USER_A));
      await pool.query(
        `update auth_sessions
            set created_at = now() - interval '2 hours',
                authentication_time = now() - interval '2 hours',
                rotated_at = now() - interval '2 hours',
                last_seen_at = now() - interval '61 minutes',
                idle_expires_at = now(),
                absolute_expires_at = now() + interval '10 hours'
          where id = $1`,
        [idleExpired.session.sessionId],
      );
      await expect(lifecycle.resolveSession(idleExpired.sessionToken)).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );

      const absoluteExpired = await lifecycle.createSession(await createEvidence(USER_A));
      await pool.query(
        `update auth_sessions
            set created_at = now() - interval '13 hours',
                authentication_time = now() - interval '13 hours',
                rotated_at = now() - interval '5 hours',
                last_seen_at = now() - interval '1 minute',
                idle_expires_at = now(),
                absolute_expires_at = now()
          where id = $1`,
        [absoluteExpired.session.sessionId],
      );
      await expect(lifecycle.resolveSession(absoluteExpired.sessionToken)).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      const statuses = await pool.query<{ status: string }>(
        "select status from auth_sessions order by created_at, id",
      );
      expect(statuses.rows.map(({ status }) => status)).toEqual(["expired", "expired"]);
    });

    it("rotates atomically, preserves identity and absolute expiry, and rejects old-token replay", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const issued = await lifecycle.createSession(await createEvidence(USER_A, "primary"));
      const stepUp = await createEvidence(USER_A, "mfa");
      const rotated = await lifecycle.rotateSession(issued.sessionToken, stepUp);

      expect(rotated.sessionToken).not.toBe(issued.sessionToken);
      expect(rotated.csrfSecret).not.toBe(issued.csrfSecret);
      expect(rotated.session.sessionId).toBe(issued.session.sessionId);
      expect(rotated.session.absoluteExpiresAt).toEqual(issued.session.absoluteExpiresAt);
      expect(rotated.session.authenticationLevel).toBe("mfa");
      await expect(lifecycle.resolveSession(issued.sessionToken)).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      await expect(lifecycle.resolveSession(rotated.sessionToken)).resolves.toMatchObject({
        sessionId: issued.session.sessionId,
        userId: USER_A,
      });
      const count = await pool.query<{ count: number }>(
        "select count(*)::integer as count from auth_sessions",
      );
      expect(count.rows).toEqual([{ count: 1 }]);
    });

    it("permits exactly one authoritative winner in a concurrent rotation race", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const issued = await lifecycle.createSession(await createEvidence(USER_A));
      const outcomes = await Promise.allSettled([
        lifecycle.rotateSession(issued.sessionToken),
        lifecycle.rotateSession(issued.sessionToken),
      ]);
      const successful = outcomes.filter(
        (
          outcome,
        ): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof lifecycle.rotateSession>>> =>
          outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejectedReason: unknown = Reflect.get(rejected[0]!, "reason");
      expect(rejectedReason).toBeInstanceOf(SessionAuthenticationRequiredError);
      await expect(lifecycle.resolveSession(issued.sessionToken)).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      await expect(
        lifecycle.resolveSession(successful[0]!.value.sessionToken),
      ).resolves.toMatchObject({
        userId: USER_A,
      });
      expect(await activeSessionCount(pool, USER_A)).toBe(1);
    });

    it("atomically evicts the deterministic oldest session when issuing a sixth", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const evidence = await createEvidence(USER_A);
      const issued = [];
      for (let index = 0; index < 6; index += 1) {
        issued.push(await lifecycle.createSession(evidence));
      }
      expect(issued[5]?.evictedSessionCount).toBe(1);
      expect(await activeSessionCount(pool, USER_A)).toBe(5);
      await expect(lifecycle.resolveSession(issued[0]!.sessionToken)).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      await expect(lifecycle.resolveSession(issued[5]!.sessionToken)).resolves.toMatchObject({
        userId: USER_A,
      });
      const evicted = await pool.query<{ count: number }>(
        "select count(*)::integer as count from auth_sessions where revocation_reason = 'session_limit'",
      );
      expect(evicted.rows).toEqual([{ count: 1 }]);
    });

    it("serializes concurrent creation so active sessions never exceed five", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const evidence = await createEvidence(USER_A);
      const issued = await Promise.all(
        Array.from({ length: 8 }, () => lifecycle.createSession(evidence)),
      );
      expect(await activeSessionCount(pool, USER_A)).toBe(5);
      const rows = await pool.query<{ count: number; status: string }>(
        "select status, count(*)::integer as count from auth_sessions group by status order by status",
      );
      expect(rows.rows).toEqual([
        { count: 5, status: "active" },
        { count: 3, status: "revoked" },
      ]);
      expect(issued).toHaveLength(8);
    });

    it("revokes one idempotently and revokes all sessions for only the selected User", async () => {
      const pool = harness.privilegedPool();
      await insertUser(pool, USER_A);
      await insertUser(pool, USER_B);
      const lifecycle = createApplicationSessionLifecycle(harness.runtime());
      const firstA = await lifecycle.createSession(await createEvidence(USER_A));
      const secondA = await lifecycle.createSession(await createEvidence(USER_A));
      const onlyB = await lifecycle.createSession(await createEvidence(USER_B));

      await lifecycle.revokeSession(firstA.sessionToken);
      await lifecycle.revokeSession(firstA.sessionToken);
      await expect(lifecycle.resolveSession(firstA.sessionToken)).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      await expect(lifecycle.revokeUserSessions(USER_A, "sign_out_all")).resolves.toBe(1);
      await expect(lifecycle.revokeUserSessions(USER_A, "sign_out_all")).resolves.toBe(0);
      await expect(lifecycle.resolveSession(secondA.sessionToken)).rejects.toBeInstanceOf(
        SessionAuthenticationRequiredError,
      );
      await expect(lifecycle.resolveSession(onlyB.sessionToken)).resolves.toMatchObject({
        userId: USER_B,
      });
      expect(await activeSessionCount(pool, USER_B)).toBe(1);
    });

    it("keeps global-auth privileges purpose-built and all other roles denied", async () => {
      const pool = harness.privilegedPool();
      const signatures = [
        "app.create_application_session(uuid,uuid,bytea,bytea,timestamp with time zone,character varying,bytea,bytea)",
        "app.resolve_application_session(bytea)",
        "app.rotate_application_session(bytea,bytea,bytea,uuid,timestamp with time zone,character varying)",
        "app.revoke_application_session(bytea)",
        "app.revoke_user_application_sessions(uuid,character varying)",
      ];
      for (const signature of signatures) {
        const grants = await pool.query<{
          auth_execute: boolean;
          ingress_execute: boolean;
          public_execute: boolean;
          runtime_execute: boolean;
        }>(
          `select
             pg_catalog.has_function_privilege($1, $2, 'EXECUTE') as auth_execute,
             pg_catalog.has_function_privilege('lead_agent_ingress', $2, 'EXECUTE') as ingress_execute,
             pg_catalog.has_function_privilege('lead_agent_runtime', $2, 'EXECUTE') as runtime_execute,
             pg_catalog.has_function_privilege('public', $2, 'EXECUTE') as public_execute`,
          [AUTH_ROLE, signature],
        );
        expect(grants.rows[0]).toEqual({
          auth_execute: true,
          ingress_execute: false,
          public_execute: false,
          runtime_execute: false,
        });
      }

      const tableGrants = await pool.query<{
        auth_delete: boolean;
        auth_insert: boolean;
        auth_select: boolean;
        auth_update: boolean;
        definer_delete: boolean;
        definer_full_select: boolean;
      }>(
        `select
           pg_catalog.has_table_privilege($1, 'public.auth_sessions', 'SELECT') as auth_select,
           pg_catalog.has_table_privilege($1, 'public.auth_sessions', 'INSERT') as auth_insert,
           pg_catalog.has_table_privilege($1, 'public.auth_sessions', 'UPDATE') as auth_update,
           pg_catalog.has_table_privilege($1, 'public.auth_sessions', 'DELETE') as auth_delete,
           pg_catalog.has_table_privilege($2, 'public.auth_sessions', 'SELECT') as definer_full_select,
           pg_catalog.has_table_privilege($2, 'public.auth_sessions', 'DELETE') as definer_delete`,
        [AUTH_ROLE, DEFINER_ROLE],
      );
      expect(tableGrants.rows[0]).toEqual({
        auth_delete: false,
        auth_insert: false,
        auth_select: false,
        auth_update: false,
        definer_delete: false,
        definer_full_select: false,
      });

      for (const role of ["lead_agent_runtime", "lead_agent_ingress"]) {
        await withRole(pool, role, async (client) => {
          await expect(client.query("select * from auth_sessions")).rejects.toMatchObject({
            code: "42501",
          });
        });
      }
    });

    it("uses NOLOGIN SECURITY DEFINER ownership, fixed search paths, and no tenant tables", async () => {
      const state = await harness.privilegedPool().query<{
        definition: string;
        owner_name: string;
        proconfig: string[] | null;
        prosecdef: boolean;
      }>(
        `select pg_catalog.pg_get_userbyid(proc.proowner) as owner_name,
                proc.prosecdef, proc.proconfig, pg_catalog.pg_get_functiondef(proc.oid) as definition
           from pg_catalog.pg_proc proc
           join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
          where namespace.nspname = 'app'
            and proc.proname = any($1::text[])
          order by proc.proname`,
        [
          [
            "create_application_session",
            "resolve_application_session",
            "revoke_application_session",
            "revoke_user_application_sessions",
            "rotate_application_session",
          ],
        ],
      );
      expect(state.rows).toHaveLength(5);
      for (const functionState of state.rows) {
        expect(functionState).toMatchObject({
          owner_name: DEFINER_ROLE,
          proconfig: ["search_path=pg_catalog"],
          prosecdef: true,
        });
        const definition = functionState.definition.toLowerCase();
        expect(definition).toContain("public.auth_sessions");
        expect(definition).not.toContain("memberships");
        expect(definition).not.toContain("organizations");
        expect(definition).not.toMatch(/\bexecute\b/u);
        expect(definition).not.toMatch(/\bformat\s*\(/u);
      }
    });

    it("rejects session operations through a non-authentication runtime role", async () => {
      const wrongRole = createSessionDatabaseRuntime(harness.runtimeConfiguration(), {
        onUnexpectedPoolError: () => undefined,
      });
      try {
        await expect(wrongRole.resolveSession(new Uint8Array(32))).rejects.toBeInstanceOf(
          SessionDatabaseRoleError,
        );
      } finally {
        await wrongRole.close();
      }
    });
  });
};
