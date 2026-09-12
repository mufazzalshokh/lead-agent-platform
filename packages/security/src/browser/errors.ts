export class BrowserAuthenticationTokenInvalidError extends Error {
  readonly code = "token_invalid" as const;

  constructor() {
    super("Browser authentication proof is invalid");
    this.name = "BrowserAuthenticationTokenInvalidError";
  }
}

export class BrowserCsrfInvalidError extends Error {
  readonly code = "csrf_invalid" as const;

  constructor() {
    super("CSRF proof is invalid");
    this.name = "BrowserCsrfInvalidError";
  }
}

export class BrowserOriginNotAllowedError extends Error {
  readonly code = "origin_not_allowed" as const;

  constructor() {
    super("Browser origin is not allowed");
    this.name = "BrowserOriginNotAllowedError";
  }
}
