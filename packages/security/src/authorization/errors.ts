export class AuthorizationDeniedError extends Error {
  readonly code = "permission_denied" as const;

  constructor() {
    super("Authorization denied");
    this.name = "AuthorizationDeniedError";
  }
}

export class AuthorizationStateInvalidError extends Error {
  readonly code = "authorization_state_invalid" as const;

  constructor() {
    super("Current authorization state is invalid");
    this.name = "AuthorizationStateInvalidError";
  }
}
