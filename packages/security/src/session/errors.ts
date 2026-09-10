export class SessionAuthenticationRequiredError extends Error {
  readonly code = "authentication_required" as const;

  constructor() {
    super("Application session authentication is required");
    this.name = "SessionAuthenticationRequiredError";
  }
}
