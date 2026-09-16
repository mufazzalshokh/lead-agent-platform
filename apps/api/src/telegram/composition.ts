import {
  createTelegramBusinessUseCases,
  type TelegramNormalizedUpdate,
} from "@lead-agent/application";
import type { CustomerDataProtectionConfig, TelegramPlatformConfig } from "@lead-agent/config";
import {
  createCanonicalInboundPersistenceStore,
  createTelegramPersistenceStore,
  type InboundRouteDatabaseRuntime,
  type TenantDatabaseRuntime,
} from "@lead-agent/database";
import {
  createTelegramPlatformClient,
  createTelegramPlatformProvisioner,
  normalizeTelegramUpdate,
} from "@lead-agent/integrations";
import { createCustomerDataProtection } from "@lead-agent/security";

import type { StaffTelegramDependencies, TelegramWebhookDependencies } from "./plugin.js";

export type TelegramApiComposition = Readonly<{
  staff: StaffTelegramDependencies;
  webhook: TelegramWebhookDependencies;
}>;

export const createTelegramApiComposition = (
  tenantRuntime: TenantDatabaseRuntime,
  ingressRuntime: InboundRouteDatabaseRuntime,
  customerDataConfig: CustomerDataProtectionConfig,
  telegramConfig: TelegramPlatformConfig,
): TelegramApiComposition => {
  const client = createTelegramPlatformClient(telegramConfig);
  const useCases = createTelegramBusinessUseCases({
    botUsername: telegramConfig.botUsername,
    callbackAcknowledger: client,
    canonicalStore: createCanonicalInboundPersistenceStore(tenantRuntime),
    dataProtector: createCustomerDataProtection(customerDataConfig),
    onCallbackAcknowledgementFailure: () => {
      console.error("Telegram callback acknowledgement failed");
    },
    persistence: createTelegramPersistenceStore(tenantRuntime),
    platformProvisioner: createTelegramPlatformProvisioner(client, telegramConfig),
    routeResolver: ingressRuntime,
  });
  return Object.freeze({
    staff: Object.freeze({ useCases }),
    webhook: Object.freeze({
      normalizeUpdate: async (raw: unknown): Promise<TelegramNormalizedUpdate> => {
        const update = normalizeTelegramUpdate(raw);
        if (update.kind !== "business_connection") return update;
        const verified = await client.getBusinessConnection(update.businessConnectionId);
        if (
          verified.id !== update.businessConnectionId ||
          verified.ownerUserId !== update.ownerUserId ||
          verified.isEnabled !== update.isEnabled ||
          verified.canReply !== update.canReply
        ) {
          return Object.freeze({ kind: "ignored", updateId: update.updateId });
        }
        return update;
      },
      processUpdate: useCases.processUpdate,
      webhookSecret: telegramConfig.webhookSecret,
    }),
  });
};
