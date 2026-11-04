import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { S22ConnectionFaultProfile } from "@lead-agent/config";
import type { AuthenticatedApplicationSession } from "@lead-agent/security";

export const S22_CONNECTION_FAULT_HEADER = "x-s22-connection-fault";
export type ProbePhase = "baseline" | "fault" | "recovery" | "abort";
export type ProbeMetadata = Readonly<{
  phase: ProbePhase;
  sequence: number;
  nonce: string;
  state: "healthy" | "admitted" | "dependency_failure" | "retired" | "recovered";
}>;
export type ProbeAttempt = Readonly<{
  phase: ProbePhase;
  sequence: number;
  nonce: string;
  useRelay: () => boolean;
  shouldCut: () => boolean;
  finish: (session: AuthenticatedApplicationSession | null) => ProbeMetadata;
}>;

export const digestProbeSession = (sessionId: string): string =>
  createHash("sha256").update(sessionId, "utf8").digest("hex");

/** This cache can select a denial path only. It never authenticates a request. */
export const createS22ConnectionFaultAdmission = (
  profile: S22ConnectionFaultProfile,
  options: Readonly<{ wall?: () => number; monotonic?: () => number }> = {},
) => {
  const wall = options.wall ?? Date.now;
  const monotonic = options.monotonic ?? (() => performance.now());
  const originWall = wall();
  const originMono = monotonic();
  let lastWall = originWall;
  let lastMono = originMono;
  const nonce = randomBytes(24).toString("base64url");
  const key = randomBytes(32);
  const fingerprint = (token: string): Buffer => createHmac("sha256", key).update(token).digest();
  let admittedCredential: Buffer | null = null;
  let baselineCredential: Buffer | null = null;
  let retired =
    !Number.isFinite(originWall) ||
    !Number.isFinite(originMono) ||
    originWall >= profile.baselineAt;
  let baseline = 0;
  let previousSequence = 0;
  let recoveryHealthy = 0;
  let inFlight: symbol | null = null;

  const retire = (): void => {
    retired = true;
    admittedCredential = null;
    baselineCredential = null;
  };
  const sample = (): number => {
    const now = wall();
    const mono = monotonic();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(mono) ||
      now < lastWall ||
      mono < lastMono ||
      Math.abs(now - originWall - (mono - originMono)) > 2000
    )
      retire();
    lastWall = now;
    lastMono = mono;
    if (now >= profile.expiresAt - 2000) {
      admittedCredential = null;
      baselineCredential = null;
    }
    return now;
  };

  return Object.freeze({
    retire,
    isRetired: () => retired,
    begin: (header: unknown, token: string): ProbeAttempt | null => {
      if (header === undefined) return null;
      const now = sample();
      if (retired) return null;
      if (typeof header !== "string" || header.length > 160) {
        retire();
        return null;
      }
      const parts = header.split(":");
      const [exercise, rawSequence, suppliedNonce, action] = parts;
      const sequence = Number(rawSequence);
      if (
        parts.length !== 4 ||
        exercise !== profile.exerciseId ||
        rawSequence !== String(sequence) ||
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        sequence > 43 ||
        sequence !== previousSequence + 1 ||
        inFlight !== null ||
        (action !== "read" && action !== "abort") ||
        (sequence === 1 ? suppliedNonce !== "-" : suppliedNonce !== nonce)
      ) {
        retire();
        return null;
      }
      const phase =
        action === "abort"
          ? "abort"
          : sequence <= 4
            ? "baseline"
            : sequence <= 27
              ? "fault"
              : "recovery";
      const scheduled =
        sequence <= 4
          ? profile.baselineAt + (sequence - 1) * 15000
          : sequence <= 27
            ? profile.faultAt + (sequence - 5) * 15000
            : profile.expiresAt + (sequence - 28) * 30000;
      if (
        now < scheduled ||
        now >= scheduled + 15000 ||
        now > profile.expiresAt + 600000 ||
        (phase === "baseline" &&
          baselineCredential !== null &&
          !timingSafeEqual(baselineCredential, fingerprint(token))) ||
        (phase === "fault" && (baseline !== 4 || profile.expiresAt - 2000 - now < 15000)) ||
        (sequence > 4 &&
          phase !== "recovery" &&
          (admittedCredential === null || !timingSafeEqual(admittedCredential, fingerprint(token))))
      ) {
        retire();
        return null;
      }
      previousSequence = sequence;
      const attemptId = Symbol("probe-attempt");
      inFlight = attemptId;
      const deadline = Math.min(now + 15000, scheduled + 15000);
      if (phase === "abort") retire();
      const current = (): boolean => {
        const time = sample();
        if (time >= deadline) retire();
        return !retired && inFlight === attemptId;
      };
      return Object.freeze({
        phase,
        sequence,
        nonce,
        useRelay: () => current() && (phase === "fault" || (phase === "baseline" && sequence > 1)),
        shouldCut: () =>
          current() &&
          phase === "fault" &&
          lastWall < profile.expiresAt - 2000 &&
          admittedCredential !== null,
        finish: (session: AuthenticatedApplicationSession | null): ProbeMetadata => {
          const valid = current();
          if (inFlight === attemptId) inFlight = null;
          let state: ProbeMetadata["state"] = "retired";
          if (
            valid &&
            session !== null &&
            !session.rotationDue &&
            digestProbeSession(session.sessionId) === profile.sessionDigest
          ) {
            if (phase === "baseline") {
              baselineCredential ??= fingerprint(token);
              baseline += 1;
              if (baseline === 4) {
                admittedCredential = baselineCredential;
                baselineCredential = null;
              }
              state = baseline === 4 ? "admitted" : "healthy";
            } else if (phase === "recovery") {
              recoveryHealthy += 1;
              state = recoveryHealthy === 2 ? "recovered" : "healthy";
              if (recoveryHealthy === 2) retire();
            } else retire(); // A healthy fault response is not fault evidence.
          } else if (valid && (phase === "fault" || phase === "recovery") && session === null) {
            recoveryHealthy = 0;
            state = "dependency_failure";
          } else retire();
          if (sequence === 43) retire();
          return Object.freeze({ phase, sequence, nonce, state });
        },
      });
    },
  });
};
