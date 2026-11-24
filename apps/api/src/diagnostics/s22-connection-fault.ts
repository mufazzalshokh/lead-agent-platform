import type { IdentityDatabaseRuntimeConfig, S22ConnectionFaultProfile } from "@lead-agent/config";
import {
  createSessionConnectionProbe,
  SessionDatabaseError,
  type SessionConnectionProbe,
} from "@lead-agent/database";
import {
  hashSessionToken,
  SessionAuthenticationRequiredError,
  type AuthenticatedApplicationSession,
} from "@lead-agent/security";
import {
  createS22ConnectionFaultAdmission,
  type ProbeMetadata,
} from "./s22-connection-fault-admission.js";

export type S22SessionProbe = Readonly<{
  resolveSession: (
    header: unknown,
    token: string,
    normal: (token: string) => Promise<AuthenticatedApplicationSession>,
    report: (metadata: ProbeMetadata) => void,
  ) => Promise<AuthenticatedApplicationSession>;
}>;

/** Composition only: no provider, SQL administration, tenant or booking actions. */
export const createS22SessionProbe = (
  profile: S22ConnectionFaultProfile,
  configuration: IdentityDatabaseRuntimeConfig,
  environment: NodeJS.ProcessEnv,
  report: (
    receipt: Readonly<{
      operation: "s22_connection_fault";
      exercise_id: string;
      source_sha: string;
      profile_sha256: string;
      at: string;
      duration_ms: number;
      connection_cut: boolean;
      phase: string;
      sequence: number;
      outcome: string;
    }>,
  ) => void,
  clocks: Readonly<{ wall?: () => number; monotonic?: () => number }> = {},
) => {
  const admission = createS22ConnectionFaultAdmission(profile, clocks);
  const profileDigest = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
  const receipt = (
    phase: string,
    sequence: number,
    outcome: string,
    started = performance.now(),
    connectionCut = false,
  ): void => {
    report({
      operation: "s22_connection_fault",
      exercise_id: profile.exerciseId,
      source_sha: profile.sourceSha,
      profile_sha256: profileDigest,
      at: new Date().toISOString(),
      duration_ms: Math.max(0, Math.round(performance.now() - started)),
      connection_cut: connectionCut,
      phase,
      sequence,
      outcome,
    });
  };
  let transport: SessionConnectionProbe | null = null;
  let initialized = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposal: Promise<void> | undefined;
  const disposeOwned = (): Promise<void> => {
    const owned = transport;
    transport = null;
    if (owned !== null) disposal = owned.close();
    return disposal ?? Promise.resolve();
  };
  const assistCleanup = (): void => {
    // Cleanup is never the authority for stopping cuts. Selector/accept checks
    // remain correct if request-based CPU delays this callback indefinitely.
    void disposeOwned().catch(() => receipt("cleanup", 0, "cleanup_failed"));
  };
  return Object.freeze({
    start: async (): Promise<void> => {
      try {
        transport = await createSessionConnectionProbe(
          configuration,
          {
            onUnexpectedPoolError: () => {
              admission.retire();
              receipt("transport", 0, "unexpected_failure");
            },
          },
          environment,
        );
        initialized = true;
        expiryTimer = setTimeout(
          assistCleanup,
          Math.max(0, profile.expiresAt - (clocks.wall ?? Date.now)()),
        );
        expiryTimer.unref();
      } catch {
        admission.retire();
        receipt("initialization", 0, "not_admitted");
      }
    },
    close: async (): Promise<void> => {
      clearTimeout(expiryTimer);
      admission.retire();
      await disposeOwned();
    },
    resolveSession: async (
      header: unknown,
      token: string,
      normal: (token: string) => Promise<AuthenticatedApplicationSession>,
      metadata: (value: ProbeMetadata) => void,
    ): Promise<AuthenticatedApplicationSession> => {
      if ((clocks.wall ?? Date.now)() >= profile.expiresAt) assistCleanup();
      const attempt = initialized ? admission.begin(header, token) : null;
      if (attempt === null) {
        if (admission.isRetired()) assistCleanup();
        if (header !== undefined) receipt("admission", 0, "not_admitted");
        return normal(token);
      }
      const started = performance.now();
      let connectionCut = false;
      const complete = (session: AuthenticatedApplicationSession | null): void => {
        const result = attempt.finish(session);
        metadata(result);
        receipt(result.phase, result.sequence, result.state, started, connectionCut);
        if (admission.isRetired()) assistCleanup();
      };
      let session: AuthenticatedApplicationSession;
      try {
        if (attempt.useRelay() && transport !== null) {
          const hash = hashSessionToken(token);
          if (hash === undefined) {
            admission.retire();
            throw new SessionAuthenticationRequiredError();
          } else {
            const resolved = await transport.resolveSession(hash, () => {
              connectionCut = attempt.shouldCut();
              return connectionCut;
            });
            if (resolved === null) {
              admission.retire();
              // Preserve the same public authentication failure as the normal lifecycle.
              throw new SessionAuthenticationRequiredError();
            } else session = resolved;
          }
        } else session = await normal(token);
      } catch (error) {
        if (
          !(error instanceof SessionDatabaseError) ||
          (attempt.phase === "fault" && !connectionCut)
        )
          admission.retire();
        complete(null);
        throw error;
      }
      complete(session);
      return session;
    },
  });
};
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
