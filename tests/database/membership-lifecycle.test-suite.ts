import {
  CorrelationIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  isSchemaValue,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type ResourceId,
  type UserId,
} from "@lead-agent/contracts";
import type {
  AuthorizationDatabaseRuntime,
  MembershipLifecycleDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  InvitationTokenInvalidError,
  MembershipFinalOwnerError,
  MembershipLifecycleConflictError,
  MembershipLifecyclePermissionDeniedError,
  createInvitationEmailTargetProtector,
  createMembershipLifecycle,
  createOidcIdentityVerifier,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type MembershipLifecycle,
  type MembershipRole,
  type MembershipStatus,
  type SecurityIdentifierFactory,
  type ValidatedOidcIdentity,
} from "@lead-agent/security";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

export type MembershipLifecycleHarness = Readonly<{
  authorizationRuntime: () => AuthorizationDatabaseRuntime;
  privilegedPool: () => Pool;
  runtime: () => MembershipLifecycleDatabaseRuntime;
}>;

const raw = {
  adminMembership: "0193f1a8-7f65-7c28-a434-a10796c46601",
  adminUser: "0193f1a8-7f65-7c28-a434-a10796c46602",
  audit: "0193f1a8-7f65-7c28-a434-a10796c46603",
  correlation: "0193f1a8-7f65-7c28-a434-a10796c46604",
  foreignLocation: "0193f1a8-7f65-7c28-a434-a10796c46605",
  foreignOrganization: "0193f1a8-7f65-7c28-a434-a10796c46606",
  locationA: "0193f1a8-7f65-7c28-a434-a10796c46607",
  locationB: "0193f1a8-7f65-7c28-a434-a10796c46608",
  newIdentity: "0193f1a8-7f65-7c28-a434-a10796c46609",
  organization: "0193f1a8-7f65-7c28-a434-a10796c4660a",
  otherOwnerMembership: "0193f1a8-7f65-7c28-a434-a10796c4660b",
  otherOwnerUser: "0193f1a8-7f65-7c28-a434-a10796c4660c",
  ownerMembership: "0193f1a8-7f65-7c28-a434-a10796c4660d",
  ownerUser: "0193f1a8-7f65-7c28-a434-a10796c4660e",
  request: "request.s65.database.0001",
  staffMembership: "0193f1a8-7f65-7c28-a434-a10796c4660f",
  staffUser: "0193f1a8-7f65-7c28-a434-a10796c46610",
} as const;

if (
  !isSchemaValue(OrganizationIdSchema, raw.organization) ||
  !isSchemaValue(OrganizationIdSchema, raw.foreignOrganization) ||
  !isSchemaValue(UserIdSchema, raw.ownerUser) ||
  !isSchemaValue(UserIdSchema, raw.otherOwnerUser) ||
  !isSchemaValue(UserIdSchema, raw.adminUser) ||
  !isSchemaValue(UserIdSchema, raw.staffUser) ||
  !isSchemaValue(MembershipIdSchema, raw.ownerMembership) ||
  !isSchemaValue(MembershipIdSchema, raw.otherOwnerMembership) ||
  !isSchemaValue(MembershipIdSchema, raw.adminMembership) ||
  !isSchemaValue(MembershipIdSchema, raw.staffMembership) ||
  !isSchemaValue(LocationIdSchema, raw.locationA) ||
  !isSchemaValue(LocationIdSchema, raw.locationB) ||
  !isSchemaValue(LocationIdSchema, raw.foreignLocation) ||
  !isSchemaValue(ResourceIdSchema, raw.audit) ||
  !isSchemaValue(ResourceIdSchema, raw.newIdentity) ||
  !isSchemaValue(CorrelationIdSchema, raw.correlation) ||
  !isSchemaValue(RequestIdSchema, raw.request)
) {
  throw new TypeError("Invalid S6.5 database test identifiers");
}

const ORGANIZATION_ID: OrganizationId = raw.organization;
const FOREIGN_ORGANIZATION_ID: OrganizationId = raw.foreignOrganization;
const OWNER_USER_ID: UserId = raw.ownerUser;
const OTHER_OWNER_USER_ID: UserId = raw.otherOwnerUser;
const ADMIN_USER_ID: UserId = raw.adminUser;
const STAFF_USER_ID: UserId = raw.staffUser;
const OWNER_MEMBERSHIP_ID: MembershipId = raw.ownerMembership;
const OTHER_OWNER_MEMBERSHIP_ID: MembershipId = raw.otherOwnerMembership;
const ADMIN_MEMBERSHIP_ID: MembershipId = raw.adminMembership;
const STAFF_MEMBERSHIP_ID: MembershipId = raw.staffMembership;
const LOCATION_A: LocationId = raw.locationA;
const LOCATION_B: LocationId = raw.locationB;
const FOREIGN_LOCATION: LocationId = raw.foreignLocation;
const AUDIT_ID: ResourceId = raw.audit;
const NEW_IDENTITY_ID: ResourceId = raw.newIdentity;
const AUDIT = Object.freeze({ correlationId: raw.correlation, requestId: raw.request });
const targetProtector = createInvitationEmailTargetProtector({
  encryptionKey: new Uint8Array(32).fill(0x31),
  lookupKey: new Uint8Array(32).fill(0x52),
});

const sessionFor = (userId: UserId, now = new Date()): AuthenticatedApplicationSession =>
  Object.freeze({
    absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1_000),
    authenticationLevel: "mfa",
    authenticationTime: now,
    createdAt: now,
    idleExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    lastSeenAt: now,
    rotatedAt: now,
    rotationDue: false,
    sessionId: raw.audit,
    userId,
  });

const identity = async (subject: string): Promise<ValidatedOidcIdentity> =>
  createOidcIdentityVerifier({
    verifyEvidence: () => Promise.resolve({ issuer: "https://identity.s65.example/", subject }),
  }).verify({ expectedNonce: "test", idToken: "test" });

const insertOrganization = async (pool: Pool, id: OrganizationId, slug: string): Promise<void> => {
  await pool.query(
    `insert into organizations
      (id,slug,display_name,status,default_locale,default_time_zone)
     values ($1,$2,'S6.5 Fictional Clinic','active','en','Asia/Tashkent')`,
    [id, slug],
  );
};

const insertUser = async (
  pool: Pool,
  id: UserId,
  email = `${id.slice(-4)}@example.com`,
): Promise<void> => {
  const protectedTarget = targetProtector.protect(email);
  await pool.query(
    `insert into users
      (id,email_ciphertext,email_lookup_hash,status)
     values ($1,$2,$3,'active')`,
    [id, Buffer.from(protectedTarget.ciphertext), Buffer.from(protectedTarget.lookupHash)],
  );
};

const insertMembership = async (
  pool: Pool,
  id: MembershipId,
  userId: UserId,
  role: MembershipRole,
  status: MembershipStatus = "active",
  organizationId: OrganizationId = ORGANIZATION_ID,
): Promise<void> => {
  await pool.query(
    `insert into memberships
      (id,organization_id,user_id,role,status,location_scope,invited_at,activated_at,revoked_at,
       created_at,updated_at)
     values ($1,$2,$3,$4::varchar(16),$5::varchar(16),$6::varchar(16),
       case when $5::varchar(16)='invited' then now()-interval '1 minute' else null end,
       case when $5::varchar(16)<>'invited' then now()-interval '1 minute' else null end,
       case when $5::varchar(16)='revoked' then now()-interval '1 minute' else null end,
       now()-interval '1 minute',now()-interval '1 minute')`,
    [
      id,
      organizationId,
      userId,
      role,
      status,
      role === "owner" || role === "admin" ? "all" : "restricted",
    ],
  );
};

const insertIdentity = async (
  pool: Pool,
  id: ResourceId,
  userId: UserId,
  subject: string,
): Promise<void> => {
  await pool.query(
    `insert into external_identities
      (id,user_id,issuer,subject,status,linked_at)
     values ($1,$2,'https://identity.s65.example/',$3,'active',now())`,
    [id, userId, subject],
  );
};

const seedOwner = async (pool: Pool): Promise<void> => {
  await insertOrganization(pool, ORGANIZATION_ID, "s65-tenant");
  await insertUser(pool, OWNER_USER_ID);
  await insertMembership(pool, OWNER_MEMBERSHIP_ID, OWNER_USER_ID, "owner");
};

const contextFor = async (
  runtime: AuthorizationDatabaseRuntime,
  userId: UserId,
): Promise<AuthorizationContext> =>
  resolveAuthorizationContext(sessionFor(userId), ORGANIZATION_ID, runtime);

const lifecycleFor = (
  runtime: MembershipLifecycleDatabaseRuntime,
  verifiedTarget: string | null = "invitee@example.com",
  identifierFactory?: SecurityIdentifierFactory,
): MembershipLifecycle =>
  createMembershipLifecycle(
    runtime,
    targetProtector,
    { resolveVerifiedEmailTarget: () => Promise.resolve(verifiedTarget) },
    identifierFactory === undefined ? {} : { identifierFactory },
  );

const actorFor = async (authorizationRuntime: AuthorizationDatabaseRuntime, userId: UserId) => {
  const now = new Date();
  return Object.freeze({
    authorization: await contextFor(authorizationRuntime, userId),
    session: sessionFor(userId, now),
  });
};

const insertApplicationSession = async (
  pool: Pool,
  userId: UserId,
  suffix: number,
): Promise<void> => {
  const id = `0193f1a8-7f65-7c28-a434-a10796c46${suffix.toString(16).padStart(3, "0")}`;
  await pool.query(
    `insert into auth_sessions
      (id,user_id,session_token_hash,csrf_secret_hash,status,
       authentication_time,authentication_level,last_seen_at,idle_expires_at,
       absolute_expires_at,rotated_at)
     values ($1,$2,$3,$4,'active',now(),'mfa',now(),now()+interval '1 hour',
       now()+interval '12 hours',now())`,
    [id, userId, Buffer.alloc(32, suffix), Buffer.alloc(32, suffix + 1)],
  );
};

const expectFunctionDenied = async (pool: Pool, role: string, statement: string): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await expect(client.query(statement)).rejects.toMatchObject({ code: "42501" });
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
};

export const registerMembershipLifecycleTests = (harness: MembershipLifecycleHarness): void => {
  describe("S6.5 membership invitation and authority lifecycle", { timeout: 45_000 }, () => {
    it("installs only narrow owned functions and exact execution grants without weakening FORCE RLS", async () => {
      const pool = harness.privilegedPool();
      const functions = await pool.query<{
        name: string;
        owner: string;
        security_definer: boolean;
        settings: string[] | null;
      }>(
        `select proc.proname as name, owner.rolname as owner,
                proc.prosecdef as security_definer, proc.proconfig as settings
           from pg_catalog.pg_proc as proc
           join pg_catalog.pg_namespace as namespace on namespace.oid=proc.pronamespace
           join pg_catalog.pg_roles as owner on owner.oid=proc.proowner
          where namespace.nspname='app'
            and proc.proname=any($1::text[])
          order by proc.proname`,
        [["accept_membership_invitation", "revoke_membership_user_sessions"]],
      );
      expect(functions.rows).toEqual([
        {
          name: "accept_membership_invitation",
          owner: "lead_agent_membership_definer",
          security_definer: true,
          settings: ["search_path=pg_catalog"],
        },
        {
          name: "revoke_membership_user_sessions",
          owner: "lead_agent_membership_definer",
          security_definer: true,
          settings: ["search_path=pg_catalog"],
        },
      ]);
      const grants = await pool.query<{
        auth_accept: boolean;
        auth_revoke: boolean;
        public_accept: boolean;
        runtime_accept: boolean;
        runtime_revoke: boolean;
      }>(
        `select
          has_function_privilege('lead_agent_auth','app.accept_membership_invitation(uuid,bytea,bytea,character varying,character varying,uuid,uuid,uuid,uuid,uuid,uuid,uuid,character varying,uuid,character varying)','EXECUTE') as auth_accept,
          has_function_privilege('lead_agent_auth','app.revoke_membership_user_sessions(uuid,character varying)','EXECUTE') as auth_revoke,
          has_function_privilege('public','app.accept_membership_invitation(uuid,bytea,bytea,character varying,character varying,uuid,uuid,uuid,uuid,uuid,uuid,uuid,character varying,uuid,character varying)','EXECUTE') as public_accept,
          has_function_privilege('lead_agent_runtime','app.accept_membership_invitation(uuid,bytea,bytea,character varying,character varying,uuid,uuid,uuid,uuid,uuid,uuid,uuid,character varying,uuid,character varying)','EXECUTE') as runtime_accept,
          has_function_privilege('lead_agent_runtime','app.revoke_membership_user_sessions(uuid,character varying)','EXECUTE') as runtime_revoke`,
      );
      expect(grants.rows[0]).toEqual({
        auth_accept: true,
        auth_revoke: false,
        public_accept: false,
        runtime_accept: false,
        runtime_revoke: true,
      });
      await expectFunctionDenied(
        pool,
        "lead_agent_runtime",
        "select * from app.accept_membership_invitation(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)",
      );
      await expectFunctionDenied(
        pool,
        "lead_agent_auth",
        "select app.revoke_membership_user_sessions('018f0000-0000-7000-8000-000000000001','membership_changed')",
      );

      const definerRole = await pool.query<{
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        rolinherit: boolean;
        rolsuper: boolean;
      }>(
        `select rolcanlogin, rolinherit, rolsuper, rolbypassrls
           from pg_catalog.pg_roles
          where rolname='lead_agent_membership_definer'`,
      );
      expect(definerRole.rows).toEqual([
        { rolbypassrls: false, rolcanlogin: false, rolinherit: false, rolsuper: false },
      ]);

      const rls = await pool.query<{ force_row_security: boolean; row_security: boolean }>(
        `select relforcerowsecurity as force_row_security, relrowsecurity as row_security
           from pg_catalog.pg_class
          where oid='public.memberships'::regclass`,
      );
      expect(rls.rows[0]).toEqual({ force_row_security: true, row_security: true });
    });

    it("issues each owner-authorized role with hash-only seven-day storage and active uniqueness", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      const lifecycle = lifecycleFor(harness.runtime());
      const issuedTokens: string[] = [];
      for (const [index, role] of (["owner", "admin", "staff", "analyst"] as const).entries()) {
        const issued = await lifecycle.issueInvitation(actor, {
          audit: AUDIT,
          locationScope: role === "owner" || role === "admin" ? "all" : "restricted",
          role,
          target: `invitee${index}@EXAMPLE.COM`,
        });
        issuedTokens.push(issued.token);
      }
      const stored = await pool.query<{
        lifetime: string;
        target: Buffer;
        token_hash: Buffer;
      }>(
        `select (expires_at-created_at)::text as lifetime,target_ciphertext as target,token_hash
           from membership_invitations order by role`,
      );
      expect(stored.rows).toHaveLength(4);
      expect(
        stored.rows.every((row) => row.lifetime === "7 days" && row.token_hash.length === 32),
      ).toBe(true);
      for (const token of issuedTokens) {
        expect(
          stored.rows.every(
            (row) => !row.target.includes(token) && !row.token_hash.includes(token),
          ),
        ).toBe(true);
      }
      await expect(
        lifecycle.issueInvitation(actor, {
          audit: AUDIT,
          locationScope: "restricted",
          role: "staff",
          target: "invitee0@example.com",
        }),
      ).rejects.toBeInstanceOf(MembershipLifecycleConflictError);
      const issueRace = await Promise.allSettled([
        lifecycle.issueInvitation(actor, {
          audit: AUDIT,
          locationScope: "restricted",
          role: "staff",
          target: "race@example.com",
        }),
        lifecycle.issueInvitation(actor, {
          audit: AUDIT,
          locationScope: "restricted",
          role: "staff",
          target: "race@example.com",
        }),
      ]);
      expect(issueRace.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejectedIssue = issueRace.find((outcome) => outcome.status === "rejected");
      expect(
        rejectedIssue?.status === "rejected" ? rejectedIssue.reason : undefined,
      ).toBeInstanceOf(MembershipLifecycleConflictError);
      expect(
        (await pool.query("select id from membership_invitations where status='active'")).rowCount,
      ).toBe(5);
    });

    it("enforces owner/admin/staff invitation authority from current database state", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      await insertUser(pool, ADMIN_USER_ID);
      await insertMembership(pool, ADMIN_MEMBERSHIP_ID, ADMIN_USER_ID, "admin");
      await insertUser(pool, STAFF_USER_ID);
      await insertMembership(pool, STAFF_MEMBERSHIP_ID, STAFF_USER_ID, "staff");
      const lifecycle = lifecycleFor(harness.runtime());
      const admin = await actorFor(harness.authorizationRuntime(), ADMIN_USER_ID);
      await expect(
        lifecycle.issueInvitation(admin, {
          audit: AUDIT,
          locationScope: "all",
          role: "admin",
          target: "admin-target@example.com",
        }),
      ).resolves.toMatchObject({ deliveryTarget: "admin-target@example.com" });
      await expect(
        lifecycle.issueInvitation(admin, {
          audit: AUDIT,
          locationScope: "all",
          role: "owner",
          target: "owner-target@example.com",
        }),
      ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
      const staff = await actorFor(harness.authorizationRuntime(), STAFF_USER_ID);
      await expect(
        lifecycle.issueInvitation(staff, {
          audit: AUDIT,
          locationScope: "restricted",
          role: "staff",
          target: "staff-target@example.com",
        }),
      ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
      await pool.query("update memberships set status='suspended' where id=$1", [
        ADMIN_MEMBERSHIP_ID,
      ]);
      await expect(
        lifecycle.issueInvitation(admin, {
          audit: AUDIT,
          locationScope: "restricted",
          role: "staff",
          target: "stale@example.com",
        }),
      ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
    });

    it("atomically resends, retains history, invalidates old proof, revokes idempotently, and serializes races", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      const lifecycle = lifecycleFor(harness.runtime(), "resend@example.com");
      const first = await lifecycle.issueInvitation(actor, {
        audit: AUDIT,
        locationScope: "restricted",
        role: "staff",
        target: "resend@example.com",
      });
      const outcomes = await Promise.allSettled([
        lifecycle.resendInvitation(actor, { audit: AUDIT, invitationId: first.invitationId }),
        lifecycle.resendInvitation(actor, { audit: AUDIT, invitationId: first.invitationId }),
      ]);
      const successful = outcomes.filter((outcome) => outcome.status === "fulfilled");
      expect(successful).toHaveLength(1);
      const replacement = successful[0]?.status === "fulfilled" ? successful[0].value : undefined;
      expect(replacement?.token).not.toBe(first.token);
      expect(
        (await pool.query("select id from membership_invitations where status='active'")).rowCount,
      ).toBe(1);
      expect(
        (await pool.query("select id from membership_invitations where status='revoked'")).rowCount,
      ).toBe(1);
      await expect(
        lifecycle.acceptInvitation({
          audit: AUDIT,
          identity: await identity("resend-old"),
          organizationId: ORGANIZATION_ID,
          token: first.token,
        }),
      ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
      if (replacement === undefined) throw new Error("Expected one replacement invitation");
      await lifecycle.revokeInvitation(actor, {
        audit: AUDIT,
        invitationId: replacement.invitationId,
        reason: "access_not_required",
      });
      await expect(
        lifecycle.revokeInvitation(actor, {
          audit: AUDIT,
          invitationId: replacement.invitationId,
          reason: "access_not_required",
        }),
      ).resolves.toBeUndefined();
      await expect(
        lifecycle.acceptInvitation({
          audit: AUDIT,
          identity: await identity("resend-revoked"),
          organizationId: ORGANIZATION_ID,
          token: replacement.token,
        }),
      ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
    });

    it("onboards an unknown exact identity atomically without email auto-linking and rejects replay or tenant swaps", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      await insertOrganization(pool, FOREIGN_ORGANIZATION_ID, "s65-foreign");
      await insertUser(pool, STAFF_USER_ID, "invitee@example.com");
      await insertIdentity(pool, NEW_IDENTITY_ID, STAFF_USER_ID, "different-existing-subject");
      const lifecycle = lifecycleFor(harness.runtime(), "invitee@example.com");
      const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      const invitation = await lifecycle.issueInvitation(actor, {
        audit: AUDIT,
        locationScope: "restricted",
        role: "staff",
        target: "invitee@example.com",
      });
      await expect(
        lifecycle.acceptInvitation({
          audit: AUDIT,
          identity: await identity("new-subject"),
          organizationId: FOREIGN_ORGANIZATION_ID,
          token: invitation.token,
        }),
      ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
      const verifiedIdentity = await identity("new-subject");
      const acceptanceRace = await Promise.allSettled([
        lifecycle.acceptInvitation({
          audit: AUDIT,
          identity: verifiedIdentity,
          organizationId: ORGANIZATION_ID,
          token: invitation.token,
        }),
        lifecycle.acceptInvitation({
          audit: AUDIT,
          identity: verifiedIdentity,
          organizationId: ORGANIZATION_ID,
          token: invitation.token,
        }),
      ]);
      expect(acceptanceRace.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejectedAcceptance = acceptanceRace.find((outcome) => outcome.status === "rejected");
      expect(
        rejectedAcceptance?.status === "rejected" ? rejectedAcceptance.reason : undefined,
      ).toBeInstanceOf(InvitationTokenInvalidError);
      const acceptedOutcome = acceptanceRace.find((outcome) => outcome.status === "fulfilled");
      if (acceptedOutcome?.status !== "fulfilled") throw new Error("Expected one acceptance");
      const accepted = acceptedOutcome.value;
      expect(accepted).toMatchObject({
        externalIdentityCreated: true,
        membershipActivated: true,
        outcome: "activated",
        userCreated: true,
      });
      expect(accepted.userId).not.toBe(STAFF_USER_ID);
      const mapped = await pool.query<{ user_id: string }>(
        "select user_id::text from external_identities where issuer=$1 and subject=$2",
        ["https://identity.s65.example/", "new-subject"],
      );
      expect(mapped.rows).toEqual([{ user_id: accepted.userId }]);
      expect((await pool.query("select id from users")).rowCount).toBe(3);
      expect(
        (
          await pool.query("select id from memberships where organization_id=$1 and user_id=$2", [
            ORGANIZATION_ID,
            accepted.userId,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool.query(
            "select location_id from membership_location_scopes where membership_id=$1",
            [accepted.membershipId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await pool.query("select id from audit_events where correlation_id=$1", [raw.correlation]))
          .rowCount,
      ).toBe(5);
    });

    it("resolves exact existing identities, consumes invitations idempotently, and activates invited Memberships only", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      await insertUser(pool, STAFF_USER_ID, "existing@example.com");
      await insertIdentity(pool, NEW_IDENTITY_ID, STAFF_USER_ID, "existing-subject");
      await insertMembership(pool, STAFF_MEMBERSHIP_ID, STAFF_USER_ID, "staff", "active");
      const lifecycle = lifecycleFor(harness.runtime(), "existing@example.com");
      const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      const invitation = await lifecycle.issueInvitation(actor, {
        audit: AUDIT,
        locationScope: "all",
        role: "analyst",
        target: "existing@example.com",
      });
      const accepted = await lifecycle.acceptInvitation({
        audit: AUDIT,
        identity: await identity("existing-subject"),
        organizationId: ORGANIZATION_ID,
        token: invitation.token,
      });
      expect(accepted).toMatchObject({
        membershipActivated: false,
        membershipId: STAFF_MEMBERSHIP_ID,
        outcome: "already_active",
        userCreated: false,
      });
      const membership = await pool.query("select role,status from memberships where id=$1", [
        STAFF_MEMBERSHIP_ID,
      ]);
      expect(membership.rows).toEqual([{ role: "staff", status: "active" }]);

      await pool.query("delete from membership_invitations");
      await pool.query(
        "update memberships set status='invited',invited_at=now(),activated_at=null,version=1 where id=$1",
        [STAFF_MEMBERSHIP_ID],
      );
      const invited = await lifecycle.issueInvitation(actor, {
        audit: AUDIT,
        locationScope: "all",
        role: "admin",
        target: "existing@example.com",
      });
      await expect(
        lifecycle.acceptInvitation({
          audit: AUDIT,
          identity: await identity("existing-subject"),
          organizationId: ORGANIZATION_ID,
          token: invited.token,
        }),
      ).resolves.toMatchObject({
        membershipActivated: true,
        membershipId: STAFF_MEMBERSHIP_ID,
        outcome: "activated",
        userCreated: false,
      });
      expect(
        (await pool.query("select role,status from memberships where id=$1", [STAFF_MEMBERSHIP_ID]))
          .rows,
      ).toEqual([{ role: "admin", status: "active" }]);
    });

    it.each(["suspended", "revoked"] as const)(
      "never reactivates a %s Membership through invitation acceptance",
      async (status) => {
        const pool = harness.privilegedPool();
        await seedOwner(pool);
        await insertUser(pool, STAFF_USER_ID, "blocked@example.com");
        await insertIdentity(pool, NEW_IDENTITY_ID, STAFF_USER_ID, "blocked-subject");
        await insertMembership(pool, STAFF_MEMBERSHIP_ID, STAFF_USER_ID, "staff", status);
        const lifecycle = lifecycleFor(harness.runtime(), "blocked@example.com");
        const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
        const invitation = await lifecycle.issueInvitation(actor, {
          audit: AUDIT,
          locationScope: "restricted",
          role: "staff",
          target: "blocked@example.com",
        });
        await expect(
          lifecycle.acceptInvitation({
            audit: AUDIT,
            identity: await identity("blocked-subject"),
            organizationId: ORGANIZATION_ID,
            token: invitation.token,
          }),
        ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
        expect(
          (await pool.query("select status from memberships where id=$1", [STAFF_MEMBERSHIP_ID]))
            .rows,
        ).toEqual([{ status }]);
      },
    );

    it("changes exact location scope and role atomically, reloads authority, and revokes every target session", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      await insertUser(pool, STAFF_USER_ID);
      await insertMembership(pool, STAFF_MEMBERSHIP_ID, STAFF_USER_ID, "staff");
      await pool.query(
        "insert into locations (id,organization_id,code,status) values ($1,$2,'a','active'),($3,$2,'b','active')",
        [LOCATION_A, ORGANIZATION_ID, LOCATION_B],
      );
      await insertOrganization(pool, FOREIGN_ORGANIZATION_ID, "s65-location-foreign");
      await pool.query(
        "insert into locations (id,organization_id,code,status) values ($1,$2,'foreign','active')",
        [FOREIGN_LOCATION, FOREIGN_ORGANIZATION_ID],
      );
      await insertApplicationSession(pool, STAFF_USER_ID, 1);
      const lifecycle = lifecycleFor(harness.runtime());
      const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      await expect(
        lifecycle.changeMembershipLocationScope(actor, {
          audit: AUDIT,
          expectedVersion: 1,
          locationIds: [FOREIGN_LOCATION],
          locationScope: "restricted",
          targetMembershipId: STAFF_MEMBERSHIP_ID,
        }),
      ).rejects.toMatchObject({ code: "resource_not_found" });
      const scoped = await lifecycle.changeMembershipLocationScope(actor, {
        audit: AUDIT,
        expectedVersion: 1,
        locationIds: [LOCATION_A],
        locationScope: "restricted",
        targetMembershipId: STAFF_MEMBERSHIP_ID,
      });
      expect(scoped).toEqual({ revokedSessionCount: 1, version: 2 });
      const refreshed = await contextFor(harness.authorizationRuntime(), STAFF_USER_ID);
      expect(refreshed.allowedLocationIds).toEqual([LOCATION_A]);
      expect(
        (await pool.query("select status from auth_sessions where user_id=$1", [STAFF_USER_ID]))
          .rows,
      ).toEqual([{ status: "revoked" }]);
      await insertApplicationSession(pool, STAFF_USER_ID, 2);
      const promoted = await lifecycle.changeMembershipRole(actor, {
        audit: AUDIT,
        expectedVersion: 2,
        role: "admin",
        targetMembershipId: STAFF_MEMBERSHIP_ID,
      });
      expect(promoted).toEqual({ revokedSessionCount: 1, version: 3 });
      expect((await contextFor(harness.authorizationRuntime(), STAFF_USER_ID)).locationScope).toBe(
        "all",
      );
      expect(
        (
          await pool.query(
            "select location_id from membership_location_scopes where membership_id=$1",
            [STAFF_MEMBERSHIP_ID],
          )
        ).rowCount,
      ).toBe(0);
    });

    it("suspends, revokes, and explicitly reactivates with audit and no restored session", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      await insertUser(pool, STAFF_USER_ID);
      await insertMembership(pool, STAFF_MEMBERSHIP_ID, STAFF_USER_ID, "staff");
      await insertApplicationSession(pool, STAFF_USER_ID, 3);
      const lifecycle = lifecycleFor(harness.runtime());
      const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      await expect(
        lifecycle.suspendMembership(actor, {
          audit: AUDIT,
          expectedVersion: 1,
          targetMembershipId: STAFF_MEMBERSHIP_ID,
        }),
      ).resolves.toEqual({ revokedSessionCount: 1, version: 2 });
      await expect(contextFor(harness.authorizationRuntime(), STAFF_USER_ID)).rejects.toMatchObject(
        { code: "permission_denied" },
      );
      await expect(
        lifecycle.reactivateMembership(actor, {
          audit: AUDIT,
          expectedVersion: 2,
          locationIds: [],
          locationScope: "restricted",
          role: "staff",
          targetMembershipId: STAFF_MEMBERSHIP_ID,
        }),
      ).resolves.toEqual({ revokedSessionCount: 0, version: 3 });
      expect(
        (
          await pool.query(
            "select count(*)::integer as count from auth_sessions where user_id=$1 and status='active'",
            [STAFF_USER_ID],
          )
        ).rows,
      ).toEqual([{ count: 0 }]);
      await expect(
        lifecycle.revokeMembership(actor, {
          audit: AUDIT,
          expectedVersion: 3,
          targetMembershipId: STAFF_MEMBERSHIP_ID,
        }),
      ).resolves.toEqual({ revokedSessionCount: 0, version: 4 });
      await expect(
        lifecycle.reactivateMembership(actor, {
          audit: AUDIT,
          expectedVersion: 4,
          locationIds: [],
          locationScope: "all",
          role: "admin",
          targetMembershipId: STAFF_MEMBERSHIP_ID,
        }),
      ).resolves.toEqual({ revokedSessionCount: 0, version: 5 });
      expect(
        (
          await pool.query("select status,role,revoked_at from memberships where id=$1", [
            STAFF_MEMBERSHIP_ID,
          ])
        ).rows,
      ).toEqual([{ revoked_at: null, role: "admin", status: "active" }]);
    });

    it("serializes final-owner mutations so concurrent demotions cannot leave zero active owners", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      const onlyOwnerActor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      const lifecycle = lifecycleFor(harness.runtime());
      await expect(
        lifecycle.changeMembershipRole(onlyOwnerActor, {
          audit: AUDIT,
          expectedVersion: 1,
          role: "admin",
          targetMembershipId: OWNER_MEMBERSHIP_ID,
        }),
      ).rejects.toBeInstanceOf(MembershipFinalOwnerError);
      await expect(
        lifecycle.suspendMembership(onlyOwnerActor, {
          audit: AUDIT,
          expectedVersion: 1,
          targetMembershipId: OWNER_MEMBERSHIP_ID,
        }),
      ).rejects.toBeInstanceOf(MembershipFinalOwnerError);
      await expect(
        lifecycle.revokeMembership(onlyOwnerActor, {
          audit: AUDIT,
          expectedVersion: 1,
          targetMembershipId: OWNER_MEMBERSHIP_ID,
        }),
      ).rejects.toBeInstanceOf(MembershipFinalOwnerError);

      await insertUser(pool, OTHER_OWNER_USER_ID);
      await insertMembership(pool, OTHER_OWNER_MEMBERSHIP_ID, OTHER_OWNER_USER_ID, "owner");
      const actorA = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      const actorB = await actorFor(harness.authorizationRuntime(), OTHER_OWNER_USER_ID);
      const outcomes = await Promise.allSettled([
        lifecycle.changeMembershipRole(actorA, {
          audit: AUDIT,
          expectedVersion: 1,
          role: "admin",
          targetMembershipId: OWNER_MEMBERSHIP_ID,
        }),
        lifecycle.changeMembershipRole(actorB, {
          audit: AUDIT,
          expectedVersion: 1,
          role: "admin",
          targetMembershipId: OTHER_OWNER_MEMBERSHIP_ID,
        }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      const ownerCount = await pool.query<{ count: number }>(
        "select count(*)::integer as count from memberships where organization_id=$1 and status='active' and role='owner'",
        [ORGANIZATION_ID],
      );
      expect(ownerCount.rows).toEqual([{ count: 1 }]);
    });

    it("rolls membership mutations back when required audit insertion fails", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      await insertUser(pool, STAFF_USER_ID);
      await insertMembership(pool, STAFF_MEMBERSHIP_ID, STAFF_USER_ID, "staff");
      await pool.query(
        `insert into audit_events
          (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,
           target_type,target_id,action,result,request_id,correlation_id,occurred_at)
         values ($1,$2,'membership.seeded','member',$3,$4,'membership',$5,
           'membership.seeded','succeeded',$6,$7,now())`,
        [
          ORGANIZATION_ID,
          raw.audit,
          OWNER_USER_ID,
          OWNER_MEMBERSHIP_ID,
          STAFF_MEMBERSHIP_ID,
          raw.request,
          raw.correlation,
        ],
      );
      const fixedIdentifiers: SecurityIdentifierFactory = {
        issueMembershipId: () => STAFF_MEMBERSHIP_ID,
        issueResourceId: () => AUDIT_ID,
        issueUserId: () => STAFF_USER_ID,
      };
      const lifecycle = lifecycleFor(harness.runtime(), "unused@example.com", fixedIdentifiers);
      const actor = await actorFor(harness.authorizationRuntime(), OWNER_USER_ID);
      await expect(
        lifecycle.changeMembershipRole(actor, {
          audit: AUDIT,
          expectedVersion: 1,
          role: "analyst",
          targetMembershipId: STAFF_MEMBERSHIP_ID,
        }),
      ).rejects.toMatchObject({ code: "membership_lifecycle_database_error" });
      expect(
        (
          await pool.query("select role,version::text from memberships where id=$1", [
            STAFF_MEMBERSHIP_ID,
          ])
        ).rows,
      ).toEqual([{ role: "staff", version: "1" }]);
    });

    it("rejects admin-to-owner mutations even with forged generic manage capability", async () => {
      const pool = harness.privilegedPool();
      await seedOwner(pool);
      await insertUser(pool, ADMIN_USER_ID);
      await insertMembership(pool, ADMIN_MEMBERSHIP_ID, ADMIN_USER_ID, "admin");
      const admin = await actorFor(harness.authorizationRuntime(), ADMIN_USER_ID);
      const lifecycle = lifecycleFor(harness.runtime());
      await expect(
        lifecycle.suspendMembership(admin, {
          audit: AUDIT,
          expectedVersion: 1,
          targetMembershipId: OWNER_MEMBERSHIP_ID,
        }),
      ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
      await expect(
        lifecycle.changeMembershipRole(admin, {
          audit: AUDIT,
          expectedVersion: 1,
          role: "owner",
          targetMembershipId: ADMIN_MEMBERSHIP_ID,
        }),
      ).rejects.toBeInstanceOf(MembershipLifecyclePermissionDeniedError);
    });
  });
};
