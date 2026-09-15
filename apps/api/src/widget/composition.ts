import { createWidgetUseCases } from "@lead-agent/application";
import type { CustomerDataProtectionConfig, WidgetSecurityConfig } from "@lead-agent/config";
import {
  createWidgetPersistenceStore,
  type InboundRouteDatabaseRuntime,
  type TenantDatabaseRuntime,
} from "@lead-agent/database";
import {
  createCustomerDataProtection,
  createWidgetRateLimiter,
  createWidgetTokenService,
} from "@lead-agent/security";

import type { WidgetDependencies } from "./plugin.js";

export const createWidgetDependencies = (
  tenantRuntime: TenantDatabaseRuntime,
  ingressRuntime: InboundRouteDatabaseRuntime,
  customerDataConfig: CustomerDataProtectionConfig,
  widgetSecurityConfig: WidgetSecurityConfig,
): WidgetDependencies => {
  const dataProtector = createCustomerDataProtection(customerDataConfig);
  return Object.freeze({
    useCases: createWidgetUseCases({
      dataProtector,
      persistence: createWidgetPersistenceStore(tenantRuntime),
      rateLimiter: createWidgetRateLimiter(),
      routeResolver: ingressRuntime,
      tokens: createWidgetTokenService(widgetSecurityConfig),
    }),
  });
};
