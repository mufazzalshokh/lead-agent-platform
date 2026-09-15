export class WidgetOriginInvalidError extends Error {
  readonly code = "origin_not_allowed" as const;
  constructor() {
    super("Widget origin is not allowed");
    this.name = "WidgetOriginInvalidError";
  }
}

export class WidgetTokenInvalidError extends Error {
  readonly code = "token_invalid" as const;
  constructor() {
    super("Widget token is invalid");
    this.name = "WidgetTokenInvalidError";
  }
}

export class WidgetRateLimitError extends Error {
  readonly code = "rate_limited" as const;
  constructor(public readonly retryAfterSeconds: number) {
    super("Widget request rate limit exceeded");
    this.name = "WidgetRateLimitError";
  }
}
