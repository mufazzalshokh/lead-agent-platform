import {
  createAuth0OidcVerifierConfig,
  createIdentityDatabaseRuntimeConfig,
  createTenantDatabaseRuntimeConfig,
  loadCustomerDataProtectionConfig,
  loadStaffWebAuthConfig,
  loadTelegramPlatformConfig,
  loadInstagramPlatformConfig,
  loadWidgetSecurityConfig,
} from "@lead-agent/config";
import {
  createAuthorizationDatabaseRuntime,
  createIdentityDatabaseRuntime,
  createInboundRouteDatabaseRuntime,
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
import { createStaffConfigurationDependencies } from "./configuration/composition.js";
import { createStaffOperationsDependencies } from "./staff/composition.js";
import { createS9ConversationComposition } from "./conversations/composition.js";
import { createWidgetDependencies } from "./widget/composition.js";
import { createTelegramApiComposition } from "./telegram/composition.js";
import { createInstagramApiComposition } from "./instagram/composition.js";
import type { CredentialSecretStore } from "@lead-agent/application";

const requireEnvironment = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (value === undefined || value.length === 0) throw new TypeError(name + " is required");
  return value;
};

const observeDatabaseFailure = (error: Error): void => {
  void error;
  console.error("Authentication database pool reported an unexpected failure");
};

export const createApiFromEnvironment = (
  environment: NodeJS.ProcessEnv,
  options: Readonly<{ credentialSecretStore?: CredentialSecretStore }> = {},
): FastifyInstance => {
  const instagramConfig =
    environment["INSTAGRAM_APP_ID"] === undefined ? null : loadInstagramPlatformConfig(environment);
  const credentials = options.credentialSecretStore;
  if (instagramConfig !== null && credentials === undefined)
    throw new TypeError("Instagram requires a configured writable managed credential secret store");
  const web = loadStaffWebAuthConfig(environment);
  const authenticationDatabase = createIdentityDatabaseRuntimeConfig({
    connectionString: requireEnvironment(environment, "AUTH_DATABASE_URL"),
  });
  const tenantDatabase = createTenantDatabaseRuntimeConfig({
    connectionString: requireEnvironment(environment, "DATABASE_URL"),
  });
  const ingressDatabase = createTenantDatabaseRuntimeConfig({
    connectionString: requireEnvironment(environment, "INGRESS_DATABASE_URL"),
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
  const ingressRuntime = createInboundRouteDatabaseRuntime(ingressDatabase, {
    onUnexpectedPoolError: observeDatabaseFailure,
  });
  const customerDataConfig = loadCustomerDataProtectionConfig(environment);
  const telegram = createTelegramApiComposition(
    tenantRuntime,
    ingressRuntime,
    customerDataConfig,
    loadTelegramPlatformConfig(environment),
  );
  const conversations = createS9ConversationComposition(
    tenantRuntime,
    customerDataConfig,
    web.browserEnvelopeKey,
  );
  const instagram =
    instagramConfig !== null && credentials !== undefined
      ? createInstagramApiComposition(
          tenantRuntime,
          ingressRuntime,
          customerDataConfig,
          instagramConfig,
          credentials,
        )
      : null;
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
    staffConfiguration: createStaffConfigurationDependencies(tenantRuntime, web.browserEnvelopeKey),
    staffOperations: createStaffOperationsDependencies(tenantRuntime, web.browserEnvelopeKey),
    staffConversations: conversations.staff,
    staffTelegram: telegram.staff,
    telegramWebhook: telegram.webhook,
    ...(instagram === null
      ? {}
      : { staffInstagram: instagram.staff, instagramWebhook: instagram.webhook }),
    widget: createWidgetDependencies(
      tenantRuntime,
      ingressRuntime,
      customerDataConfig,
      loadWidgetSecurityConfig(environment),
    ),
  });
  api.addHook("onClose", async () => {
    await Promise.all([
      membershipRuntime.close(),
      authorizationRuntime.close(),
      identityRuntime.close(),
      sessionRuntime.close(),
      tenantRuntime.close(),
      ingressRuntime.close(),
    ]);
  });
  return api;
};
