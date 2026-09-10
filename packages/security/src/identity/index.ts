export {
  authenticateExternalIdentity,
  type ExternalIdentityAuthentication,
} from "./authenticate.js";
export type {
  ExternalIdentityResolver,
  OidcIdentityEvidenceVerifier,
  OidcIdentityVerifier,
  OidcVerificationInput,
  ValidatedOidcIdentity,
  VerifiedOidcIdentityEvidence,
} from "./contracts.js";
export { createOidcIdentityVerifier } from "./contracts.js";
export {
  ExternalIdentityDeniedError,
  ExternalIdentityUnmappedError,
  OidcCredentialInvalidError,
  OidcProviderUnavailableError,
} from "./errors.js";
