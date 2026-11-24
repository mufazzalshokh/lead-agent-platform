// Browser-safe validation. No configuration, clock, request or secret is read on import.
export const connectionFaultTarget = Object.freeze({
  projectId: "lead-agent-stg-739284",
  region: "me-central1",
  service: "lead-agent-staging-api",
  sourceSha: "7a4201c824be3db2396b51c14d62e6758f43e860",
});
const keys = [
  "version",
  "exerciseId",
  "projectId",
  "region",
  "service",
  "sourceSha",
  "sessionDigest",
  "baselineAt",
  "faultAt",
  "expiresAt",
];
export const profileDenied = () => {
  throw new Error("S22_CONNECTION_FAULT_PROFILE_DENIED");
};
const requireSafe = (condition) => {
  if (!condition) profileDenied();
};
export function canonicalUtc(value) {
  requireSafe(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value),
  );
  const parsed = Date.parse(value);
  requireSafe(Number.isFinite(parsed) && new Date(parsed).toISOString() === value);
  return parsed;
}

// Preparation deliberately requires compact JSON: duplicate keys/whitespace are
// denied, even though the deployed loader tolerates them. Removal is structural;
// an expired activation must remain removable without re-admitting it.
export function validateConnectionFaultProfile(raw, startupAt) {
  try {
    requireSafe(typeof raw === "string" && new TextEncoder().encode(raw).length <= 2048);
    const value = JSON.parse(raw);
    requireSafe(value !== null && typeof value === "object" && !Array.isArray(value));
    requireSafe(JSON.stringify(value) === raw);
    requireSafe(
      Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
    );
    requireSafe(value.version === 1);
    for (const [key, expected] of Object.entries(connectionFaultTarget))
      requireSafe(value[key] === expected);
    requireSafe(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
        value.exerciseId,
      ),
    );
    requireSafe(
      typeof value.sessionDigest === "string" && /^[a-f0-9]{64}$/u.test(value.sessionDigest),
    );
    const baselineAt = canonicalUtc(value.baselineAt);
    const faultAt = canonicalUtc(value.faultAt);
    const expiresAt = canonicalUtc(value.expiresAt);
    requireSafe(faultAt === baselineAt + 90_000 && expiresAt === faultAt + 360_000);
    if (startupAt !== undefined)
      requireSafe(
        Number.isFinite(startupAt) && startupAt < baselineAt && baselineAt - startupAt <= 3_600_000,
      );
    return Object.freeze({ ...value, baselineAt, faultAt, expiresAt });
  } catch {
    // Parser/type errors can contain private fragments. Never propagate them.
    profileDenied();
  }
}

// Match createS22SessionProbe's normalized hash, NOT the raw environment JSON.
export const runtimeProfileJson = (profile) =>
  JSON.stringify({
    exerciseId: profile.exerciseId,
    sourceSha: profile.sourceSha,
    sessionDigest: profile.sessionDigest,
    baselineAt: profile.baselineAt,
    faultAt: profile.faultAt,
    expiresAt: profile.expiresAt,
  });

export function connectionFaultSlot(profile, sequence) {
  requireSafe(Number.isSafeInteger(sequence) && sequence >= 1 && sequence <= 43);
  if (sequence <= 4)
    return Object.freeze({ phase: "baseline", at: profile.baselineAt + (sequence - 1) * 15_000 });
  if (sequence <= 27)
    return Object.freeze({ phase: "fault", at: profile.faultAt + (sequence - 5) * 15_000 });
  return Object.freeze({ phase: "recovery", at: profile.expiresAt + (sequence - 28) * 30_000 });
}
