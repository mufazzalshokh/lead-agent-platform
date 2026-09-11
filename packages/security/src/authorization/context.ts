import {
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  UserIdSchema,
  isSchemaValue,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type UserId,
} from "@lead-agent/contracts";

import type { AuthenticatedApplicationSession } from "../session/lifecycle.js";
import { AuthorizationDeniedError, AuthorizationStateInvalidError } from "./errors.js";
import {
  isLocationScope,
  isMembershipRole,
  isMembershipStatus,
  type LocationScope,
  type MembershipRole,
  type MembershipStatus,
} from "./permissions.js";

const authorizationContextBrand: unique symbol = Symbol("AuthorizationContext");

export type CurrentMembershipAuthorization = Readonly<{
  allowedLocationIds: readonly LocationId[];
  locationScope: LocationScope;
  membershipId: MembershipId;
  organizationId: OrganizationId;
  role: MembershipRole;
  status: MembershipStatus;
  userId: UserId;
}>;

export interface CurrentMembershipAuthorizationResolver {
  resolveCurrentMembership(
    userId: UserId,
    requestedOrganizationId: OrganizationId,
  ): Promise<CurrentMembershipAuthorization | null>;
}

export type AuthorizationContext = Readonly<{
  allowedLocationIds: readonly LocationId[];
  locationScope: LocationScope;
  membershipId: MembershipId;
  organizationId: OrganizationId;
  role: MembershipRole;
  userId: UserId;
  [authorizationContextBrand]: true;
}>;

const validLocationIds = (value: unknown): value is readonly LocationId[] =>
  Array.isArray(value) && value.every((locationId) => isSchemaValue(LocationIdSchema, locationId));

const buildAuthorizationContext = (
  session: AuthenticatedApplicationSession,
  requestedOrganizationId: OrganizationId,
  current: CurrentMembershipAuthorization,
): AuthorizationContext => {
  if (
    !isSchemaValue(UserIdSchema, session.userId) ||
    !isSchemaValue(OrganizationIdSchema, requestedOrganizationId) ||
    !isSchemaValue(MembershipIdSchema, current.membershipId) ||
    !isSchemaValue(UserIdSchema, current.userId) ||
    !isSchemaValue(OrganizationIdSchema, current.organizationId) ||
    current.userId !== session.userId ||
    current.organizationId !== requestedOrganizationId ||
    !validLocationIds(current.allowedLocationIds)
  ) {
    throw new AuthorizationStateInvalidError();
  }
  if (
    !isMembershipStatus(current.status) ||
    current.status !== "active" ||
    !isMembershipRole(current.role) ||
    !isLocationScope(current.locationScope)
  ) {
    throw new AuthorizationDeniedError();
  }
  if ((current.role === "owner" || current.role === "admin") && current.locationScope !== "all") {
    throw new AuthorizationStateInvalidError();
  }

  const distinctLocationIds = new Set(current.allowedLocationIds);
  if (distinctLocationIds.size !== current.allowedLocationIds.length) {
    throw new AuthorizationStateInvalidError();
  }
  const allowedLocationIds = Object.freeze(
    current.locationScope === "restricted" ? [...current.allowedLocationIds] : [],
  );
  return Object.freeze({
    allowedLocationIds,
    locationScope: current.locationScope,
    membershipId: current.membershipId,
    organizationId: current.organizationId,
    role: current.role,
    userId: current.userId,
    [authorizationContextBrand]: true as const,
  });
};

export const isAuthorizationContext = (value: unknown): value is AuthorizationContext =>
  typeof value === "object" &&
  value !== null &&
  Reflect.get(value, authorizationContextBrand) === true;

export const resolveAuthorizationContext = async (
  session: AuthenticatedApplicationSession,
  requestedOrganizationId: OrganizationId,
  resolver: CurrentMembershipAuthorizationResolver,
): Promise<AuthorizationContext> => {
  const current = await resolver.resolveCurrentMembership(session.userId, requestedOrganizationId);
  if (current === null) {
    throw new AuthorizationDeniedError();
  }
  return buildAuthorizationContext(session, requestedOrganizationId, current);
};
