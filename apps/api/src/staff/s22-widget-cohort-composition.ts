import { createS22WidgetCohortUseCases } from "@lead-agent/application";
import { S22_BOOKING_COHORT } from "@lead-agent/config";
import { createS22WidgetCohortStore, type TenantDatabaseRuntime } from "@lead-agent/database";

import type { StaffS22WidgetCohortDependencies } from "./s22-widget-cohort-plugin.js";

/** Caller enables this dependency only for the reviewed S22 staging runtime. */
export const createStaffS22WidgetCohortDependencies = (
  runtime: TenantDatabaseRuntime,
): StaffS22WidgetCohortDependencies => ({
  useCases: createS22WidgetCohortUseCases({
    organizationId: S22_BOOKING_COHORT.organizationId,
    store: createS22WidgetCohortStore(runtime),
  }),
});
