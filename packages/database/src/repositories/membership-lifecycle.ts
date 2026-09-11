import type { IdentityDatabaseRuntimeConfig } from "@lead-agent/config";
import {
  AggregateVersionSchema,
  MembershipIdSchema,
  UserIdSchema,
  isSchemaValue,
  type AggregateVersion,
  type MembershipId,
} from "@lead-agent/contracts";
import {
  InvitationTokenInvalidError,
  MembershipFinalOwnerError,
  MembershipLifecycleConflictError,
  MembershipLifecycleNotFoundError,
  MembershipLifecyclePermissionDeniedError,
  canInviteMembershipRole,
  canManageMembershipTarget,
  type AuthorizationContext,
  type InvitationAcceptancePersistence,
  type InvitationAcceptanceResult,
  type InvitationIssuePersistence,
  type InvitationReplacementPersistence,
  type InvitationRevocationPersistence,
  type MembershipLifecycleStore,
  type MembershipMutationPersistence,
  type MembershipMutationResult,
  type MembershipReactivationPersistence,
  type MembershipRole,
  type MembershipRoleChangePersistence,
  type MembershipScopeChangePersistence,
} from "@lead-agent/security";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import {
  executeTenantQuery,
  type TenantDatabaseRuntime,
  type TenantDbSession,
} from "../runtime/tenant.js";

const REQUIRED_AUTH_ROLE = "lead_agent_auth";
const FINAL_OWNER_LOCK_NAMESPACE = 66005;

export class MembershipLifecycleDatabaseError extends Error {
  readonly code = "membership_lifecycle_database_error" as const;

  constructor() {
    super("Membership lifecycle database operation failed");
    this.name = "MembershipLifecycleDatabaseError";
  }
}

export class MembershipLifecycleDatabaseRoleError extends Error {
  readonly code = "membership_lifecycle_database_role_required" as const;

  constructor() {
    super("Membership onboarding requires the configured authentication role");
    this.name = "MembershipLifecycleDatabaseRoleError";
  }
}

export class MembershipLifecycleDatabaseRuntimeClosedError extends Error {
  readonly code = "membership_lifecycle_database_runtime_closed" as const;

  constructor() {
    super("Membership lifecycle database runtime is closed");
    this.name = "MembershipLifecycleDatabaseRuntimeClosedError";
  }
}

const databaseCauses = new WeakMap<MembershipLifecycleDatabaseError, unknown>();
export const readMembershipLifecycleDatabaseCause = (
  error: MembershipLifecycleDatabaseError,
): unknown => databaseCauses.get(error);

export type MembershipLifecycleDatabaseObservability = Readonly<{
  onUnexpectedPoolError: (error: Error) => void;
}>;

export type MembershipLifecycleDatabaseRuntime = MembershipLifecycleStore &
  Readonly<{ close: () => Promise<void> }>;

type MembershipRow = QueryResultRow & {
  location_scope: string;
  role: MembershipRole;
  status: string;
  user_id: string;
  version: string;
};

type InvitationRow = QueryResultRow & {
  expires_at: Date;
  location_scope: string;
  role: MembershipRole;
  status: string;
  target_ciphertext: Buffer;
  target_lookup_hash: Buffer;
};

type AcceptanceRow = QueryResultRow & {
  external_identity_created: boolean;
  membership_activated: boolean;
  membership_id: string;
  outcome: string;
  user_created: boolean;
  user_id: string;
};

const isExpectedError = (error: unknown): error is Error =>
  error instanceof InvitationTokenInvalidError ||
  error instanceof MembershipFinalOwnerError ||
  error instanceof MembershipLifecycleConflictError ||
  error instanceof MembershipLifecycleNotFoundError ||
  error instanceof MembershipLifecyclePermissionDeniedError ||
  error instanceof MembershipLifecycleDatabaseError ||
  error instanceof MembershipLifecycleDatabaseRoleError ||
  error instanceof MembershipLifecycleDatabaseRuntimeClosedError;

const mapUnexpected = (error: unknown): never => {
  if (isExpectedError(error)) throw error;
  const mapped = new MembershipLifecycleDatabaseError();
  databaseCauses.set(mapped, error);
  throw mapped;
};

const query = <Row extends QueryResultRow>(
  session: TenantDbSession,
  text: string,
  values: readonly unknown[] = [],
) =>
  executeTenantQuery<Row>(session, (organizationId) => ({
    text,
    values: [organizationId, ...values],
  }));

const parseVersion = (value: unknown): AggregateVersion => {
  const parsed = Number(value);
  if (!isSchemaValue(AggregateVersionSchema, parsed)) throw new MembershipLifecycleDatabaseError();
  return parsed;
};

const requireActor = async (
  session: TenantDbSession,
  actor: AuthorizationContext,
): Promise<MembershipRow> => {
  const result = await query<MembershipRow>(
    session,
    `select user_id::text, role, status, location_scope, version::text
       from memberships
      where organization_id = $1 and id = $2::uuid and user_id = $3::uuid
      for update`,
    [actor.membershipId, actor.userId],
  );
  const current = result.rows[0];
  if (
    current === undefined ||
    current.status !== "active" ||
    current.role !== actor.role ||
    current.location_scope !== actor.locationScope ||
    current.user_id !== actor.userId
  ) {
    throw new MembershipLifecyclePermissionDeniedError();
  }
  return current;
};

const lockOrganizationMembershipLifecycle = async (session: TenantDbSession): Promise<void> => {
  await query(
    session,
    "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, $2::bigint))",
    [FINAL_OWNER_LOCK_NAMESPACE],
  );
};

const requireTarget = async (
  session: TenantDbSession,
  membershipId: MembershipId,
): Promise<MembershipRow> => {
  const result = await query<MembershipRow>(
    session,
    `select user_id::text, role, status, location_scope, version::text
       from memberships
      where organization_id = $1 and id = $2::uuid
      for update`,
    [membershipId],
  );
  const target = result.rows[0];
  if (target === undefined) throw new MembershipLifecycleNotFoundError();
  return target;
};

const requireManagedTarget = async (
  session: TenantDbSession,
  actor: AuthorizationContext,
  targetMembershipId: MembershipId,
  proposedRole?: MembershipRole,
): Promise<MembershipRow> => {
  await lockOrganizationMembershipLifecycle(session);
  await requireActor(session, actor);
  const target = await requireTarget(session, targetMembershipId);
  if (!canManageMembershipTarget(actor.role, target.role, proposedRole ?? target.role)) {
    throw new MembershipLifecyclePermissionDeniedError();
  }
  return target;
};

const requireExpectedVersion = (target: MembershipRow, expected: AggregateVersion): void => {
  if (parseVersion(target.version) !== expected) throw new MembershipLifecycleConflictError();
};

const assertNotFinalOwner = async (
  session: TenantDbSession,
  target: MembershipRow,
): Promise<void> => {
  if (target.role !== "owner" || target.status !== "active") return;
  const result = await query<{ owner_count: string }>(
    session,
    `select pg_catalog.count(*)::text as owner_count
       from memberships
      where organization_id = $1 and status = 'active' and role = 'owner'`,
  );
  if (Number(result.rows[0]?.owner_count ?? "0") <= 1) throw new MembershipFinalOwnerError();
};

const insertAudit = async (
  session: TenantDbSession,
  input: {
    actor: AuthorizationContext;
    auditId: string;
    correlationId: string;
    eventType: string;
    occurredAt: Date;
    requestId: string;
    targetId: string;
    targetType: "membership" | "membership_invitation";
    traceId?: string;
  },
): Promise<void> => {
  await query(
    session,
    `insert into audit_events
      (organization_id,id,event_type,actor_type,actor_id,actor_membership_id,
       impersonation_session_id,support_grant_id,target_type,target_id,action,
       result,reason_code,request_id,trace_id,correlation_id,source_ip_prefix,
       user_agent_hash,metadata_redacted_jsonb,occurred_at)
     values ($1,$2::uuid,$3,'member',$4::uuid,$5::uuid,null,null,$6,$7::uuid,$3,
       'succeeded',null,$8,$9,$10::uuid,null,null,'{}'::jsonb,$11::timestamptz)`,
    [
      input.auditId,
      input.eventType,
      input.actor.userId,
      input.actor.membershipId,
      input.targetType,
      input.targetId,
      input.requestId,
      input.traceId ?? null,
      input.correlationId,
      input.occurredAt,
    ],
  );
};

const revokeSessions = async (
  session: TenantDbSession,
  targetMembershipId: MembershipId,
  reason: "membership_changed" | "privilege_changed",
): Promise<number> => {
  const result = await query<{ revoked_count: number }>(
    session,
    `select app.revoke_membership_user_sessions($2::uuid, $3::varchar) as revoked_count
       where $1::uuid = app.current_organization_id()`,
    [targetMembershipId, reason],
  );
  const count = result.rows[0]?.revoked_count;
  if (!Number.isInteger(count) || count === undefined || count < 0) {
    throw new MembershipLifecycleDatabaseError();
  }
  return count;
};

const updateLocationScopeRows = async (
  session: TenantDbSession,
  target: MembershipId,
  locationIds: readonly string[],
  actor: AuthorizationContext,
): Promise<void> => {
  await query(
    session,
    "delete from membership_location_scopes where organization_id = $1 and membership_id = $2::uuid",
    [target],
  );
  for (const locationId of locationIds) {
    await query(
      session,
      `insert into membership_location_scopes
        (organization_id,membership_id,location_id,created_at,created_by_user_id)
       values ($1,$2::uuid,$3::uuid,pg_catalog.statement_timestamp(),$4::uuid)`,
      [target, locationId, actor.userId],
    );
  }
};

const requireLocationsBelongToTenant = async (
  session: TenantDbSession,
  locationIds: readonly string[],
): Promise<void> => {
  if (locationIds.length === 0) return;
  const result = await query<{ location_count: string }>(
    session,
    `select pg_catalog.count(*)::text as location_count
       from locations
      where organization_id = $1 and id = any($2::uuid[])`,
    [locationIds],
  );
  if (BigInt(result.rows[0]?.location_count ?? "0") !== BigInt(locationIds.length)) {
    throw new MembershipLifecycleNotFoundError();
  }
};

class MembershipLifecycleDatabaseRuntimeImplementation implements MembershipLifecycleDatabaseRuntime {
  readonly #authenticationPool: Pool;
  readonly #tenantRuntime: TenantDatabaseRuntime;
  #closed = false;

  constructor(
    authenticationConfiguration: IdentityDatabaseRuntimeConfig,
    tenantRuntime: TenantDatabaseRuntime,
    observability: MembershipLifecycleDatabaseObservability,
  ) {
    this.#tenantRuntime = tenantRuntime;
    this.#authenticationPool = new Pool({
      connectionString: authenticationConfiguration.connectionString,
      connectionTimeoutMillis: authenticationConfiguration.connectionTimeoutMilliseconds,
      idleTimeoutMillis: authenticationConfiguration.idleTimeoutMilliseconds,
      max: authenticationConfiguration.maxConnections,
      statement_timeout: authenticationConfiguration.statementTimeoutMilliseconds,
    });
    this.#authenticationPool.on("error", observability.onUnexpectedPoolError);
    Object.freeze(this);
  }

  async #withAuthenticationClient<Result>(
    operation: (client: PoolClient) => Promise<Result>,
  ): Promise<Result> {
    if (this.#closed) throw new MembershipLifecycleDatabaseRuntimeClosedError();
    const client = await this.#authenticationPool.connect().catch(mapUnexpected);
    try {
      const role = await client.query<{ database_role: string }>(
        "select current_user as database_role",
      );
      if (role.rows[0]?.database_role !== REQUIRED_AUTH_ROLE) {
        throw new MembershipLifecycleDatabaseRoleError();
      }
      return await operation(client);
    } catch (error) {
      return mapUnexpected(error);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#authenticationPool.end();
  }

  async acceptInvitation(
    input: InvitationAcceptancePersistence,
  ): Promise<InvitationAcceptanceResult> {
    return this.#withAuthenticationClient(async (client) => {
      const result = await client.query<AcceptanceRow>(
        `select * from app.accept_membership_invitation(
          $1::uuid,$2::bytea,$3::bytea,$4::varchar,$5::varchar,
          $6::uuid,$7::uuid,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::uuid,
          $13::varchar,$14::uuid,$15::varchar
        )`,
        [
          input.organizationId,
          Buffer.from(input.tokenHash),
          Buffer.from(input.targetLookupHash),
          input.identity.issuer,
          input.identity.subject,
          input.userId,
          input.externalIdentityId,
          input.membershipId,
          input.auditIds.invitation,
          input.auditIds.user,
          input.auditIds.externalIdentity,
          input.auditIds.membership,
          input.requestId,
          input.correlationId,
          input.traceId ?? null,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw new InvitationTokenInvalidError();
      if (
        (row.outcome !== "activated" && row.outcome !== "already_active") ||
        !isSchemaValue(UserIdSchema, row.user_id) ||
        !isSchemaValue(MembershipIdSchema, row.membership_id) ||
        typeof row.user_created !== "boolean" ||
        typeof row.external_identity_created !== "boolean" ||
        typeof row.membership_activated !== "boolean"
      ) {
        throw new MembershipLifecycleDatabaseError();
      }
      return Object.freeze({
        externalIdentityCreated: row.external_identity_created,
        membershipActivated: row.membership_activated,
        membershipId: row.membership_id,
        outcome: row.outcome,
        userCreated: row.user_created,
        userId: row.user_id,
      });
    });
  }

  async issueInvitation(input: InvitationIssuePersistence): Promise<void> {
    return this.#tenantRuntime.withTenantTransaction(
      input.actor.organizationId,
      async (session) => {
        try {
          await requireActor(session, input.actor);
          if (!canInviteMembershipRole(input.actor.role, input.role)) {
            throw new MembershipLifecyclePermissionDeniedError();
          }
          await query(
            session,
            "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text || pg_catalog.chr(31) || pg_catalog.encode($2::bytea,'hex'), 66006)) where $1::uuid = app.current_organization_id()",
            [Buffer.from(input.targetLookupHash)],
          );
          await query(
            session,
            `update membership_invitations
              set status='expired', expired_at=$3::timestamptz, updated_at=$3::timestamptz, version=version+1
            where organization_id=$1 and target_lookup_hash=$2::bytea and status='active'
              and expires_at <= $3::timestamptz`,
            [Buffer.from(input.targetLookupHash), input.occurredAt],
          );
          const existing = await query(
            session,
            `select id from membership_invitations
            where organization_id=$1 and target_lookup_hash=$2::bytea and status='active'`,
            [Buffer.from(input.targetLookupHash)],
          );
          if (existing.rowCount !== 0) throw new MembershipLifecycleConflictError();
          await query(
            session,
            `insert into membership_invitations
            (organization_id,id,target_ciphertext,target_lookup_hash,role,location_scope,
             token_hash,status,invited_by_membership_id,expires_at,created_at,updated_at,version)
           values ($1,$2::uuid,$3::bytea,$4::bytea,$5,$6,$7::bytea,'active',$8::uuid,
             $9::timestamptz,$10::timestamptz,$10::timestamptz,1)`,
            [
              input.invitationId,
              Buffer.from(input.targetCiphertext),
              Buffer.from(input.targetLookupHash),
              input.role,
              input.locationScope,
              Buffer.from(input.tokenHash),
              input.actor.membershipId,
              input.expiresAt,
              input.occurredAt,
            ],
          );
          await insertAudit(session, {
            ...input,
            eventType: "invitation.issued",
            targetId: input.invitationId,
            targetType: "membership_invitation",
          });
        } catch (error) {
          mapUnexpected(error);
        }
      },
    );
  }

  async resendInvitation(input: InvitationReplacementPersistence): Promise<Uint8Array> {
    return this.#tenantRuntime.withTenantTransaction(
      input.actor.organizationId,
      async (session) => {
        try {
          await requireActor(session, input.actor);
          const selected = await query<InvitationRow>(
            session,
            `select target_ciphertext,target_lookup_hash,role,location_scope,status,expires_at
             from membership_invitations
            where organization_id=$1 and id=$2::uuid
            for update`,
            [input.currentInvitationId],
          );
          const current = selected.rows[0];
          if (current === undefined) throw new MembershipLifecycleNotFoundError();
          if (!canInviteMembershipRole(input.actor.role, current.role)) {
            throw new MembershipLifecyclePermissionDeniedError();
          }
          if (current.status !== "active" || current.expires_at <= input.occurredAt) {
            throw new InvitationTokenInvalidError();
          }
          await query(
            session,
            "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text || pg_catalog.chr(31) || pg_catalog.encode($2::bytea,'hex'), 66006)) where $1::uuid = app.current_organization_id()",
            [current.target_lookup_hash],
          );
          await query(
            session,
            `update membership_invitations
              set status='revoked',revoked_at=$3::timestamptz,
                  revoked_by_membership_id=$4::uuid,revocation_reason='replaced',
                  updated_at=$3::timestamptz,version=version+1
            where organization_id=$1 and id=$2::uuid and status='active'`,
            [input.currentInvitationId, input.occurredAt, input.actor.membershipId],
          );
          await query(
            session,
            `insert into membership_invitations
            (organization_id,id,target_ciphertext,target_lookup_hash,role,location_scope,
             token_hash,status,invited_by_membership_id,expires_at,created_at,updated_at,version)
           values ($1,$2::uuid,$3::bytea,$4::bytea,$5,$6,$7::bytea,'active',$8::uuid,
             $9::timestamptz,$10::timestamptz,$10::timestamptz,1)`,
            [
              input.replacementInvitationId,
              current.target_ciphertext,
              current.target_lookup_hash,
              current.role,
              current.location_scope,
              Buffer.from(input.replacementTokenHash),
              input.actor.membershipId,
              input.expiresAt,
              input.occurredAt,
            ],
          );
          await insertAudit(session, {
            ...input,
            eventType: "invitation.resent",
            targetId: input.replacementInvitationId,
            targetType: "membership_invitation",
          });
          return new Uint8Array(current.target_ciphertext);
        } catch (error) {
          return mapUnexpected(error);
        }
      },
    );
  }

  async revokeInvitation(input: InvitationRevocationPersistence): Promise<void> {
    return this.#tenantRuntime.withTenantTransaction(
      input.actor.organizationId,
      async (session) => {
        try {
          await requireActor(session, input.actor);
          const selected = await query<InvitationRow>(
            session,
            `select target_ciphertext,target_lookup_hash,role,location_scope,status,expires_at
             from membership_invitations
            where organization_id=$1 and id=$2::uuid
            for update`,
            [input.invitationId],
          );
          const current = selected.rows[0];
          if (current === undefined) throw new MembershipLifecycleNotFoundError();
          if (!canInviteMembershipRole(input.actor.role, current.role)) {
            throw new MembershipLifecyclePermissionDeniedError();
          }
          if (current.status === "revoked") return;
          if (current.status !== "active") throw new InvitationTokenInvalidError();
          await query(
            session,
            `update membership_invitations
              set status='revoked',revoked_at=$3::timestamptz,
                  revoked_by_membership_id=$4::uuid,revocation_reason=$5,
                  updated_at=$3::timestamptz,version=version+1
            where organization_id=$1 and id=$2::uuid and status='active'`,
            [input.invitationId, input.occurredAt, input.actor.membershipId, input.reason],
          );
          await insertAudit(session, {
            ...input,
            eventType: "invitation.revoked",
            targetId: input.invitationId,
            targetType: "membership_invitation",
          });
        } catch (error) {
          mapUnexpected(error);
        }
      },
    );
  }

  async changeMembershipRole(
    input: MembershipRoleChangePersistence,
  ): Promise<MembershipMutationResult> {
    return this.#tenantRuntime.withTenantTransaction(
      input.actor.organizationId,
      async (session) => {
        try {
          const target = await requireManagedTarget(
            session,
            input.actor,
            input.targetMembershipId,
            input.role,
          );
          requireExpectedVersion(target, input.expectedVersion);
          if (target.status !== "active") throw new MembershipLifecycleConflictError();
          if (target.role === "owner" && input.role !== "owner")
            await assertNotFinalOwner(session, target);
          const locationScope =
            input.role === "owner" || input.role === "admin" ? "all" : target.location_scope;
          const updated = await query<{ version: string }>(
            session,
            `update memberships set role=$3,location_scope=$4,updated_at=$5::timestamptz,version=version+1
            where organization_id=$1 and id=$2::uuid and version=$6::bigint
            returning version::text`,
            [
              input.targetMembershipId,
              input.role,
              locationScope,
              input.occurredAt,
              input.expectedVersion,
            ],
          );
          if (updated.rowCount !== 1) throw new MembershipLifecycleConflictError();
          if (locationScope === "all")
            await updateLocationScopeRows(session, input.targetMembershipId, [], input.actor);
          const revokedSessionCount = await revokeSessions(
            session,
            input.targetMembershipId,
            "privilege_changed",
          );
          await insertAudit(session, {
            ...input,
            eventType: "membership.role_changed",
            targetId: input.targetMembershipId,
            targetType: "membership",
          });
          return Object.freeze({
            revokedSessionCount,
            version: parseVersion(updated.rows[0]?.version),
          });
        } catch (error) {
          return mapUnexpected(error);
        }
      },
    );
  }

  async changeMembershipLocationScope(
    input: MembershipScopeChangePersistence,
  ): Promise<MembershipMutationResult> {
    return this.#tenantRuntime.withTenantTransaction(
      input.actor.organizationId,
      async (session) => {
        try {
          const target = await requireManagedTarget(session, input.actor, input.targetMembershipId);
          requireExpectedVersion(target, input.expectedVersion);
          if (target.status !== "active" || target.role === "owner" || target.role === "admin") {
            throw new MembershipLifecyclePermissionDeniedError();
          }
          await requireLocationsBelongToTenant(session, input.locationIds);
          const updated = await query<{ version: string }>(
            session,
            `update memberships set location_scope=$3,updated_at=$4::timestamptz,version=version+1
            where organization_id=$1 and id=$2::uuid and version=$5::bigint
            returning version::text`,
            [
              input.targetMembershipId,
              input.locationScope,
              input.occurredAt,
              input.expectedVersion,
            ],
          );
          if (updated.rowCount !== 1) throw new MembershipLifecycleConflictError();
          await updateLocationScopeRows(
            session,
            input.targetMembershipId,
            input.locationIds,
            input.actor,
          );
          const revokedSessionCount = await revokeSessions(
            session,
            input.targetMembershipId,
            "privilege_changed",
          );
          await insertAudit(session, {
            ...input,
            eventType: "membership.scope_changed",
            targetId: input.targetMembershipId,
            targetType: "membership",
          });
          return Object.freeze({
            revokedSessionCount,
            version: parseVersion(updated.rows[0]?.version),
          });
        } catch (error) {
          return mapUnexpected(error);
        }
      },
    );
  }

  suspendMembership(input: MembershipMutationPersistence): Promise<MembershipMutationResult> {
    return this.#setMembershipStatus(input, "suspended", "membership.suspended");
  }

  revokeMembership(input: MembershipMutationPersistence): Promise<MembershipMutationResult> {
    return this.#setMembershipStatus(input, "revoked", "membership.revoked");
  }

  async #setMembershipStatus(
    input: MembershipMutationPersistence,
    status: "revoked" | "suspended",
    eventType: string,
  ): Promise<MembershipMutationResult> {
    return this.#tenantRuntime.withTenantTransaction(
      input.actor.organizationId,
      async (session) => {
        try {
          const target = await requireManagedTarget(session, input.actor, input.targetMembershipId);
          requireExpectedVersion(target, input.expectedVersion);
          if (target.status !== "active") throw new MembershipLifecycleConflictError();
          await assertNotFinalOwner(session, target);
          const updated = await query<{ version: string }>(
            session,
            `update memberships
              set status=$3::varchar(16),
                  revoked_at=case when $3::varchar(16)='revoked' then $4::timestamptz else revoked_at end,
                  updated_at=$4::timestamptz,version=version+1
            where organization_id=$1 and id=$2::uuid and version=$5::bigint
            returning version::text`,
            [input.targetMembershipId, status, input.occurredAt, input.expectedVersion],
          );
          if (updated.rowCount !== 1) throw new MembershipLifecycleConflictError();
          const revokedSessionCount = await revokeSessions(
            session,
            input.targetMembershipId,
            "membership_changed",
          );
          await insertAudit(session, {
            ...input,
            eventType,
            targetId: input.targetMembershipId,
            targetType: "membership",
          });
          return Object.freeze({
            revokedSessionCount,
            version: parseVersion(updated.rows[0]?.version),
          });
        } catch (error) {
          return mapUnexpected(error);
        }
      },
    );
  }

  async reactivateMembership(
    input: MembershipReactivationPersistence,
  ): Promise<MembershipMutationResult> {
    return this.#tenantRuntime.withTenantTransaction(
      input.actor.organizationId,
      async (session) => {
        try {
          const target = await requireManagedTarget(
            session,
            input.actor,
            input.targetMembershipId,
            input.role,
          );
          requireExpectedVersion(target, input.expectedVersion);
          if (target.status !== "suspended" && target.status !== "revoked") {
            throw new MembershipLifecycleConflictError();
          }
          await requireLocationsBelongToTenant(session, input.locationIds);
          const updated = await query<{ version: string }>(
            session,
            `update memberships
              set status='active',role=$3,location_scope=$4,activated_at=$5::timestamptz,
                  revoked_at=null,updated_at=$5::timestamptz,version=version+1
            where organization_id=$1 and id=$2::uuid and version=$6::bigint
            returning version::text`,
            [
              input.targetMembershipId,
              input.role,
              input.locationScope,
              input.occurredAt,
              input.expectedVersion,
            ],
          );
          if (updated.rowCount !== 1) throw new MembershipLifecycleConflictError();
          await updateLocationScopeRows(
            session,
            input.targetMembershipId,
            input.locationIds,
            input.actor,
          );
          await insertAudit(session, {
            ...input,
            eventType: "membership.reactivated",
            targetId: input.targetMembershipId,
            targetType: "membership",
          });
          return Object.freeze({
            revokedSessionCount: 0,
            version: parseVersion(updated.rows[0]?.version),
          });
        } catch (error) {
          return mapUnexpected(error);
        }
      },
    );
  }
}

export const createMembershipLifecycleDatabaseRuntime = (
  authenticationConfiguration: IdentityDatabaseRuntimeConfig,
  tenantRuntime: TenantDatabaseRuntime,
  observability: MembershipLifecycleDatabaseObservability,
): MembershipLifecycleDatabaseRuntime =>
  new MembershipLifecycleDatabaseRuntimeImplementation(
    authenticationConfiguration,
    tenantRuntime,
    observability,
  );
