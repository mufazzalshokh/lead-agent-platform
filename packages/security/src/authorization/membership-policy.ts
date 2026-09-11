import { hasPermission, isMembershipRole } from "./permissions.js";

export const canInviteMembershipRole = (actorRole: unknown, invitedRole: unknown): boolean => {
  if (
    !isMembershipRole(actorRole) ||
    !isMembershipRole(invitedRole) ||
    !hasPermission(actorRole, "memberships.invite")
  ) {
    return false;
  }
  return actorRole === "owner" || invitedRole !== "owner";
};

export const canManageMembershipTarget = (
  actorRole: unknown,
  currentTargetRole: unknown,
  proposedTargetRole: unknown = currentTargetRole,
): boolean => {
  if (
    !isMembershipRole(actorRole) ||
    !isMembershipRole(currentTargetRole) ||
    !isMembershipRole(proposedTargetRole) ||
    !hasPermission(actorRole, "memberships.manage")
  ) {
    return false;
  }
  if (actorRole === "owner") {
    return true;
  }
  return actorRole === "admin" && currentTargetRole !== "owner" && proposedTargetRole !== "owner";
};
