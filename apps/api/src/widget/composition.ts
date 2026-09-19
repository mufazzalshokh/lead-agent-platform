import { createWidgetUseCases } from "@lead-agent/application";
import type {
  CustomerDataProtectionConfig,
  WidgetEmbedConfig,
  WidgetSecurityConfig,
} from "@lead-agent/config";
import {
  createWidgetPersistenceStore,
  type InboundRouteDatabaseRuntime,
  type TenantDatabaseRuntime,
} from "@lead-agent/database";
import {
  createCustomerDataProtection,
  createWidgetExchangeGrantService,
  createWidgetRateLimiter,
  createWidgetTokenService,
} from "@lead-agent/security";
import type { OperationalMetrics } from "@lead-agent/observability";

import type { WidgetDependencies } from "./plugin.js";

export const createWidgetDependencies = (
  tenantRuntime: TenantDatabaseRuntime,
  ingressRuntime: InboundRouteDatabaseRuntime,
  customerDataConfig: CustomerDataProtectionConfig,
  widgetSecurityConfig: WidgetSecurityConfig,
  widgetEmbedConfig: WidgetEmbedConfig,
  metrics?: OperationalMetrics,
): WidgetDependencies => {
  const dataProtector = createCustomerDataProtection(customerDataConfig);
  return Object.freeze({
    ...(metrics === undefined ? {} : { metrics }),
    useCases: createWidgetUseCases({
      dataProtector,
      embed: {
        exchanges: createWidgetExchangeGrantService(widgetEmbedConfig),
        platformOrigin: widgetEmbedConfig.platformOrigin,
        publicApiOrigin: widgetEmbedConfig.publicApiOrigin,
      },
      persistence: createWidgetPersistenceStore(tenantRuntime),
      rateLimiter: createWidgetRateLimiter(),
      routeResolver: ingressRuntime,
      ...(metrics === undefined
        ? {}
        : {
            telemetry: {
              observe: (input: Readonly<{ durationMs: number; organizationId: string }>) =>
                metrics.observeWidgetMeaningfulLatency(input.organizationId, input.durationMs),
            },
          }),
      tokens: createWidgetTokenService(widgetSecurityConfig),
    }),
  });
};
