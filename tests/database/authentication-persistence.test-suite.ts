import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const RUNTIME_ROLE = "lead_agent_runtime";
const INGRESS_ROLE = "lead_agent_ingress";
const INBOUND_DEFINER_ROLE = "lead_agent_inbound_route_definer";

const ORGANIZATION_A = "0193f1a8-7f65-7c28-a434-a10796c46101";
const ORGANIZATION_B = "0193f1a8-7f65-7c28-a434-a10796c46102";
const USER_A = "0193f1a8-7f65-7c28-a434-a10796c46103";
const USER_B = "0193f1a8-7f65-7c28-a434-a10796c46104";
const MEMBERSHIP_A = "0193f1a8-7f65-7c28-a434-a10796c46105";
const MEMBERSHIP_B = "0193f1a8-7f65-7c28-a434-a10796c46106";
const LOCATION_A = "0193f1a8-7f65-7c28-a434-a10796c46107";
const LOCATION_B = "0193f1a8-7f65-7c28-a434-a10796c46108";

const syntheticUuid = (suffix: number): string =>
  `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;

type AuthenticationPersistenceHarness = Readonly<{
  privilegedPool: () => Pool;
}>;

const readObjectProperty = (value: unknown, property: PropertyKey): unknown =>
  typeof value === "object" && value !== null
    ? (Reflect.get(value, property) as unknown)
    : undefined;

const expectDatabaseError = async (
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(readObjectProperty(error, "code")).toBe(code);
  if (constraint !== undefined) {
    expect(readObjectProperty(error, "constraint")).toBe(constraint);
  }
};

const bytes = (value: string): Buffer => Buffer.from(value.padEnd(24, "-"), "utf8");

const seedTenant = async (
  pool: Pool,
  organizationId: string,
  userId: string,
  membershipId: string,
  locationId: string,
  slug: string,
): Promise<void> => {
  await pool.query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values ($1, $2, 'S6.1 Synthetic Clinic', 'active', 'en', 'Asia/Tashkent')`,
    [organizationId, slug],
  );
  await pool.query("insert into users (id, status) values ($1, 'active')", [userId]);
  await pool.query(
    `insert into memberships
      (id, organization_id, user_id, role, status, location_scope, activated_at)
     values ($1, $2, $3, 'owner', 'active', 'all', now())`,
    [membershipId, organizationId, userId],
  );
  await pool.query(
    `insert into locations (id, organization_id, code, status)
     values ($1, $2, 'main', 'active')`,
    [locationId, organizationId],
  );
};

const insertActiveInvitation = async (
  client: Pool | PoolClient,
  id: string,
  organizationId: string,
  invitedByMembershipId: string,
  targetHash: Uint8Array,
  tokenHash: Uint8Array,
): Promise<void> => {
  await client.query(
    `insert into membership_invitations
      (id, organization_id, target_ciphertext, target_lookup_hash, role,
       location_scope, token_hash, status, invited_by_membership_id,
       expires_at, created_at, updated_at)
     values
      ($1, $2, $3, $4, 'staff', 'restricted', $5, 'active', $6,
       now() + interval '7 days', now(), now())`,
    [
      id,
      organizationId,
      bytes("encrypted-invitation-target"),
      targetHash,
      tokenHash,
      invitedByMembershipId,
    ],
  );
};

const waitForLock = async (pool: Pool, processId: number): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = await pool.query<{ wait_event_type: string | null }>(
      "select wait_event_type from pg_catalog.pg_stat_activity where pid = $1",
      [processId],
    );
    if (state.rows[0]?.wait_event_type === "Lock") {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Competing invitation insert did not reach a PostgreSQL lock wait");
};

export const registerAuthenticationPersistenceTests = (
  harness: AuthenticationPersistenceHarness,
): void => {
  describe("S6.1 authentication persistence", () => {
    it("installs exactly the frozen four-table column manifest without authority or raw secrets", async () => {
      const columns = await harness.privilegedPool().query<{
        column_name: string;
        table_name: string;
      }>(
        `select table_name, column_name
           from information_schema.columns
          where table_schema = 'public'
            and table_name = any($1::text[])
          order by table_name, ordinal_position`,
        [
          [
            "auth_sessions",
            "external_identities",
            "membership_invitations",
            "membership_location_scopes",
          ],
        ],
      );

      const columnNames = (tableName: string): string[] =>
        columns.rows
          .filter(({ table_name }) => table_name === tableName)
          .map(({ column_name }) => column_name);
      expect(columnNames("external_identities")).toEqual([
        "id",
        "user_id",
        "issuer",
        "subject",
        "status",
        "linked_at",
        "last_authenticated_at",
        "disabled_at",
        "unlinked_at",
        "created_at",
        "updated_at",
        "version",
      ]);
      expect(columnNames("membership_invitations")).toEqual([
        "id",
        "organization_id",
        "target_ciphertext",
        "target_lookup_hash",
        "role",
        "location_scope",
        "token_hash",
        "status",
        "invited_by_membership_id",
        "expires_at",
        "accepted_at",
        "accepted_by_user_id",
        "revoked_at",
        "revoked_by_membership_id",
        "revocation_reason",
        "expired_at",
        "created_at",
        "updated_at",
        "version",
      ]);
      expect(columnNames("auth_sessions")).toEqual([
        "id",
        "user_id",
        "session_token_hash",
        "csrf_secret_hash",
        "status",
        "authentication_time",
        "authentication_level",
        "created_at",
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at",
        "revoked_at",
        "revocation_reason",
        "source_ip_hash",
        "user_agent_hash",
        "rotated_at",
      ]);
      expect(columnNames("membership_location_scopes")).toEqual([
        "organization_id",
        "membership_id",
        "location_id",
        "created_at",
        "created_by_user_id",
      ]);

      const forbiddenColumns = new Set([
        "access_token",
        "csrf_secret",
        "email",
        "organization_claim",
        "permission_snapshot",
        "raw_token",
        "refresh_token",
        "role_snapshot",
        "session_token",
      ]);
      expect(columns.rows.some(({ column_name }) => forbiddenColumns.has(column_name))).toBe(false);
      expect(columnNames("external_identities")).not.toContain("organization_id");
      expect(columnNames("auth_sessions")).not.toContain("organization_id");
    });

    it("persists provider-neutral 1:N external identities and historical statuses", async () => {
      const pool = harness.privilegedPool();
      await pool.query("insert into users (id, status) values ($1, 'active')", [USER_A]);

      await pool.query(
        `insert into external_identities
          (id, user_id, issuer, subject, status, linked_at, last_authenticated_at,
           disabled_at, unlinked_at)
         values
          ($1, $2, 'https://issuer-a.example/', 'same-subject', 'active', now(), now(),
           null, null),
          ($3, $2, 'https://issuer-b.example/', 'same-subject', 'disabled', now(), now(),
           now(), null),
          ($4, $2, 'https://issuer-a.example/', 'second-subject', 'unlinked', now(), null,
           null, now())`,
        [syntheticUuid(0x46110), USER_A, syntheticUuid(0x46111), syntheticUuid(0x46112)],
      );

      const identities = await pool.query<{ status: string }>(
        "select status from external_identities where user_id = $1 order by status",
        [USER_A],
      );
      expect(identities.rows.map(({ status }) => status)).toEqual([
        "active",
        "disabled",
        "unlinked",
      ]);
    });

    it("enforces external identity uniqueness, lifecycle, and User integrity", async () => {
      const pool = harness.privilegedPool();
      await pool.query("insert into users (id, status) values ($1, 'active'), ($2, 'active')", [
        USER_A,
        USER_B,
      ]);
      await pool.query(
        `insert into external_identities
          (id, user_id, issuer, subject, status, linked_at)
         values ($1, $2, 'https://issuer.example/', 'subject', 'active', now())`,
        [syntheticUuid(0x46120), USER_A],
      );

      await expectDatabaseError(
        pool.query(
          `insert into external_identities
            (id, user_id, issuer, subject, status, linked_at)
           values ($1, $2, 'https://issuer.example/', 'subject', 'active', now())`,
          [syntheticUuid(0x46121), USER_B],
        ),
        "23505",
        "external_identities_issuer_subject_unique",
      );
      await expectDatabaseError(
        pool.query(
          `insert into external_identities
            (id, user_id, issuer, subject, status, linked_at)
           values ($1, $2, 'https://issuer.example/', 'invalid', 'unknown', now())`,
          [syntheticUuid(0x46122), USER_A],
        ),
        "23514",
      );
      await expectDatabaseError(
        pool.query(
          `insert into external_identities
            (id, user_id, issuer, subject, status, linked_at)
           values ($1, $2, 'https://issuer.example/', 'disabled-without-time', 'disabled', now())`,
          [syntheticUuid(0x46123), USER_A],
        ),
        "23514",
        "external_identities_lifecycle_check",
      );
      await expectDatabaseError(
        pool.query(
          `insert into external_identities
            (id, user_id, issuer, subject, status, linked_at)
           values ($1, $2, 'https://issuer.example/', 'unknown-user', 'active', now())`,
          [syntheticUuid(0x46124), syntheticUuid(0x46fff)],
        ),
        "23503",
        "external_identities_user_id_users_id_fk",
      );
    });

    it("persists an active seven-day invitation before the target User exists", async () => {
      const pool = harness.privilegedPool();
      await seedTenant(pool, ORGANIZATION_A, USER_A, MEMBERSHIP_A, LOCATION_A, "s61-invitation");
      await insertActiveInvitation(
        pool,
        syntheticUuid(0x46130),
        ORGANIZATION_A,
        MEMBERSHIP_A,
        bytes("canonical-target-a"),
        bytes("invitation-token-a"),
      );

      const invitation = await pool.query<{
        lifetime_seconds: number;
        target_user_columns: number;
      }>(
        `select extract(epoch from (expires_at - created_at))::integer as lifetime_seconds,
                (
                  select count(*)::integer
                    from information_schema.columns
                   where table_schema = 'public'
                     and table_name = 'membership_invitations'
                     and column_name = 'user_id'
                ) as target_user_columns
           from membership_invitations`,
      );
      expect(invitation.rows).toEqual([{ lifetime_seconds: 604800, target_user_columns: 0 }]);
    });

    it("enforces invitation roles, location modes, token uniqueness, and lifecycle evidence", async () => {
      const pool = harness.privilegedPool();
      await seedTenant(
        pool,
        ORGANIZATION_A,
        USER_A,
        MEMBERSHIP_A,
        LOCATION_A,
        "s61-invitation-checks",
      );
      await insertActiveInvitation(
        pool,
        syntheticUuid(0x46140),
        ORGANIZATION_A,
        MEMBERSHIP_A,
        bytes("canonical-target-b"),
        bytes("invitation-token-b"),
      );

      await expectDatabaseError(
        pool.query(
          `insert into membership_invitations
            (id, organization_id, target_ciphertext, target_lookup_hash, role,
             location_scope, token_hash, status, invited_by_membership_id,
             expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, 'owner', 'restricted', $5, 'active', $6,
                   now() + interval '7 days', now(), now())`,
          [
            syntheticUuid(0x46141),
            ORGANIZATION_A,
            bytes("encrypted-owner-target"),
            bytes("canonical-owner-target"),
            bytes("invitation-token-c"),
            MEMBERSHIP_A,
          ],
        ),
        "23514",
        "membership_invitations_location_scope_check",
      );
      await expectDatabaseError(
        pool.query(
          `insert into membership_invitations
            (id, organization_id, target_ciphertext, target_lookup_hash, role,
             location_scope, token_hash, status, invited_by_membership_id,
             expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, 'staff', 'restricted', $5, 'accepted', $6,
                   now() + interval '7 days', now(), now())`,
          [
            syntheticUuid(0x46142),
            ORGANIZATION_A,
            bytes("encrypted-accepted-target"),
            bytes("canonical-accepted-target"),
            bytes("invitation-token-d"),
            MEMBERSHIP_A,
          ],
        ),
        "23514",
        "membership_invitations_lifecycle_check",
      );
      await expectDatabaseError(
        pool.query(
          `insert into membership_invitations
            (id, organization_id, target_ciphertext, target_lookup_hash, role,
             location_scope, token_hash, status, invited_by_membership_id,
             expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, 'staff', 'restricted', $5, 'active', $6,
                   now() + interval '7 days', now(), now())`,
          [
            syntheticUuid(0x46143),
            ORGANIZATION_A,
            bytes("encrypted-duplicate-token"),
            bytes("different-target"),
            bytes("invitation-token-b"),
            MEMBERSHIP_A,
          ],
        ),
        "23505",
        "membership_invitations_token_hash_unique",
      );
    });

    it("retains accepted, revoked, and expired invitations without blocking a later active target", async () => {
      const pool = harness.privilegedPool();
      await seedTenant(
        pool,
        ORGANIZATION_A,
        USER_A,
        MEMBERSHIP_A,
        LOCATION_A,
        "s61-invitation-history",
      );
      const targetHash = bytes("canonical-history-target");
      await pool.query(
        `insert into membership_invitations
          (id, organization_id, target_ciphertext, target_lookup_hash, role,
           location_scope, token_hash, status, invited_by_membership_id,
           expires_at, accepted_at, accepted_by_user_id, created_at, updated_at)
         values
          ($1, $2, $3, $4, 'staff', 'restricted', $5, 'accepted', $6,
           now() + interval '7 days', now(), $7, now(), now())`,
        [
          syntheticUuid(0x46150),
          ORGANIZATION_A,
          bytes("accepted-target"),
          targetHash,
          bytes("accepted-token"),
          MEMBERSHIP_A,
          USER_A,
        ],
      );
      await pool.query(
        `insert into membership_invitations
          (id, organization_id, target_ciphertext, target_lookup_hash, role,
           location_scope, token_hash, status, invited_by_membership_id,
           expires_at, revoked_at, revoked_by_membership_id, revocation_reason,
           created_at, updated_at)
         values
          ($1, $2, $3, $4, 'staff', 'restricted', $5, 'revoked', $6,
           now() + interval '7 days', now(), $6, 'resend', now(), now())`,
        [
          syntheticUuid(0x46151),
          ORGANIZATION_A,
          bytes("revoked-target"),
          targetHash,
          bytes("revoked-token"),
          MEMBERSHIP_A,
        ],
      );
      await pool.query(
        `insert into membership_invitations
          (id, organization_id, target_ciphertext, target_lookup_hash, role,
           location_scope, token_hash, status, invited_by_membership_id,
           expires_at, expired_at, created_at, updated_at)
         values
          ($1, $2, $3, $4, 'staff', 'restricted', $5, 'expired', $6,
           now() - interval '1 day', now(), now() - interval '8 days',
           now() - interval '1 day')`,
        [
          syntheticUuid(0x46152),
          ORGANIZATION_A,
          bytes("expired-target"),
          targetHash,
          bytes("expired-token"),
          MEMBERSHIP_A,
        ],
      );
      await insertActiveInvitation(
        pool,
        syntheticUuid(0x46153),
        ORGANIZATION_A,
        MEMBERSHIP_A,
        targetHash,
        bytes("replacement-active-token"),
      );

      const statuses = await pool.query<{ status: string }>(
        "select status from membership_invitations order by status",
      );
      expect(statuses.rows.map(({ status }) => status)).toEqual([
        "accepted",
        "active",
        "expired",
        "revoked",
      ]);
    });

    it("enforces one active invitation per Organization and target under concurrency", async () => {
      const pool = harness.privilegedPool();
      await seedTenant(
        pool,
        ORGANIZATION_A,
        USER_A,
        MEMBERSHIP_A,
        LOCATION_A,
        "s61-invitation-race",
      );
      const firstClient = await pool.connect();
      const competingClient = await pool.connect();
      let competingAttempt: Promise<unknown> | undefined;
      try {
        await firstClient.query("begin");
        await competingClient.query("begin");
        await insertActiveInvitation(
          firstClient,
          syntheticUuid(0x46160),
          ORGANIZATION_A,
          MEMBERSHIP_A,
          bytes("race-target"),
          bytes("race-token-a"),
        );
        const process = await competingClient.query<{ pid: number }>(
          "select pg_catalog.pg_backend_pid() as pid",
        );
        const processId = process.rows[0]?.pid;
        if (processId === undefined) {
          throw new Error("Unable to identify competing invitation database session");
        }
        competingAttempt = insertActiveInvitation(
          competingClient,
          syntheticUuid(0x46161),
          ORGANIZATION_A,
          MEMBERSHIP_A,
          bytes("race-target"),
          bytes("race-token-b"),
        ).then(
          () => ({ succeeded: true }),
          (error: unknown) => ({ error, succeeded: false }),
        );
        await waitForLock(pool, processId);
        await firstClient.query("commit");

        const outcome = await competingAttempt;
        expect(readObjectProperty(outcome, "succeeded")).toBe(false);
        expect(readObjectProperty(readObjectProperty(outcome, "error"), "code")).toBe("23505");
        expect(readObjectProperty(readObjectProperty(outcome, "error"), "constraint")).toBe(
          "membership_invitations_one_active_target_unique",
        );
        await competingClient.query("rollback");
      } finally {
        await firstClient.query("rollback").catch(() => undefined);
        if (competingAttempt !== undefined) {
          await competingAttempt;
        }
        await competingClient.query("rollback").catch(() => undefined);
        firstClient.release();
        competingClient.release();
      }
    });

    it("persists only hash-based sessions and supports rotation and revocation state", async () => {
      const pool = harness.privilegedPool();
      await pool.query("insert into users (id, status) values ($1, 'active')", [USER_A]);
      const sessionId = syntheticUuid(0x46170);
      await pool.query(
        `insert into auth_sessions
          (id, user_id, session_token_hash, csrf_secret_hash, status,
           authentication_time, authentication_level, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at, source_ip_hash, user_agent_hash)
         values
          ($1, $2, $3, $4, 'active', now(), 'mfa', now(), now(),
           now() + interval '60 minutes', now() + interval '12 hours', $5, $6)`,
        [
          sessionId,
          USER_A,
          bytes("session-token-hash-a"),
          bytes("csrf-secret-hash-a"),
          bytes("source-ip-hash-a"),
          bytes("user-agent-hash-a"),
        ],
      );
      await pool.query(
        `update auth_sessions
            set session_token_hash = $2,
                status = 'revoked',
                revoked_at = now(),
                revocation_reason = 'sign_out_all'
          where id = $1`,
        [sessionId, bytes("rotated-session-hash")],
      );
      const session = await pool.query<{
        revocation_reason: string;
        status: string;
      }>("select status, revocation_reason from auth_sessions where id = $1", [sessionId]);
      expect(session.rows).toEqual([{ revocation_reason: "sign_out_all", status: "revoked" }]);
    });

    it("rejects duplicate, orphaned, and internally invalid auth sessions", async () => {
      const pool = harness.privilegedPool();
      await pool.query("insert into users (id, status) values ($1, 'active')", [USER_A]);
      const tokenHash = bytes("session-token-hash-b");
      await pool.query(
        `insert into auth_sessions
          (id, user_id, session_token_hash, csrf_secret_hash, status,
           authentication_time, authentication_level, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at)
         values
          ($1, $2, $3, $4, 'active', now(), 'mfa', now(), now(),
           now() + interval '60 minutes', now() + interval '12 hours')`,
        [syntheticUuid(0x46180), USER_A, tokenHash, bytes("csrf-secret-hash-b")],
      );
      await expectDatabaseError(
        pool.query(
          `insert into auth_sessions
            (id, user_id, session_token_hash, csrf_secret_hash, status,
             authentication_time, authentication_level, created_at, last_seen_at,
             idle_expires_at, absolute_expires_at)
           values
            ($1, $2, $3, $4, 'active', now(), 'mfa', now(), now(),
             now() + interval '60 minutes', now() + interval '12 hours')`,
          [syntheticUuid(0x46181), USER_A, tokenHash, bytes("csrf-secret-hash-c")],
        ),
        "23505",
        "auth_sessions_session_token_hash_unique",
      );
      await expectDatabaseError(
        pool.query(
          `insert into auth_sessions
            (id, user_id, session_token_hash, csrf_secret_hash, status,
             authentication_time, authentication_level, created_at, last_seen_at,
             idle_expires_at, absolute_expires_at)
           values
            ($1, $2, $3, $4, 'active', now(), 'mfa', now(), now(),
             now() - interval '1 minute', now() + interval '12 hours')`,
          [
            syntheticUuid(0x46182),
            USER_A,
            bytes("session-token-hash-c"),
            bytes("csrf-secret-hash-d"),
          ],
        ),
        "23514",
        "auth_sessions_lifetime_check",
      );
      await expectDatabaseError(
        pool.query(
          `insert into auth_sessions
            (id, user_id, session_token_hash, csrf_secret_hash, status,
             authentication_time, authentication_level, created_at, last_seen_at,
             idle_expires_at, absolute_expires_at)
           values
            ($1, $2, $3, $4, 'active', now(), 'mfa', now(), now(),
             now() + interval '60 minutes', now() + interval '12 hours')`,
          [
            syntheticUuid(0x46183),
            syntheticUuid(0x46ffe),
            bytes("session-token-hash-d"),
            bytes("csrf-secret-hash-e"),
          ],
        ),
        "23503",
        "auth_sessions_user_id_users_id_fk",
      );
    });

    it("enforces owner/admin all-location membership persistence", async () => {
      const pool = harness.privilegedPool();
      await pool.query(
        `insert into organizations
          (id, slug, display_name, status, default_locale, default_time_zone)
         values ($1, 's61-membership-scope', 'S6.1 Scope Clinic', 'active', 'en', 'UTC')`,
        [ORGANIZATION_A],
      );
      await pool.query("insert into users (id, status) values ($1, 'active')", [USER_A]);
      await expectDatabaseError(
        pool.query(
          `insert into memberships
            (id, organization_id, user_id, role, status, location_scope, activated_at)
           values ($1, $2, $3, 'owner', 'active', 'restricted', now())`,
          [MEMBERSHIP_A, ORGANIZATION_A, USER_A],
        ),
        "23514",
        "memberships_role_location_scope_check",
      );
      expect(
        (
          await pool.query(
            `insert into memberships
              (id, organization_id, user_id, role, status, location_scope, activated_at)
             values ($1, $2, $3, 'staff', 'active', 'restricted', now())`,
            [MEMBERSHIP_A, ORGANIZATION_A, USER_A],
          )
        ).rowCount,
      ).toBe(1);
    });

    it("enforces unique same-Organization Membership and Location scopes", async () => {
      const pool = harness.privilegedPool();
      await seedTenant(pool, ORGANIZATION_A, USER_A, MEMBERSHIP_A, LOCATION_A, "s61-location-a");
      await seedTenant(pool, ORGANIZATION_B, USER_B, MEMBERSHIP_B, LOCATION_B, "s61-location-b");
      await pool.query(
        `insert into membership_location_scopes
          (organization_id, membership_id, location_id, created_by_user_id)
         values ($1, $2, $3, $4)`,
        [ORGANIZATION_A, MEMBERSHIP_A, LOCATION_A, USER_A],
      );
      await expectDatabaseError(
        pool.query(
          `insert into membership_location_scopes
            (organization_id, membership_id, location_id, created_by_user_id)
           values ($1, $2, $3, $4)`,
          [ORGANIZATION_A, MEMBERSHIP_A, LOCATION_A, USER_A],
        ),
        "23505",
        "membership_location_scopes_pk",
      );
      await expectDatabaseError(
        pool.query(
          `insert into membership_location_scopes
            (organization_id, membership_id, location_id, created_by_user_id)
           values ($1, $2, $3, $4)`,
          [ORGANIZATION_A, MEMBERSHIP_A, LOCATION_B, USER_A],
        ),
        "23503",
        "membership_location_scopes_location_fk",
      );
      await expectDatabaseError(
        pool.query(
          `insert into membership_location_scopes
            (organization_id, membership_id, location_id, created_by_user_id)
           values ($1, $2, $3, $4)`,
          [ORGANIZATION_A, MEMBERSHIP_B, LOCATION_A, USER_A],
        ),
        "23503",
        "membership_location_scopes_membership_fk",
      );
    });

    it("classifies tenant and global authentication tables without broad grants", async () => {
      const pool = harness.privilegedPool();
      const security = await pool.query<{
        relforcerowsecurity: boolean;
        relname: string;
        relrowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity
           from pg_catalog.pg_class
          where relnamespace = 'public'::regnamespace
            and relname = any($1::text[])
          order by relname`,
        [
          [
            "auth_sessions",
            "external_identities",
            "membership_invitations",
            "membership_location_scopes",
          ],
        ],
      );
      expect(security.rows).toEqual([
        { relforcerowsecurity: false, relname: "auth_sessions", relrowsecurity: false },
        { relforcerowsecurity: false, relname: "external_identities", relrowsecurity: false },
        {
          relforcerowsecurity: true,
          relname: "membership_invitations",
          relrowsecurity: true,
        },
        {
          relforcerowsecurity: true,
          relname: "membership_location_scopes",
          relrowsecurity: true,
        },
      ]);

      const policies = await pool.query<{
        policyname: string;
        roles: string;
        tablename: string;
      }>(
        `select tablename, policyname, roles::text
           from pg_catalog.pg_policies
          where schemaname = 'public'
            and tablename = any($1::text[])
          order by tablename`,
        [["membership_invitations", "membership_location_scopes"]],
      );
      expect(policies.rows).toEqual([
        {
          policyname: "membership_invitations_tenant_isolation",
          roles: "{lead_agent_runtime}",
          tablename: "membership_invitations",
        },
        {
          policyname: "membership_location_scopes_authorization_resolution",
          roles: "{lead_agent_identity_definer}",
          tablename: "membership_location_scopes",
        },
        {
          policyname: "membership_location_scopes_tenant_isolation",
          roles: "{lead_agent_runtime}",
          tablename: "membership_location_scopes",
        },
      ]);

      for (const role of [RUNTIME_ROLE, INGRESS_ROLE, INBOUND_DEFINER_ROLE]) {
        for (const table of [
          "auth_sessions",
          "external_identities",
          "membership_invitations",
          "membership_location_scopes",
        ]) {
          const privilege = await pool.query<{ has_any_access: boolean }>(
            `select pg_catalog.has_table_privilege($1, $2, 'SELECT')
                    or pg_catalog.has_table_privilege($1, $2, 'INSERT')
                    or pg_catalog.has_table_privilege($1, $2, 'UPDATE')
                    or pg_catalog.has_table_privilege($1, $2, 'DELETE')
                      as has_any_access`,
            [role, `public.${table}`],
          );
          expect(privilege.rows[0]?.has_any_access).toBe(false);
        }
      }
    });

    it("keeps all four S6.1 tables unavailable through existing runtime and ingress roles", async () => {
      const pool = harness.privilegedPool();
      for (const role of [RUNTIME_ROLE, INGRESS_ROLE]) {
        const client = await pool.connect();
        try {
          await client.query(`set role ${role}`);
          await client.query("begin");
          if (role === RUNTIME_ROLE) {
            await client.query("select set_config('app.organization_id', $1, true)", [
              ORGANIZATION_A,
            ]);
          }
          for (const table of [
            "auth_sessions",
            "external_identities",
            "membership_invitations",
            "membership_location_scopes",
          ]) {
            await client.query("savepoint denied_table");
            await expectDatabaseError(client.query(`select * from ${table}`), "42501");
            await client.query("rollback to savepoint denied_table");
            await client.query("release savepoint denied_table");
          }
          await client.query("rollback");
        } finally {
          await client.query("rollback").catch(() => undefined);
          await client.query("reset role");
          client.release();
        }
      }
    });
  });
};
