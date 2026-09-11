import {
  AggregateVersionSchema,
  CorrelationIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  ResourceIdSchema,
  isSchemaValue,
  type AggregateVersion,
  type CorrelationId,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type RequestId,
  type ResourceId,
  type UserId,
} from "@lead-agent/contracts";

import type { ValidatedOidcIdentity } from "../identity/contracts.js";
import type { AuthenticatedApplicationSession } from "../session/lifecycle.js";
import { isFreshStepUp } from "../session/policy.js";
import {
  canInviteMembershipRole,
  isAuthorizationContext,
  isLocationScope,
  isMembershipRole,
  type AuthorizationContext,
  type LocationScope,
  type MembershipRole,
} from "../authorization/index.js";
import {
  createInvitationCredentialFactory,
  createSecurityIdentifierFactory,
  hashInvitationToken,
  type InvitationCredentialFactory,
  type SecurityIdentifierFactory,
} from "./credentials.js";
import { InvitationTokenInvalidError, MembershipLifecyclePermissionDeniedError } from "./errors.js";
import { canonicalizeInvitationEmailTarget, type InvitationTargetProtector } from "./target.js";

export const INVITATION_LIFETIME_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export type MembershipLifecycleAuditContext = Readonly<{
  correlationId: CorrelationId;
  requestId: RequestId;
  traceId?: RequestId;
}>;

export type MembershipLifecycleActor = Readonly<{
  authorization: AuthorizationContext;
  session: AuthenticatedApplicationSession;
}>;

type AuditedOperation = MembershipLifecycleAuditContext &
  Readonly<{ auditId: ResourceId; occurredAt: Date }>;

export type InvitationIssuePersistence = AuditedOperation &
  Readonly<{
    actor: AuthorizationContext;
    expiresAt: Date;
    invitationId: ResourceId;
    locationScope: LocationScope;
    role: MembershipRole;
    targetCiphertext: Uint8Array;
    targetLookupHash: Uint8Array;
    tokenHash: Uint8Array;
  }>;

export type InvitationReplacementPersistence = AuditedOperation &
  Readonly<{
    actor: AuthorizationContext;
    currentInvitationId: ResourceId;
    expiresAt: Date;
    replacementInvitationId: ResourceId;
    replacementTokenHash: Uint8Array;
  }>;

export type InvitationRevocationPersistence = AuditedOperation &
  Readonly<{
    actor: AuthorizationContext;
    invitationId: ResourceId;
    reason: string;
  }>;

export type InvitationAcceptancePersistence = MembershipLifecycleAuditContext &
  Readonly<{
    auditIds: Readonly<{
      externalIdentity: ResourceId;
      invitation: ResourceId;
      membership: ResourceId;
      user: ResourceId;
    }>;
    correlationId: CorrelationId;
    externalIdentityId: ResourceId;
    identity: ValidatedOidcIdentity;
    membershipId: MembershipId;
    organizationId: OrganizationId;
    targetLookupHash: Uint8Array;
    tokenHash: Uint8Array;
    userId: UserId;
  }>;

export type InvitationAcceptanceResult = Readonly<{
  externalIdentityCreated: boolean;
  membershipActivated: boolean;
  membershipId: MembershipId;
  outcome: "activated" | "already_active";
  userCreated: boolean;
  userId: UserId;
}>;

export type MembershipMutationPersistence = AuditedOperation &
  Readonly<{
    actor: AuthorizationContext;
    expectedVersion: AggregateVersion;
    targetMembershipId: MembershipId;
  }>;

export type MembershipRoleChangePersistence = MembershipMutationPersistence &
  Readonly<{ role: MembershipRole }>;

export type MembershipScopeChangePersistence = MembershipMutationPersistence &
  Readonly<{ locationIds: readonly LocationId[]; locationScope: LocationScope }>;

export type MembershipReactivationPersistence = MembershipScopeChangePersistence &
  Readonly<{ role: MembershipRole }>;

export type MembershipMutationResult = Readonly<{
  revokedSessionCount: number;
  version: AggregateVersion;
}>;

export interface MembershipLifecycleStore {
  acceptInvitation(input: InvitationAcceptancePersistence): Promise<InvitationAcceptanceResult>;
  changeMembershipLocationScope(
    input: MembershipScopeChangePersistence,
  ): Promise<MembershipMutationResult>;
  changeMembershipRole(input: MembershipRoleChangePersistence): Promise<MembershipMutationResult>;
  issueInvitation(input: InvitationIssuePersistence): Promise<void>;
  reactivateMembership(input: MembershipReactivationPersistence): Promise<MembershipMutationResult>;
  resendInvitation(input: InvitationReplacementPersistence): Promise<Uint8Array>;
  revokeInvitation(input: InvitationRevocationPersistence): Promise<void>;
  revokeMembership(input: MembershipMutationPersistence): Promise<MembershipMutationResult>;
  suspendMembership(input: MembershipMutationPersistence): Promise<MembershipMutationResult>;
}

export interface VerifiedInvitationTargetResolver {
  resolveVerifiedEmailTarget(identity: ValidatedOidcIdentity): Promise<string | null>;
}

export type IssuedMembershipInvitation = Readonly<{
  deliveryTarget: string;
  expiresAt: Date;
  invitationId: ResourceId;
  token: string;
}>;

export interface MembershipLifecycle {
  acceptInvitation(
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      identity: ValidatedOidcIdentity;
      organizationId: OrganizationId;
      token: string;
    }>,
  ): Promise<InvitationAcceptanceResult>;
  changeMembershipLocationScope(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      expectedVersion: AggregateVersion;
      locationIds: readonly LocationId[];
      locationScope: LocationScope;
      targetMembershipId: MembershipId;
    }>,
  ): Promise<MembershipMutationResult>;
  changeMembershipRole(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      expectedVersion: AggregateVersion;
      role: MembershipRole;
      targetMembershipId: MembershipId;
    }>,
  ): Promise<MembershipMutationResult>;
  issueInvitation(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      locationScope: LocationScope;
      role: MembershipRole;
      target: string;
    }>,
  ): Promise<IssuedMembershipInvitation>;
  reactivateMembership(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      expectedVersion: AggregateVersion;
      locationIds: readonly LocationId[];
      locationScope: LocationScope;
      role: MembershipRole;
      targetMembershipId: MembershipId;
    }>,
  ): Promise<MembershipMutationResult>;
  resendInvitation(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      invitationId: ResourceId;
    }>,
  ): Promise<IssuedMembershipInvitation>;
  revokeInvitation(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      invitationId: ResourceId;
      reason: string;
    }>,
  ): Promise<void>;
  revokeMembership(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      expectedVersion: AggregateVersion;
      targetMembershipId: MembershipId;
    }>,
  ): Promise<MembershipMutationResult>;
  suspendMembership(
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      expectedVersion: AggregateVersion;
      targetMembershipId: MembershipId;
    }>,
  ): Promise<MembershipMutationResult>;
}

const requireAudit = (audit: MembershipLifecycleAuditContext): MembershipLifecycleAuditContext => {
  if (
    !isSchemaValue(CorrelationIdSchema, audit.correlationId) ||
    !isSchemaValue(RequestIdSchema, audit.requestId) ||
    (audit.traceId !== undefined && !isSchemaValue(RequestIdSchema, audit.traceId))
  ) {
    throw new TypeError("Membership lifecycle audit context is invalid");
  }
  return audit;
};

const requireActor = (actor: MembershipLifecycleActor, now: Date): AuthorizationContext => {
  if (
    !isAuthorizationContext(actor.authorization) ||
    actor.session.userId !== actor.authorization.userId ||
    !isFreshStepUp(actor.session, now)
  ) {
    throw new MembershipLifecyclePermissionDeniedError();
  }
  return actor.authorization;
};

const requireResourceId = (value: unknown): ResourceId => {
  if (!isSchemaValue(ResourceIdSchema, value))
    throw new TypeError("Resource identifier is invalid");
  return value;
};

const requireMembershipId = (value: unknown): MembershipId => {
  if (!isSchemaValue(MembershipIdSchema, value))
    throw new TypeError("Membership identifier is invalid");
  return value;
};

const requireVersion = (value: unknown): AggregateVersion => {
  if (!isSchemaValue(AggregateVersionSchema, value))
    throw new TypeError("Aggregate version is invalid");
  return value;
};

const requireOrganization = (value: unknown): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, value)) throw new InvitationTokenInvalidError();
  return value;
};

const requireScope = (
  role: MembershipRole,
  locationScope: unknown,
  locationIds: readonly LocationId[] = [],
): Readonly<{ locationIds: readonly LocationId[]; locationScope: LocationScope }> => {
  if (
    !isLocationScope(locationScope) ||
    ((role === "owner" || role === "admin") && locationScope !== "all")
  ) {
    throw new MembershipLifecyclePermissionDeniedError();
  }
  if (
    !Array.isArray(locationIds) ||
    !locationIds.every((id) => isSchemaValue(LocationIdSchema, id)) ||
    new Set(locationIds).size !== locationIds.length ||
    (locationScope === "all" && locationIds.length !== 0)
  ) {
    throw new TypeError("Membership location scope is invalid");
  }
  return Object.freeze({ locationIds: Object.freeze([...locationIds]), locationScope });
};

const audited = (
  audit: MembershipLifecycleAuditContext,
  now: Date,
  identifiers: SecurityIdentifierFactory,
): AuditedOperation => ({
  ...requireAudit(audit),
  auditId: identifiers.issueResourceId(now),
  occurredAt: now,
});

export const createMembershipLifecycle = (
  store: MembershipLifecycleStore,
  targetProtector: InvitationTargetProtector,
  verifiedTargetResolver: VerifiedInvitationTargetResolver,
  options: Readonly<{
    clock?: () => Date;
    credentialFactory?: InvitationCredentialFactory;
    identifierFactory?: SecurityIdentifierFactory;
  }> = {},
): MembershipLifecycle => {
  const clock = options.clock ?? (() => new Date());
  const credentials = options.credentialFactory ?? createInvitationCredentialFactory();
  const identifiers = options.identifierFactory ?? createSecurityIdentifierFactory();

  const mutationBase = (
    actor: MembershipLifecycleActor,
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      expectedVersion: AggregateVersion;
      targetMembershipId: MembershipId;
    }>,
  ): MembershipMutationPersistence => {
    const now = clock();
    return {
      ...audited(input.audit, now, identifiers),
      actor: requireActor(actor, now),
      expectedVersion: requireVersion(input.expectedVersion),
      targetMembershipId: requireMembershipId(input.targetMembershipId),
    };
  };

  const lifecycle: MembershipLifecycle = {
    acceptInvitation: async (input): Promise<InvitationAcceptanceResult> => {
      requireAudit(input.audit);
      const tokenHash = hashInvitationToken(input.token);
      if (tokenHash === undefined) throw new InvitationTokenInvalidError();
      const verifiedTarget = await verifiedTargetResolver.resolveVerifiedEmailTarget(
        input.identity,
      );
      if (verifiedTarget === null) throw new InvitationTokenInvalidError();
      let canonicalTarget: string;
      try {
        canonicalTarget = canonicalizeInvitationEmailTarget(verifiedTarget);
      } catch {
        throw new InvitationTokenInvalidError();
      }
      const now = clock();
      return store.acceptInvitation({
        ...input.audit,
        auditIds: {
          externalIdentity: identifiers.issueResourceId(now),
          invitation: identifiers.issueResourceId(now),
          membership: identifiers.issueResourceId(now),
          user: identifiers.issueResourceId(now),
        },
        externalIdentityId: identifiers.issueResourceId(now),
        identity: input.identity,
        membershipId: identifiers.issueMembershipId(now),
        organizationId: requireOrganization(input.organizationId),
        targetLookupHash: targetProtector.lookupHash(canonicalTarget),
        tokenHash,
        userId: identifiers.issueUserId(now),
      });
    },
    changeMembershipLocationScope: (actor, input) => {
      const roleForScopeValidation =
        actor.authorization.role === "owner" || actor.authorization.role === "admin"
          ? "staff"
          : actor.authorization.role;
      const scope = requireScope(roleForScopeValidation, input.locationScope, input.locationIds);
      return store.changeMembershipLocationScope({ ...mutationBase(actor, input), ...scope });
    },
    changeMembershipRole: (actor, input) => {
      if (!isMembershipRole(input.role)) throw new MembershipLifecyclePermissionDeniedError();
      return store.changeMembershipRole({ ...mutationBase(actor, input), role: input.role });
    },
    issueInvitation: async (actor, input): Promise<IssuedMembershipInvitation> => {
      const now = clock();
      const authorization = requireActor(actor, now);
      if (
        !isMembershipRole(input.role) ||
        !canInviteMembershipRole(authorization.role, input.role)
      ) {
        throw new MembershipLifecyclePermissionDeniedError();
      }
      const scope = requireScope(input.role, input.locationScope);
      const protectedTarget = targetProtector.protect(input.target);
      const credential = credentials.issue(now);
      const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MILLISECONDS);
      await store.issueInvitation({
        ...audited(input.audit, now, identifiers),
        actor: authorization,
        expiresAt,
        invitationId: credential.invitationId,
        locationScope: scope.locationScope,
        role: input.role,
        targetCiphertext: protectedTarget.ciphertext,
        targetLookupHash: protectedTarget.lookupHash,
        tokenHash: credential.tokenHash,
      });
      return Object.freeze({
        deliveryTarget: protectedTarget.canonicalTarget,
        expiresAt,
        invitationId: credential.invitationId,
        token: credential.token,
      });
    },
    reactivateMembership: (actor, input) => {
      if (!isMembershipRole(input.role)) throw new MembershipLifecyclePermissionDeniedError();
      const scope = requireScope(input.role, input.locationScope, input.locationIds);
      return store.reactivateMembership({
        ...mutationBase(actor, input),
        ...scope,
        role: input.role,
      });
    },
    resendInvitation: async (actor, input): Promise<IssuedMembershipInvitation> => {
      const now = clock();
      const credential = credentials.issue(now);
      const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MILLISECONDS);
      const targetCiphertext = await store.resendInvitation({
        ...audited(input.audit, now, identifiers),
        actor: requireActor(actor, now),
        currentInvitationId: requireResourceId(input.invitationId),
        expiresAt,
        replacementInvitationId: credential.invitationId,
        replacementTokenHash: credential.tokenHash,
      });
      return Object.freeze({
        deliveryTarget: targetProtector.reveal(targetCiphertext),
        expiresAt,
        invitationId: credential.invitationId,
        token: credential.token,
      });
    },
    revokeInvitation: (actor, input) => {
      const reason = input.reason.trim();
      if (reason !== input.reason || reason.length < 1 || reason.length > 500) {
        throw new TypeError("Invitation revocation reason is invalid");
      }
      const now = clock();
      return store.revokeInvitation({
        ...audited(input.audit, now, identifiers),
        actor: requireActor(actor, now),
        invitationId: requireResourceId(input.invitationId),
        reason,
      });
    },
    revokeMembership: (actor, input) => store.revokeMembership(mutationBase(actor, input)),
    suspendMembership: (actor, input) => store.suspendMembership(mutationBase(actor, input)),
  };
  return Object.freeze(lifecycle);
};
