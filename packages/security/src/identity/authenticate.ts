import type { UserId } from "@lead-agent/contracts";

import type {
  ExternalIdentityResolver,
  OidcIdentityVerifier,
  OidcVerificationInput,
} from "./contracts.js";

export type ExternalIdentityAuthentication = Readonly<{
  userId: UserId;
}>;

export const authenticateExternalIdentity = async (
  verifier: OidcIdentityVerifier,
  resolver: ExternalIdentityResolver,
  input: OidcVerificationInput,
): Promise<ExternalIdentityAuthentication> => {
  const identity = await verifier.verify(input);
  const userId = await resolver.resolve(identity);
  return Object.freeze({ userId });
};
