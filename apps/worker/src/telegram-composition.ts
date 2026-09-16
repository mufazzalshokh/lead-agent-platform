import {
  createTenantDatabaseRuntimeConfig,
  loadCustomerDataProtectionConfig,
  loadQueueDatabaseRuntimeConfig,
  loadTelegramPlatformConfig,
  loadInstagramPlatformConfig,
} from "@lead-agent/config";
import {
  createOutboxDispatcherId,
  createOutboxRelayDatabaseRuntime,
  createTelegramOutboundPersistenceStore,
  createInstagramOutboundPersistenceStore,
  createInstagramPersistenceStore,
  createTenantCanonicalOutboxEventSource,
  createTenantDatabaseRuntime,
  type OutboxRelayClaim,
} from "@lead-agent/database";
import {
  createTelegramPlatformClient,
  createInstagramPlatformClient,
} from "@lead-agent/integrations";
import type { CredentialSecretStore } from "@lead-agent/application";
import { createCustomerDataProtection } from "@lead-agent/security";

import {
  createOutboxDispatcher,
  type DispatcherRelayPort,
  type DispatchClaim,
} from "./outbox-dispatcher.js";
import { createQueueInfrastructure } from "./queue-infrastructure.js";
import {
  createProductionHandlerRegistry,
  createTelegramOutboundHandler,
} from "./telegram-outbound.js";
import { createWorkerRuntime, type WorkerRuntime } from "./worker-runtime.js";
import { createStructuredConsoleWorkerTelemetry } from "./worker-telemetry.js";
import { createInstagramOutboundHandler } from "./instagram-outbound.js";

export const composeProductionWorkerRuntime = (
  environment: NodeJS.ProcessEnv = {},
  options: Readonly<{ credentialSecretStore?: CredentialSecretStore }> = {},
): WorkerRuntime => {
  const instagramConfig =
    environment["INSTAGRAM_APP_ID"] === undefined ? null : loadInstagramPlatformConfig(environment);
  const credentials = options.credentialSecretStore;
  if (instagramConfig !== null && credentials === undefined)
    throw new TypeError("Instagram requires a configured writable managed credential secret store");
  const telemetry = createStructuredConsoleWorkerTelemetry({ service: "lead-agent-worker" });
  const queueConfig = loadQueueDatabaseRuntimeConfig(environment);
  const queue = createQueueInfrastructure(queueConfig, { telemetry });
  const tenantRuntime = createTenantDatabaseRuntime(
    createTenantDatabaseRuntimeConfig({ connectionString: environment["DATABASE_URL"] }),
    { onUnexpectedPoolError: () => console.error("Worker tenant database pool failed") },
  );
  const relay = createOutboxRelayDatabaseRuntime(queueConfig, {
    onUnexpectedPoolError: () => console.error("Worker outbox relay database pool failed"),
  });
  const claims = new Map<string, OutboxRelayClaim>();
  const requireClaim = (input: {
    leaseToken: string;
    organizationId: string;
    outboxEventId: string;
  }): OutboxRelayClaim => {
    const claim = claims.get(input.outboxEventId);
    if (
      claim === undefined ||
      claim.organizationId !== input.organizationId ||
      claim.leaseToken !== input.leaseToken
    ) {
      throw new TypeError("Unknown outbox relay claim");
    }
    return claim;
  };
  const relayPort: DispatcherRelayPort = Object.freeze({
    claimBatch: async (input): Promise<readonly DispatchClaim[]> => {
      claims.clear();
      const values = await relay.claimBatch({
        activeRoutes: input.activeRoutes,
        batchSize: input.batchSize,
        dispatcherId: createOutboxDispatcherId(input.dispatcherId),
        leaseSeconds: input.leaseSeconds,
      });
      for (const claim of values) claims.set(claim.outboxEventId, claim);
      return values;
    },
    markDeadLettered: (input) =>
      relay.markDeadLettered({
        ...requireClaim(input),
        errorCategory: input.errorCategory,
      }),
    markPublished: (input) => relay.markPublished(requireClaim(input)),
    releaseForRetry: (input) =>
      relay.releaseForRetry({
        ...requireClaim(input),
        availableAt: input.availableAt,
        errorCategory: input.errorCategory,
      }),
  });
  const telegramClient = createTelegramPlatformClient(loadTelegramPlatformConfig(environment));
  const registry = createProductionHandlerRegistry({
    ...(instagramConfig === null || credentials === undefined
      ? {}
      : {
          instagramOutbound: createInstagramOutboundHandler({
            client: createInstagramPlatformClient(instagramConfig),
            credentials,
            connections: createInstagramPersistenceStore(tenantRuntime),
            dataProtection: createCustomerDataProtection(
              loadCustomerDataProtectionConfig(environment),
            ),
            store: createInstagramOutboundPersistenceStore(tenantRuntime),
            onCredentialCleanupFailure: () => console.error("Instagram credential cleanup failed"),
          }),
        }),
    telegramOutbound: createTelegramOutboundHandler({
      client: telegramClient,
      dataProtection: createCustomerDataProtection(loadCustomerDataProtectionConfig(environment)),
      store: createTelegramOutboundPersistenceStore(tenantRuntime),
    }),
  });
  const tenantEvents = createTenantCanonicalOutboxEventSource(tenantRuntime);
  return createWorkerRuntime({
    closeTenantRuntime: async () => {
      await Promise.all([relay.close(), tenantRuntime.close()]);
    },
    dispatcher: createOutboxDispatcher({
      clock: { now: () => new Date() },
      dispatcherId: "lead-agent-worker-telegram-v1",
      queue,
      relay: relayPort,
      telemetry,
      tenantEvents,
    }),
    observability: {
      onDispatcherError: (error) => {
        console.error("Worker dispatcher iteration failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      },
    },
    queue,
    registry,
    telemetry,
    tenantEvents,
    tenantRuntime,
  });
};
