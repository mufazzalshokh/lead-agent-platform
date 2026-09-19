import {
  StaffAnalyticsQuerySchema,
  StaffAnalyticsSchema,
  isSchemaValue,
  type StaffAnalytics,
  type StaffAnalyticsQuery,
  type OrganizationId,
} from "@lead-agent/contracts";
import {
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
} from "@lead-agent/security";

export class AnalyticsApplicationError extends Error {
  constructor(public readonly code: "permission_denied" | "validation_failed") {
    super(code);
    this.name = "AnalyticsApplicationError";
  }
}

export interface TenantAnalyticsStore {
  read(
    input: Readonly<{ authorization: AuthorizationContext; query: StaffAnalyticsQuery }>,
  ): Promise<StaffAnalytics>;
}

export type TenantAnalytics = Readonly<{
  read(authorization: AuthorizationContext, query: StaffAnalyticsQuery): Promise<StaffAnalytics>;
}>;

const MAXIMUM_RANGE_MILLISECONDS = 366 * 24 * 60 * 60 * 1_000;

export const createTenantAnalytics = (store: TenantAnalyticsStore): TenantAnalytics =>
  Object.freeze({
    read: async (authorization, query) => {
      if (
        !isAuthorizationContext(authorization) ||
        !hasPermission(authorization.role, "analytics.read") ||
        authorization.locationScope !== "all"
      )
        throw new AnalyticsApplicationError("permission_denied");
      if (!isSchemaValue(StaffAnalyticsQuerySchema, query))
        throw new AnalyticsApplicationError("validation_failed");
      const from = Date.parse(query.from),
        to = Date.parse(query.to);
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from >= to ||
        to - from > MAXIMUM_RANGE_MILLISECONDS
      )
        throw new AnalyticsApplicationError("validation_failed");
      const report = await store.read({ authorization, query });
      if (!isSchemaValue(StaffAnalyticsSchema, report))
        throw new TypeError("Invalid tenant analytics projection");
      return report;
    },
  });

export type InternalTenantEconomics = Readonly<{
  attributableInfrastructureCostMicros: bigint | null;
  contributionMarginBasisPoints: number | null;
  contributionMicros: bigint | null;
  costPerAppointmentRequestMicros: bigint | null;
  costPerConfirmedAppointmentMicros: bigint | null;
  costPerConversationMicros: bigint | null;
  costPerLeadMicros: bigint | null;
  knownProviderCostMicros: bigint;
  providerCostComplete: boolean;
  projectedCostPerThousandConversationsMicros: bigint | null;
  subscriptionRevenueMicros: bigint | null;
  unknownCostRunCount: number;
}>;

export type InternalProviderOperations = Readonly<{
  calls: number;
  failures: number;
  inputTokens: bigint | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  model: string;
  outputTokens: bigint | null;
  provider: string;
  repairsOrRetries: number;
  successes: number;
}>;

export type InternalOperationalAnalytics = Readonly<{
  outbound: Readonly<{
    instagramFailures: number;
    instagramSubmissions: number;
    telegramFailures: number;
    telegramSubmissions: number;
  }>;
  providers: readonly InternalProviderOperations[];
  queue: Readonly<{
    deadLettered: number;
    oldestReadyLagMs: number | null;
    pending: number;
    processing: number;
    retried: number;
  }>;
}>;

export interface InternalTenantEconomicsStore {
  readInternalEconomics(
    input: Readonly<{ organizationId: OrganizationId; from: Date; to: Date }>,
  ): Promise<InternalTenantEconomics>;
  readInternalOperations(
    input: Readonly<{
      organizationId: OrganizationId;
      from: Date;
      now: Date;
      to: Date;
    }>,
  ): Promise<InternalOperationalAnalytics>;
}
