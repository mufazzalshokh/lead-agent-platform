import { createTenantAnalytics } from "@lead-agent/application";
import { createTenantAnalyticsStore, type TenantDatabaseRuntime } from "@lead-agent/database";
import type { OperationalMetrics } from "@lead-agent/observability";

import type { StaffAnalyticsDependencies } from "./plugin.js";

export const createStaffAnalyticsDependencies = (
  runtime: TenantDatabaseRuntime,
  metrics: OperationalMetrics,
): StaffAnalyticsDependencies =>
  Object.freeze({ analytics: createTenantAnalytics(createTenantAnalyticsStore(runtime, metrics)) });
