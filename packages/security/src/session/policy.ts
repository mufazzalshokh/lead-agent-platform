export const SESSION_POLICY = Object.freeze({
  absoluteLifetimeMilliseconds: 12 * 60 * 60 * 1_000,
  idleTimeoutMilliseconds: 60 * 60 * 1_000,
  maximumActiveSessions: 5,
  metadataRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  rotationIntervalMilliseconds: 4 * 60 * 60 * 1_000,
  stepUpFreshnessMilliseconds: 15 * 60 * 1_000,
});

export type SessionAssuranceEvidence = Readonly<{
  authenticationLevel: string;
  authenticationTime: Date;
}>;

export const isRotationDue = (rotatedAt: Date, now: Date): boolean =>
  now.getTime() >= rotatedAt.getTime() + SESSION_POLICY.rotationIntervalMilliseconds;

export const isFreshStepUp = (session: SessionAssuranceEvidence, now: Date): boolean => {
  const elapsed = now.getTime() - session.authenticationTime.getTime();
  return (
    session.authenticationLevel === "mfa" &&
    elapsed >= 0 &&
    elapsed < SESSION_POLICY.stepUpFreshnessMilliseconds
  );
};

export const sessionMetadataRetentionEligibleAt = (terminalAt: Date): Date =>
  new Date(terminalAt.getTime() + SESSION_POLICY.metadataRetentionMilliseconds);
