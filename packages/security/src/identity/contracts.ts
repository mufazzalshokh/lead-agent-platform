import type { UserId } from "@lead-agent/contracts";

declare const validatedOidcIdentityBrand: unique symbol;

export type ValidatedOidcIdentity = Readonly<{
  issuer: string;
  subject: string;
  [validatedOidcIdentityBrand]: true;
}>;

export type OidcVerificationInput = Readonly<{
  expectedNonce: string;
  idToken: string;
}>;

export type VerifiedOidcIdentityEvidence = Readonly<{
  issuer: string;
  subject: string;
}>;

export interface OidcIdentityEvidenceVerifier {
  verifyEvidence(input: OidcVerificationInput): Promise<VerifiedOidcIdentityEvidence>;
}

export interface OidcIdentityVerifier {
  verify(input: OidcVerificationInput): Promise<ValidatedOidcIdentity>;
}

export interface ExternalIdentityResolver {
  resolve(identity: ValidatedOidcIdentity): Promise<UserId>;
}

/** Seals evidence returned by the configured cryptographic verifier. */
export const createOidcIdentityVerifier = (
  evidenceVerifier: OidcIdentityEvidenceVerifier,
): OidcIdentityVerifier =>
  Object.freeze({
    verify: async (input: OidcVerificationInput): Promise<ValidatedOidcIdentity> => {
      const evidence = await evidenceVerifier.verifyEvidence(input);
      return Object.freeze({
        issuer: evidence.issuer,
        subject: evidence.subject,
      }) as ValidatedOidcIdentity;
    },
  });
