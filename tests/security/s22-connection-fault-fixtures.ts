import { loadS22ConnectionFaultProfile } from "../../packages/config/src/index.js";
import { digestProbeSession } from "../../apps/api/src/diagnostics/s22-connection-fault-admission.js";
import { NOW, staffSession } from "../telegram/fixtures.js";

export const probeProfileValue = () => ({
  version: 1,
  exerciseId: "12121212-1212-4121-8121-121212121212",
  projectId: "lead-agent-stg-739284",
  region: "me-central1",
  service: "lead-agent-staging-api",
  sourceSha: "a".repeat(40),
  sessionDigest: digestProbeSession(staffSession.sessionId),
  baselineAt: new Date(NOW.getTime() + 60000).toISOString(),
  faultAt: new Date(NOW.getTime() + 150000).toISOString(),
  expiresAt: new Date(NOW.getTime() + 510000).toISOString(),
});
export const probeEnvironment = (): NodeJS.ProcessEnv => ({
  S22_CONNECTION_FAULT_PROFILE: JSON.stringify(probeProfileValue()),
  DEPLOYMENT_ENVIRONMENT: "staging",
  APP_ENV: "production",
  DEPLOYMENT_GIT_SHA: "a".repeat(40),
  GOOGLE_CLOUD_PROJECT: "lead-agent-stg-739284",
  GOOGLE_CLOUD_REGION: "me-central1",
  K_SERVICE: "lead-agent-staging-api",
});
export const probeProfile = () => {
  const result = loadS22ConnectionFaultProfile(probeEnvironment(), NOW);
  if (result.state !== "ready") throw new Error("Invalid synthetic probe profile");
  return result.profile;
};
