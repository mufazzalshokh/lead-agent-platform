import type { UserId } from "@lead-agent/contracts";

import type {
  ExternalIdentityResolver,
  OidcIdentityVerifier,
  OidcVerificationInput,
  ValidatedOidcIdentity,
} from "./contracts.js";

declare const externalIdentityAuthenticationBrand: unique symbol;

export type ExternalIdentityAuthentication = Readonly<{
  userId: UserId;
  [externalIdentityAuthenticationBrand]: true;
}>;

export const authenticateExternalIdentity = async (
  verifier: OidcIdentityVerifier,
  resolver: ExternalIdentityResolver,
  input: OidcVerificationInput,
): Promise<ExternalIdentityAuthentication> => {
  const identity = await verifier.verify(input);
  const userId = await resolver.resolve(identity);
  return Object.freeze({ userId }) as ExternalIdentityAuthentication;
};

/** Authenticates identity evidence that was already verified and integrity-protected. */
export const authenticateValidatedExternalIdentity = async (
  identity: ValidatedOidcIdentity,
  resolver: ExternalIdentityResolver,
): Promise<ExternalIdentityAuthentication> => {
  const userId = await resolver.resolve(identity);
  return Object.freeze({ userId }) as ExternalIdentityAuthentication;
};
