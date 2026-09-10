import type { UserId } from "@lead-agent/contracts";

import type { ExternalIdentityAuthentication } from "../identity/authenticate.js";
import {
  createSessionCredentialFactory,
  hashSessionToken,
  type SessionCredentialFactory,
} from "./credentials.js";
import { SessionAuthenticationRequiredError } from "./errors.js";

declare const sessionAuthenticationEvidenceBrand: unique symbol;

const AUTHENTICATION_LEVEL_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export type SessionAuthenticationEvidence = Readonly<{
  authenticationLevel: string;
  authenticationTime: Date;
  userId: UserId;
  [sessionAuthenticationEvidenceBrand]: true;
}>;

export const createSessionAuthenticationEvidence = (
  authentication: ExternalIdentityAuthentication,
  input: Readonly<{ authenticationLevel: string; authenticationTime: Date }>,
): SessionAuthenticationEvidence => {
  if (
    !AUTHENTICATION_LEVEL_PATTERN.test(input.authenticationLevel) ||
    input.authenticationLevel.length > 32 ||
    !Number.isFinite(input.authenticationTime.getTime())
  ) {
    throw new TypeError("Trusted session authentication evidence is invalid");
  }
  return Object.freeze({
    authenticationLevel: input.authenticationLevel,
    authenticationTime: new Date(input.authenticationTime),
    userId: authentication.userId,
  }) as SessionAuthenticationEvidence;
};

export type AuthenticatedApplicationSession = Readonly<{
  absoluteExpiresAt: Date;
  authenticationLevel: string;
  authenticationTime: Date;
  createdAt: Date;
  idleExpiresAt: Date;
  lastSeenAt: Date;
  rotatedAt: Date;
  rotationDue: boolean;
  sessionId: string;
  userId: UserId;
}>;

export type IssuedApplicationSession = Readonly<{
  csrfSecret: string;
  evictedSessionCount: number;
  session: AuthenticatedApplicationSession;
  sessionToken: string;
}>;

export type SessionCreationPersistence = Readonly<{
  authenticationLevel: string;
  authenticationTime: Date;
  csrfSecretHash: Uint8Array;
  sessionId: string;
  sessionTokenHash: Uint8Array;
  sourceIpHash?: Uint8Array;
  userAgentHash?: Uint8Array;
  userId: UserId;
}>;

export type SessionRotationPersistence = Readonly<{
  authenticationEvidence?: SessionAuthenticationEvidence;
  csrfSecretHash: Uint8Array;
  currentSessionTokenHash: Uint8Array;
  replacementSessionTokenHash: Uint8Array;
}>;

export type SessionCreationPersistenceResult = Readonly<{
  evictedSessionCount: number;
  session: AuthenticatedApplicationSession;
}>;

export interface ApplicationSessionStore {
  createSession(
    input: SessionCreationPersistence,
  ): Promise<SessionCreationPersistenceResult | null>;
  resolveSession(sessionTokenHash: Uint8Array): Promise<AuthenticatedApplicationSession | null>;
  revokeSession(sessionTokenHash: Uint8Array): Promise<void>;
  revokeUserSessions(userId: UserId, reason: UserSessionRevocationReason): Promise<number>;
  rotateSession(input: SessionRotationPersistence): Promise<AuthenticatedApplicationSession | null>;
}

export type UserSessionRevocationReason =
  "membership_changed" | "privilege_changed" | "security_recovery" | "sign_out_all";

export interface ApplicationSessionLifecycle {
  createSession(
    evidence: SessionAuthenticationEvidence,
    metadata?: Readonly<{ sourceIpHash?: Uint8Array; userAgentHash?: Uint8Array }>,
  ): Promise<IssuedApplicationSession>;
  resolveSession(sessionToken: string): Promise<AuthenticatedApplicationSession>;
  revokeSession(sessionToken: string): Promise<void>;
  revokeUserSessions(userId: UserId, reason: UserSessionRevocationReason): Promise<number>;
  rotateSession(
    sessionToken: string,
    evidence?: SessionAuthenticationEvidence,
  ): Promise<IssuedApplicationSession>;
}

const requireTokenHash = (sessionToken: string): Uint8Array => {
  const hash = hashSessionToken(sessionToken);
  if (hash === undefined) {
    throw new SessionAuthenticationRequiredError();
  }
  return hash;
};

export const createApplicationSessionLifecycle = (
  store: ApplicationSessionStore,
  options: Readonly<{
    clock?: () => Date;
    credentialFactory?: SessionCredentialFactory;
  }> = {},
): ApplicationSessionLifecycle => {
  const clock = options.clock ?? (() => new Date());
  const credentialFactory = options.credentialFactory ?? createSessionCredentialFactory();

  return Object.freeze({
    createSession: async (
      evidence: SessionAuthenticationEvidence,
      metadata: Readonly<{ sourceIpHash?: Uint8Array; userAgentHash?: Uint8Array }> = {},
    ): Promise<IssuedApplicationSession> => {
      const credentials = credentialFactory.issue(clock());
      const persisted = await store.createSession({
        authenticationLevel: evidence.authenticationLevel,
        authenticationTime: evidence.authenticationTime,
        csrfSecretHash: credentials.csrfSecretHash,
        sessionId: credentials.sessionId,
        sessionTokenHash: credentials.sessionTokenHash,
        ...(metadata.sourceIpHash === undefined ? {} : { sourceIpHash: metadata.sourceIpHash }),
        ...(metadata.userAgentHash === undefined ? {} : { userAgentHash: metadata.userAgentHash }),
        userId: evidence.userId,
      });
      if (persisted === null) {
        throw new SessionAuthenticationRequiredError();
      }
      return Object.freeze({
        csrfSecret: credentials.csrfSecret,
        evictedSessionCount: persisted.evictedSessionCount,
        session: persisted.session,
        sessionToken: credentials.sessionToken,
      });
    },
    resolveSession: async (sessionToken: string): Promise<AuthenticatedApplicationSession> => {
      const session = await store.resolveSession(requireTokenHash(sessionToken));
      if (session === null) {
        throw new SessionAuthenticationRequiredError();
      }
      return session;
    },
    revokeSession: async (sessionToken: string): Promise<void> => {
      const hash = hashSessionToken(sessionToken);
      if (hash !== undefined) {
        await store.revokeSession(hash);
      }
    },
    revokeUserSessions: (userId: UserId, reason: UserSessionRevocationReason): Promise<number> =>
      store.revokeUserSessions(userId, reason),
    rotateSession: async (
      sessionToken: string,
      evidence?: SessionAuthenticationEvidence,
    ): Promise<IssuedApplicationSession> => {
      const credentials = credentialFactory.issue(clock());
      const session = await store.rotateSession({
        ...(evidence === undefined ? {} : { authenticationEvidence: evidence }),
        csrfSecretHash: credentials.csrfSecretHash,
        currentSessionTokenHash: requireTokenHash(sessionToken),
        replacementSessionTokenHash: credentials.sessionTokenHash,
      });
      if (session === null) {
        throw new SessionAuthenticationRequiredError();
      }
      return Object.freeze({
        csrfSecret: credentials.csrfSecret,
        evictedSessionCount: 0,
        session,
        sessionToken: credentials.sessionToken,
      });
    },
  });
};
