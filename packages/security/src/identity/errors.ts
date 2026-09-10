export class OidcCredentialInvalidError extends Error {
  readonly code = "oidc_credential_invalid" as const;

  constructor() {
    super("OIDC credential is invalid");
    this.name = "OidcCredentialInvalidError";
  }
}

export class OidcProviderUnavailableError extends Error {
  readonly code = "oidc_provider_unavailable" as const;

  constructor() {
    super("OIDC identity provider verification is unavailable");
    this.name = "OidcProviderUnavailableError";
  }
}

export class ExternalIdentityUnmappedError extends Error {
  readonly code = "external_identity_unmapped" as const;

  constructor() {
    super("OIDC identity is not mapped to an application user");
    this.name = "ExternalIdentityUnmappedError";
  }
}

export class ExternalIdentityDeniedError extends Error {
  readonly code = "external_identity_denied" as const;

  constructor() {
    super("OIDC identity is not permitted to authenticate");
    this.name = "ExternalIdentityDeniedError";
  }
}
