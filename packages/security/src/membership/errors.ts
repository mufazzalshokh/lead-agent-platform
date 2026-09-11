export class InvitationTokenInvalidError extends Error {
  readonly code = "token_invalid" as const;

  constructor() {
    super("Invitation proof is invalid");
    this.name = "InvitationTokenInvalidError";
  }
}

export class MembershipLifecycleConflictError extends Error {
  readonly code = "conflict" as const;

  constructor() {
    super("Membership lifecycle operation conflicts with current state");
    this.name = "MembershipLifecycleConflictError";
  }
}

export class MembershipLifecycleNotFoundError extends Error {
  readonly code = "resource_not_found" as const;

  constructor() {
    super("Membership lifecycle resource was not found");
    this.name = "MembershipLifecycleNotFoundError";
  }
}

export class MembershipLifecyclePermissionDeniedError extends Error {
  readonly code = "permission_denied" as const;

  constructor() {
    super("Membership lifecycle operation is not permitted");
    this.name = "MembershipLifecyclePermissionDeniedError";
  }
}

export class MembershipFinalOwnerError extends Error {
  readonly code = "permission_denied" as const;

  constructor() {
    super("Organization must retain an active owner");
    this.name = "MembershipFinalOwnerError";
  }
}
