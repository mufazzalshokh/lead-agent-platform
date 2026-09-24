import {
  createInstagramBusinessUseCases,
  type CredentialSecretStore,
} from "@lead-agent/application";
import type { CustomerDataProtectionConfig, InstagramPlatformConfig } from "@lead-agent/config";
import {
  createCanonicalInboundPersistenceStore,
  createInstagramPersistenceStore,
  createThreadAutomationControlStore,
  type InboundRouteDatabaseRuntime,
  type TenantDatabaseRuntime,
} from "@lead-agent/database";
import { createInstagramPlatformClient } from "@lead-agent/integrations";
import { createCustomerDataProtection } from "@lead-agent/security";
import type { InstagramWebhookDependencies, StaffInstagramDependencies } from "./plugin.js";

export const createInstagramApiComposition = (
  tenantRuntime: TenantDatabaseRuntime,
  ingressRuntime: InboundRouteDatabaseRuntime,
  customerDataConfig: CustomerDataProtectionConfig,
  config: InstagramPlatformConfig,
  credentials: CredentialSecretStore,
): Readonly<{ staff: StaffInstagramDependencies; webhook: InstagramWebhookDependencies }> => {
  const eligibility = createThreadAutomationControlStore(tenantRuntime);
  const useCases = createInstagramBusinessUseCases({
    appId: config.appId,
    oauthRedirectUri: config.oauthRedirectUri,
    canonicalStore: createCanonicalInboundPersistenceStore(tenantRuntime),
    dataProtector: createCustomerDataProtection(customerDataConfig),
    eligibilityStore: eligibility,
    credentials,
    oauth: createInstagramPlatformClient(config),
    persistence: createInstagramPersistenceStore(tenantRuntime),
    routeResolver: ingressRuntime,
    onCredentialCleanupFailure: () => console.error("Instagram credential cleanup failed"),
  });
  return Object.freeze({
    staff: Object.freeze({ useCases }),
    webhook: Object.freeze({
      appSecret: config.appSecret,
      webhookVerifyToken: config.webhookVerifyToken,
      useCases,
    }),
  });
};
