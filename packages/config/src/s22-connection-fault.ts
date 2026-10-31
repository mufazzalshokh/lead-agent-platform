const profileBrand: unique symbol = Symbol("S22ConnectionFaultProfile");

export type S22ConnectionFaultProfile = Readonly<{
  exerciseId: string;
  sourceSha: string;
  sessionDigest: string;
  baselineAt: number;
  faultAt: number;
  expiresAt: number;
  [profileBrand]: true;
}>;

export type S22ConnectionFaultConfiguration =
  | Readonly<{ state: "off" | "not_admitted" }>
  | Readonly<{ state: "ready"; profile: S22ConnectionFaultProfile }>;

const exactKeys = [
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
const sha256 = /^[a-f0-9]{64}$/u;
const sourceSha = /^[a-f0-9]{40}$/u;
const exerciseId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const utc = (value: unknown): number => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
};

/** Deployment metadata is trusted configuration, not proof of Google identity.
 * A later exact-plan guard must bind it to the actual staging resource and image.
 * Missing metadata disables the fixture; APP_ENV=production remains appropriate
 * for staging's normal authentication security settings.
 */
export const loadS22ConnectionFaultProfile = (
  environment: NodeJS.ProcessEnv,
  now: Date = new Date(),
): S22ConnectionFaultConfiguration => {
  const raw = environment["S22_CONNECTION_FAULT_PROFILE"];
  if (raw === undefined) return Object.freeze({ state: "off" });
  const denied = Object.freeze({ state: "not_admitted" as const });
  if (Buffer.byteLength(raw, "utf8") > 2048) return denied;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return denied;
    const entries = Object.entries(value);
    if (entries.length !== exactKeys.length || entries.some(([key]) => !exactKeys.includes(key)))
      return denied;
    const data: Readonly<Record<string, unknown>> = Object.fromEntries(entries);
    if (
      data["version"] !== 1 ||
      data["projectId"] !== "lead-agent-stg-739284" ||
      data["region"] !== "me-central1" ||
      data["service"] !== "lead-agent-staging-api" ||
      environment["DEPLOYMENT_ENVIRONMENT"] !== "staging" ||
      environment["GOOGLE_CLOUD_PROJECT"] !== data["projectId"] ||
      environment["GOOGLE_CLOUD_REGION"] !== data["region"] ||
      environment["K_SERVICE"] !== data["service"] ||
      typeof data["sourceSha"] !== "string" ||
      !sourceSha.test(data["sourceSha"]) ||
      environment["DEPLOYMENT_GIT_SHA"] !== data["sourceSha"] ||
      typeof data["exerciseId"] !== "string" ||
      !exerciseId.test(data["exerciseId"]) ||
      typeof data["sessionDigest"] !== "string" ||
      !sha256.test(data["sessionDigest"])
    )
      return denied;
    const baselineAt = utc(data["baselineAt"]);
    const faultAt = utc(data["faultAt"]);
    const expiresAt = utc(data["expiresAt"]);
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(baselineAt) ||
      faultAt !== baselineAt + 90_000 ||
      expiresAt !== faultAt + 360_000 ||
      now.getTime() >= baselineAt ||
      baselineAt - now.getTime() > 3_600_000
    )
      return denied;
    return Object.freeze({
      state: "ready",
      profile: Object.freeze({
        exerciseId: data["exerciseId"],
        sourceSha: data["sourceSha"],
        sessionDigest: data["sessionDigest"],
        baselineAt,
        faultAt,
        expiresAt,
        [profileBrand]: true as const,
      }),
    });
  } catch {
    // Never include parser errors: they can contain the private profile.
    return denied;
  }
};
