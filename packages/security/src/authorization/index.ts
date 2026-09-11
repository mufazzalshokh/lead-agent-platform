export {
  resolveAuthorizationContext,
  isAuthorizationContext,
  type AuthorizationContext,
  type CurrentMembershipAuthorization,
  type CurrentMembershipAuthorizationResolver,
} from "./context.js";
export { AuthorizationDeniedError, AuthorizationStateInvalidError } from "./errors.js";
export { canInviteMembershipRole, canManageMembershipTarget } from "./membership-policy.js";
export {
  LOCATION_SCOPES,
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUSES,
  ROLE_PERMISSION_BUNDLES,
  TENANT_PERMISSIONS,
  hasPermission,
  isLocationScope,
  isMembershipRole,
  isMembershipStatus,
  isTenantPermission,
  type LocationScope,
  type MembershipRole,
  type MembershipStatus,
  type TenantPermission,
} from "./permissions.js";
export {
  authorizeResource,
  createOrganizationResourceScope,
  resolveLocationResourceScope,
  type AuthorizationDecision,
  type AuthorizationResourceScope,
  type LocationOwnershipVerifier,
} from "./resource-policy.js";
