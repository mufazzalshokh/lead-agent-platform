import { randomBytes } from "node:crypto";

import cookie from "@fastify/cookie";
import {
  CorrelationIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  isSchemaValue,
  type OrganizationId,
} from "@lead-agent/contracts";
import type { StaffWebAuthConfig } from "@lead-agent/config";
import type { StaffBrowserOidcClient } from "@lead-agent/integrations";
import {
  AuthorizationDeniedError,
  BrowserAuthenticationTokenInvalidError,
  BrowserCsrfInvalidError,
  BrowserOriginNotAllowedError,
  ExternalIdentityDeniedError,
  ExternalIdentityUnmappedError,
  InvitationTokenInvalidError,
  MembershipLifecycleConflictError,
  MembershipLifecycleNotFoundError,
  MembershipLifecyclePermissionDeniedError,
  OidcCredentialInvalidError,
  OidcProviderUnavailableError,
  SessionAuthenticationRequiredError,
  authenticateValidatedExternalIdentity,
  createSessionAuthenticationEvidence,
  canonicalizeInvitationEmailTarget,
  hashInvitationToken,
  isFreshStepUp,
  requireAcceptableFetchMetadata,
  requireSessionBoundCsrf,
  requireTrustedStaffOrigin,
  resolveAuthorizationContext,
  resolveSafeReturnPath,
  BROWSER_AUTH_COOKIE_NAMES,
  BROWSER_AUTH_POLICY,
  type ApplicationSessionLifecycle,
  type AuthenticatedApplicationSession,
  type BrowserAuthEnvelopeProtector,
  type CurrentMembershipAuthorizationResolver,
  type ExternalIdentityResolver,
  type InvitationAcceptanceResult,
  type MembershipLifecycleAuditContext,
  type OidcIdentityVerifier,
  type ValidatedOidcIdentity,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from "fastify";
import Fastify, { LogController } from "fastify";

const STAFF_AUTH_PREFIX = "/v1/staff/auth";
const CSRF_HEADER = "x-csrf-token";
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const MAX_INVITATION_TOKEN_LENGTH = 512;

export const STAFF_AUTH_LOG_REDACTION_PATHS = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-csrf-token",
  "res.headers.set-cookie",
  "body.authorization_code",
  "body.invitation_token",
  "body.refresh_token",
]);

export type InvitationAcceptanceBoundary = Readonly<{
  accept(
    input: Readonly<{
      audit: MembershipLifecycleAuditContext;
      identity: ValidatedOidcIdentity;
      organizationId: OrganizationId;
      token: string;
      verifiedEmailTarget: string;
    }>,
  ): Promise<InvitationAcceptanceResult>;
}>;

export type StaffAuthDependencies = Readonly<{
  authorizationResolver: CurrentMembershipAuthorizationResolver;
  config: StaffWebAuthConfig;
  envelopeProtector: BrowserAuthEnvelopeProtector;
  identityResolver: ExternalIdentityResolver;
  invitationAcceptance: InvitationAcceptanceBoundary;
  oidcClient: StaffBrowserOidcClient;
  oidcVerifier: OidcIdentityVerifier;
  sessions: ApplicationSessionLifecycle;
  clock?: () => Date;
}>;

type ApiOptions = Readonly<{
  logger?: FastifyServerOptions["logger"];
  staffAuth?: StaffAuthDependencies;
}>;

type SessionResolution = Readonly<{
  credential: Readonly<{ csrfSecret: string; expiresAt: Date; sessionToken: string }>;
  session: AuthenticatedApplicationSession;
}>;

const baseCookie = Object.freeze({
  path: "/",
  sameSite: "lax" as const,
  secure: true,
});

const clearSecurityCookies = (reply: FastifyReply): void => {
  for (const name of Object.values(BROWSER_AUTH_COOKIE_NAMES)) {
    reply.clearCookie(name, baseCookie);
  }
};

const countCookie = (header: string, name: string): number =>
  header
    .split(";")
    .map((entry) => entry.trimStart())
    .filter((entry) => entry.startsWith(name + "=")).length;

const rejectDuplicateSecurityCookies = (request: FastifyRequest): void => {
  const header = request.headers.cookie;
  if (header === undefined) return;
  if (Object.values(BROWSER_AUTH_COOKIE_NAMES).some((name) => countCookie(header, name) > 1)) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
};

const setTransactionCookie = (reply: FastifyReply, value: string): void => {
  reply.setCookie(BROWSER_AUTH_COOKIE_NAMES.loginTransaction, value, {
    ...baseCookie,
    httpOnly: true,
    maxAge: BROWSER_AUTH_POLICY.loginTransactionLifetimeMilliseconds / 1_000,
  });
};

const setInvitationProofCookie = (reply: FastifyReply, value: string): void => {
  reply.setCookie(BROWSER_AUTH_COOKIE_NAMES.invitationProof, value, {
    ...baseCookie,
    httpOnly: true,
    maxAge: BROWSER_AUTH_POLICY.invitationProofLifetimeMilliseconds / 1_000,
  });
};

const setApplicationCookies = (
  reply: FastifyReply,
  protector: BrowserAuthEnvelopeProtector,
  issued: Readonly<{
    csrfSecret: string;
    session: AuthenticatedApplicationSession;
    sessionToken: string;
  }>,
  now: Date,
): void => {
  const maximumExpiry = now.getTime() + COOKIE_MAX_AGE_SECONDS * 1_000;
  const expiresAt = new Date(Math.min(issued.session.absoluteExpiresAt.getTime(), maximumExpiry));
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000));
  const sealed = protector.sealSession({
    csrfSecret: issued.csrfSecret,
    expiresAt,
    sessionToken: issued.sessionToken,
  });
  reply.setCookie(BROWSER_AUTH_COOKIE_NAMES.session, sealed, {
    ...baseCookie,
    expires: expiresAt,
    httpOnly: true,
    maxAge,
  });
  reply.setCookie(BROWSER_AUTH_COOKIE_NAMES.csrf, issued.csrfSecret, {
    ...baseCookie,
    expires: expiresAt,
    httpOnly: false,
    maxAge,
  });
};

const requireObjectBody = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrowserAuthenticationTokenInvalidError();
  }
  return value as Readonly<Record<string, unknown>>;
};

const requireInvitationToken = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_INVITATION_TOKEN_LENGTH) {
    throw new InvitationTokenInvalidError();
  }
  return value;
};

const invitationTokenDigest = (token: string): string => {
  const digest = hashInvitationToken(token);
  if (digest === undefined) throw new InvitationTokenInvalidError();
  return Buffer.from(digest).toString("base64url");
};

const equalDigest = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return leftBytes.length === rightBytes.length && leftBytes.equals(rightBytes);
};

const createUuidV7 = (now: Date): string => {
  const bytes = randomBytes(16);
  const milliseconds = BigInt(now.getTime());
  for (let index = 0; index < 6; index += 1) {
    bytes[5 - index] = Number((milliseconds >> BigInt(index * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
};

const createAuditContext = (
  request: FastifyRequest,
  now: Date,
): MembershipLifecycleAuditContext => {
  const candidateRequestId = "request:" + request.id;
  if (!isSchemaValue(RequestIdSchema, candidateRequestId)) {
    throw new TypeError("Fastify request identifier is invalid");
  }
  const correlation = createUuidV7(now);
  if (!isSchemaValue(CorrelationIdSchema, correlation)) {
    throw new TypeError("Correlation identifier generation failed");
  }
  return Object.freeze({
    correlationId: correlation,
    requestId: candidateRequestId,
  });
};

const safeProblem = (request: FastifyRequest, error: unknown) => {
  let code = "internal_error";
  let status = 500;
  if (
    error instanceof SessionAuthenticationRequiredError ||
    error instanceof ExternalIdentityDeniedError ||
    error instanceof ExternalIdentityUnmappedError
  ) {
    code = "authentication_required";
    status = 401;
  } else if (
    error instanceof BrowserAuthenticationTokenInvalidError ||
    error instanceof OidcCredentialInvalidError ||
    error instanceof InvitationTokenInvalidError
  ) {
    code = "token_invalid";
    status = 401;
  } else if (error instanceof BrowserOriginNotAllowedError) {
    code = "origin_not_allowed";
    status = 403;
  } else if (error instanceof BrowserCsrfInvalidError) {
    code = "csrf_invalid";
    status = 403;
  } else if (
    error instanceof AuthorizationDeniedError ||
    error instanceof MembershipLifecyclePermissionDeniedError
  ) {
    code = "permission_denied";
    status = 403;
  } else if (error instanceof MembershipLifecycleNotFoundError) {
    code = "resource_not_found";
    status = 404;
  } else if (error instanceof MembershipLifecycleConflictError) {
    code = "version_conflict";
    status = 409;
  } else if (error instanceof OidcProviderUnavailableError) {
    code = "dependency_unavailable";
    status = 503;
  }
  const requestId = "request:" + request.id;
  return {
    body: {
      code,
      detail:
        status >= 500 ? "Authentication service is temporarily unavailable" : "Request denied",
      instance: request.url.split("?", 1)[0],
      request_id: requestId,
      status,
      title: status >= 500 ? "Service unavailable" : "Request denied",
      type: "https://lead-agent.invalid/problems/" + code,
    },
    status,
  };
};

const requireMutationBrowserProof = (request: FastifyRequest, config: StaffWebAuthConfig): void => {
  requireTrustedStaffOrigin(request.headers.origin, config.staffAllowedOrigins);
  requireAcceptableFetchMetadata(request.headers["sec-fetch-site"]);
};

const registerStaffAuth = async (
  api: FastifyInstance,
  dependencies: StaffAuthDependencies,
): Promise<void> => {
  await api.register(cookie);
  const clock = dependencies.clock ?? (() => new Date());
  const usedStates = new Map<string, number>();

  const removeExpiredStates = (now: Date): void => {
    for (const [state, expiresAt] of usedStates) {
      if (expiresAt <= now.getTime()) usedStates.delete(state);
    }
  };

  const consumeState = (state: string, now: Date): void => {
    removeExpiredStates(now);
    if (usedStates.has(state)) throw new BrowserAuthenticationTokenInvalidError();
    usedStates.set(state, now.getTime() + BROWSER_AUTH_POLICY.loginTransactionLifetimeMilliseconds);
  };

  const resolveSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    rotateWhenDue = true,
  ): Promise<SessionResolution> => {
    rejectDuplicateSecurityCookies(request);
    const now = clock();
    const sealed = request.cookies[BROWSER_AUTH_COOKIE_NAMES.session];
    if (sealed === undefined) throw new SessionAuthenticationRequiredError();
    const credential = dependencies.envelopeProtector.openSession(sealed, now);
    const session = await dependencies.sessions.resolveSession(credential.sessionToken);
    if (rotateWhenDue && session.rotationDue) {
      const issued = await dependencies.sessions.rotateSession(credential.sessionToken);
      setApplicationCookies(reply, dependencies.envelopeProtector, issued, now);
      return Object.freeze({
        credential: Object.freeze({
          csrfSecret: issued.csrfSecret,
          expiresAt: issued.session.absoluteExpiresAt,
          sessionToken: issued.sessionToken,
        }),
        session: issued.session,
      });
    }
    return Object.freeze({ credential, session });
  };

  const requireMutationSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    rotateWhenDue = true,
  ): Promise<SessionResolution> => {
    requireMutationBrowserProof(request, dependencies.config);
    const resolved = await resolveSession(request, reply, false);
    requireSessionBoundCsrf(
      request.headers[CSRF_HEADER],
      request.cookies[BROWSER_AUTH_COOKIE_NAMES.csrf],
      resolved.credential.csrfSecret,
    );
    if (!rotateWhenDue || !resolved.session.rotationDue) return resolved;
    const issued = await dependencies.sessions.rotateSession(resolved.credential.sessionToken);
    setApplicationCookies(reply, dependencies.envelopeProtector, issued, clock());
    return Object.freeze({
      credential: Object.freeze({
        csrfSecret: issued.csrfSecret,
        expiresAt: issued.session.absoluteExpiresAt,
        sessionToken: issued.sessionToken,
      }),
      session: issued.session,
    });
  };

  api.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/staff/")) return;
    const origin = request.headers.origin;
    if (origin !== undefined) {
      const trusted = requireTrustedStaffOrigin(origin, dependencies.config.staffAllowedOrigins);
      reply.header("access-control-allow-origin", trusted);
      reply.header("access-control-allow-credentials", "true");
      reply.header("vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      if (origin === undefined) throw new BrowserOriginNotAllowedError();
      reply.header("access-control-allow-methods", "GET, HEAD, POST");
      reply.header("access-control-allow-headers", "Content-Type, X-CSRF-Token");
      await reply.code(204).send();
    }
  });

  api.setErrorHandler((error, request, reply) => {
    if (request.url.startsWith(STAFF_AUTH_PREFIX + "/callback")) {
      reply.clearCookie(BROWSER_AUTH_COOKIE_NAMES.loginTransaction, baseCookie);
    }
    const problem = safeProblem(request, error);
    void reply.code(problem.status).send(problem.body);
  });

  const begin = async (
    purpose: "invitation" | "login" | "step_up",
    returnPath: string,
    reply: FastifyReply,
    binding: Readonly<{
      expectedSessionId?: string;
      expectedUserId?: AuthenticatedApplicationSession["userId"];
      invitationOrganizationId?: OrganizationId;
      invitationTokenHash?: string;
    }> = {},
  ): Promise<void> => {
    const now = clock();
    const authorization = await dependencies.oidcClient.begin(purpose);
    const transaction = dependencies.envelopeProtector.sealTransaction({
      ...binding,
      codeVerifier: authorization.codeVerifier,
      expiresAt: new Date(now.getTime() + BROWSER_AUTH_POLICY.loginTransactionLifetimeMilliseconds),
      issuedAt: now,
      maximumAgeSeconds:
        purpose === "step_up"
          ? BROWSER_AUTH_POLICY.stepUpMaximumAgeSeconds
          : BROWSER_AUTH_POLICY.normalLoginMaximumAgeSeconds,
      nonce: authorization.nonce,
      purpose,
      returnPath,
      state: authorization.state,
    });
    setTransactionCookie(reply, transaction);
    await reply.redirect(authorization.authorizationUrl, 302);
  };

  api.get(STAFF_AUTH_PREFIX + "/login", async (request, reply) => {
    rejectDuplicateSecurityCookies(request);
    const query = request.query as Readonly<Record<string, unknown>>;
    await begin("login", resolveSafeReturnPath(query["return_to"], "/"), reply);
  });

  api.post(STAFF_AUTH_PREFIX + "/invitation", async (request, reply) => {
    rejectDuplicateSecurityCookies(request);
    requireMutationBrowserProof(request, dependencies.config);
    const body = requireObjectBody(request.body);
    const token = requireInvitationToken(body["invitation_token"]);
    const organizationId = body["organization_id"];
    if (!isSchemaValue(OrganizationIdSchema, organizationId)) {
      throw new InvitationTokenInvalidError();
    }
    await begin("invitation", resolveSafeReturnPath(body["return_to"], "/"), reply, {
      invitationOrganizationId: organizationId,
      invitationTokenHash: invitationTokenDigest(token),
    });
  });

  api.post(STAFF_AUTH_PREFIX + "/step-up", async (request, reply) => {
    const resolved = await requireMutationSession(request, reply);
    const body = requireObjectBody(request.body);
    await begin("step_up", resolveSafeReturnPath(body["return_to"], "/"), reply, {
      expectedSessionId: resolved.session.sessionId,
      expectedUserId: resolved.session.userId,
    });
  });

  api.get(STAFF_AUTH_PREFIX + "/callback", async (request, reply) => {
    rejectDuplicateSecurityCookies(request);
    const now = clock();
    const sealed = request.cookies[BROWSER_AUTH_COOKIE_NAMES.loginTransaction];
    reply.clearCookie(BROWSER_AUTH_COOKIE_NAMES.loginTransaction, baseCookie);
    if (sealed === undefined) throw new BrowserAuthenticationTokenInvalidError();
    const transaction = dependencies.envelopeProtector.openTransaction(sealed, now);
    const query = request.query as Readonly<Record<string, unknown>>;
    if (query["state"] !== transaction.state || typeof query["code"] !== "string") {
      throw new BrowserAuthenticationTokenInvalidError();
    }
    consumeState(transaction.state, now);
    const callback = new URL(dependencies.config.callbackUri);
    callback.search = new URL(request.url, dependencies.config.callbackUri).search;
    const oidc = await dependencies.oidcClient.complete({
      callbackUrl: callback,
      codeVerifier: transaction.codeVerifier,
      expectedNonce: transaction.nonce,
      expectedState: transaction.state,
      maximumAgeSeconds: transaction.maximumAgeSeconds,
    });
    if (dependencies.config.requireMfa && oidc.authenticationLevel !== "mfa") {
      throw new OidcCredentialInvalidError();
    }
    const verifiedIdentity = await dependencies.oidcVerifier.verify({
      expectedNonce: transaction.nonce,
      idToken: oidc.idToken,
    });

    if (transaction.purpose === "invitation") {
      if (
        oidc.verifiedEmailTarget === null ||
        transaction.invitationOrganizationId === undefined ||
        transaction.invitationTokenHash === undefined
      ) {
        throw new InvitationTokenInvalidError();
      }
      const proof = dependencies.envelopeProtector.sealInvitationProof({
        authenticationLevel: oidc.authenticationLevel,
        authenticationTime: oidc.authenticationTime,
        expiresAt: new Date(
          now.getTime() + BROWSER_AUTH_POLICY.invitationProofLifetimeMilliseconds,
        ),
        identity: verifiedIdentity,
        invitationOrganizationId: transaction.invitationOrganizationId,
        invitationTokenHash: transaction.invitationTokenHash,
        issuedAt: now,
        verifiedEmailTarget: canonicalizeInvitationEmailTarget(oidc.verifiedEmailTarget),
      });
      setInvitationProofCookie(reply, proof);
      await reply.redirect(transaction.returnPath, 303);
      return;
    }

    const authentication = await authenticateValidatedExternalIdentity(
      verifiedIdentity,
      dependencies.identityResolver,
    );
    const evidence = createSessionAuthenticationEvidence(authentication, oidc);

    if (transaction.purpose === "step_up") {
      const current = await resolveSession(request, reply, false);
      if (
        current.session.sessionId !== transaction.expectedSessionId ||
        current.session.userId !== transaction.expectedUserId ||
        authentication.userId !== transaction.expectedUserId ||
        !isFreshStepUp(evidence, now)
      ) {
        throw new AuthorizationDeniedError();
      }
      const rotated = await dependencies.sessions.rotateSession(
        current.credential.sessionToken,
        evidence,
      );
      setApplicationCookies(reply, dependencies.envelopeProtector, rotated, now);
    } else {
      const previous = request.cookies[BROWSER_AUTH_COOKIE_NAMES.session];
      if (previous !== undefined) {
        try {
          const credential = dependencies.envelopeProtector.openSession(previous, now);
          await dependencies.sessions.revokeSession(credential.sessionToken);
        } catch {
          // Invalid prior browser material is replaced, never trusted or revived.
        }
      }
      const issued = await dependencies.sessions.createSession(evidence);
      setApplicationCookies(reply, dependencies.envelopeProtector, issued, now);
    }
    await reply.redirect(transaction.returnPath, 303);
  });

  api.get(STAFF_AUTH_PREFIX + "/session", async (request, reply) => {
    const { session } = await resolveSession(request, reply);
    return {
      absolute_expires_at: session.absoluteExpiresAt.toISOString(),
      assurance: session.authenticationLevel,
      assurance_fresh: isFreshStepUp(session, clock()),
      authenticated: true,
      idle_expires_at: session.idleExpiresAt.toISOString(),
      session_id: session.sessionId,
      user_id: session.userId,
    };
  });

  api.post(STAFF_AUTH_PREFIX + "/logout", async (request, reply) => {
    const { credential } = await requireMutationSession(request, reply, false);
    try {
      await dependencies.sessions.revokeSession(credential.sessionToken);
      clearSecurityCookies(reply);
      await reply.code(204).send();
    } catch (error) {
      clearSecurityCookies(reply);
      throw error;
    }
  });

  api.post(STAFF_AUTH_PREFIX + "/organization", async (request, reply) => {
    const resolved = await requireMutationSession(request, reply, false);
    const body = requireObjectBody(request.body);
    const organizationId = body["organization_id"];
    if (!isSchemaValue(OrganizationIdSchema, organizationId)) {
      throw new AuthorizationDeniedError();
    }
    const context = await resolveAuthorizationContext(
      resolved.session,
      organizationId,
      dependencies.authorizationResolver,
    );
    const issued = await dependencies.sessions.rotateSession(resolved.credential.sessionToken);
    setApplicationCookies(reply, dependencies.envelopeProtector, issued, clock());
    return {
      location_scope: context.locationScope,
      organization_id: context.organizationId,
      role: context.role,
    };
  });

  api.post(STAFF_AUTH_PREFIX + "/invitation/accept", async (request, reply) => {
    rejectDuplicateSecurityCookies(request);
    requireMutationBrowserProof(request, dependencies.config);
    const now = clock();
    const body = requireObjectBody(request.body);
    const token = requireInvitationToken(body["invitation_token"]);
    const sealedProof = request.cookies[BROWSER_AUTH_COOKIE_NAMES.invitationProof];
    reply.clearCookie(BROWSER_AUTH_COOKIE_NAMES.invitationProof, baseCookie);
    if (sealedProof === undefined) throw new InvitationTokenInvalidError();
    const proof = dependencies.envelopeProtector.openInvitationProof(sealedProof, now);
    if (!equalDigest(invitationTokenDigest(token), proof.invitationTokenHash)) {
      throw new InvitationTokenInvalidError();
    }
    if (dependencies.config.requireMfa && proof.authenticationLevel !== "mfa") {
      throw new InvitationTokenInvalidError();
    }
    let accepted: InvitationAcceptanceResult;
    try {
      accepted = await dependencies.invitationAcceptance.accept({
        audit: createAuditContext(request, now),
        identity: proof.identity,
        organizationId: proof.invitationOrganizationId,
        token,
        verifiedEmailTarget: proof.verifiedEmailTarget,
      });
    } catch (error) {
      if (
        error instanceof InvitationTokenInvalidError ||
        error instanceof MembershipLifecycleConflictError ||
        error instanceof MembershipLifecycleNotFoundError ||
        error instanceof MembershipLifecyclePermissionDeniedError
      ) {
        throw new InvitationTokenInvalidError();
      }
      throw error;
    }
    const authentication = await authenticateValidatedExternalIdentity(
      proof.identity,
      dependencies.identityResolver,
    );
    if (authentication.userId !== accepted.userId) throw new InvitationTokenInvalidError();
    const evidence = createSessionAuthenticationEvidence(authentication, proof);
    const issued = await dependencies.sessions.createSession(evidence);
    setApplicationCookies(reply, dependencies.envelopeProtector, issued, now);
    return { membership_id: accepted.membershipId, outcome: accepted.outcome };
  });
};

export const createApi = (options: ApiOptions = {}): FastifyInstance => {
  const api = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger: options.logger ?? false,
  });
  if (options.logger !== undefined && options.logger !== false) {
    api.addHook("onRequest", (request, _reply, done) => {
      request.log.info(
        { method: request.method, path: request.url.split("?", 1)[0], requestId: request.id },
        "request received",
      );
      done();
    });
  }
  api.get("/health", () => ({ service: "api", status: "ok" }));
  if (options.staffAuth !== undefined) {
    void api.register(registerStaffAuth, options.staffAuth);
  }
  return api;
};
