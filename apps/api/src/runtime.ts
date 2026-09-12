import {
  createAuth0OidcVerifierConfig,
  createIdentityDatabaseRuntimeConfig,
  createTenantDatabaseRuntimeConfig,
  loadStaffWebAuthConfig,
} from "@lead-agent/config";
import {
  createAuthorizationDatabaseRuntime,
  createIdentityDatabaseRuntime,
  createMembershipLifecycleDatabaseRuntime,
  createSessionDatabaseRuntime,
  createTenantDatabaseRuntime,
} from "@lead-agent/database";
import {
  createAuth0BrowserOidcClient,
  createAuth0OidcIdentityVerifier,
} from "@lead-agent/integrations";
import {
  createApplicationSessionLifecycle,
  createBrowserAuthEnvelopeProtector,
  createInvitationEmailTargetProtector,
  createMembershipLifecycle,
} from "@lead-agent/security";
import type { FastifyInstance } from "fastify";

import { createApi, STAFF_AUTH_LOG_REDACTION_PATHS } from "./auth/plugin.js";

const requireEnvironment = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (value === undefined || value.length === 0) throw new TypeError(name + " is required");
  return value;
};

const observeDatabaseFailure = (error: Error): void => {
  void error;
  console.error("Authentication database pool reported an unexpected failure");
};

export const createApiFromEnvironment = (environment: NodeJS.ProcessEnv): FastifyInstance => {
  const web = loadStaffWebAuthConfig(environment);
  const authenticationDatabase = createIdentityDatabaseRuntimeConfig({
    connectionString: requireEnvironment(environment, "AUTH_DATABASE_URL"),
  });
  const tenantDatabase = createTenantDatabaseRuntimeConfig({
    connectionString: requireEnvironment(environment, "DATABASE_URL"),
  });
  const identityRuntime = createIdentityDatabaseRuntime(authenticationDatabase, {
    onUnexpectedPoolError: observeDatabaseFailure,
  });
  const sessionRuntime = createSessionDatabaseRuntime(authenticationDatabase, {
    onUnexpectedPoolError: observeDatabaseFailure,
  });
  const authorizationRuntime = createAuthorizationDatabaseRuntime(authenticationDatabase, {
    onUnexpectedPoolError: observeDatabaseFailure,
  });
  const tenantRuntime = createTenantDatabaseRuntime(tenantDatabase, {
    onUnexpectedPoolError: observeDatabaseFailure,
  });
  const membershipRuntime = createMembershipLifecycleDatabaseRuntime(
    authenticationDatabase,
    tenantRuntime,
    { onUnexpectedPoolError: observeDatabaseFailure },
  );
  const targetProtector = createInvitationEmailTargetProtector({
    encryptionKey: web.invitationTargetEncryptionKey,
    lookupKey: web.invitationTargetLookupKey,
  });
  const oidcVerifier = createAuth0OidcIdentityVerifier(
    createAuth0OidcVerifierConfig({ audience: web.clientId, issuer: web.issuer }),
  );
  const api = createApi({
    logger: {
      level: "info",
      redact: { censor: "[REDACTED]", paths: [...STAFF_AUTH_LOG_REDACTION_PATHS] },
    },
    staffAuth: {
      authorizationResolver: authorizationRuntime,
      config: web,
      envelopeProtector: createBrowserAuthEnvelopeProtector(web.browserEnvelopeKey),
      identityResolver: identityRuntime,
      invitationAcceptance: {
        accept: async (input) => {
          const lifecycle = createMembershipLifecycle(membershipRuntime, targetProtector, {
            resolveVerifiedEmailTarget: (identity) =>
              Promise.resolve(
                identity.issuer === input.identity.issuer &&
                  identity.subject === input.identity.subject
                  ? input.verifiedEmailTarget
                  : null,
              ),
          });
          return lifecycle.acceptInvitation(input);
        },
      },
      oidcClient: createAuth0BrowserOidcClient(web),
      oidcVerifier,
      sessions: createApplicationSessionLifecycle(sessionRuntime),
    },
  });
  api.addHook("onClose", async () => {
    await Promise.all([
      membershipRuntime.close(),
      authorizationRuntime.close(),
      identityRuntime.close(),
      sessionRuntime.close(),
      tenantRuntime.close(),
    ]);
  });
  return api;
};
