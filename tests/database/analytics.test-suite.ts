import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  MembershipIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  StaffAnalyticsQuerySchema,
  UserIdSchema,
  isSchemaValue,
  type OrganizationId,
  type StaffAnalyticsQuery,
} from "../../packages/contracts/src/index.js";
import {
  createInternalTenantEconomicsStore,
  createTenantAnalyticsStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
} from "../../packages/security/src/index.js";

type Harness = Readonly<{
  fixtures: Readonly<{
    membershipA: string;
    organizationA: string;
    organizationB: string;
    userA: string;
  }>;
  privilegedPool(): Pool;
  runtime(): TenantDatabaseRuntime;
  seed(): Promise<void>;
}>;

const range = (): StaffAnalyticsQuery => {
  const value: unknown = {
    from: "2025-12-31T00:00:00.000Z",
    group_by: "day",
    to: "2027-01-01T00:00:00.000Z",
  };
  if (!isSchemaValue(StaffAnalyticsQuerySchema, value)) throw new TypeError("Invalid S20 range");
  return value;
};

const authorize = async (harness: Harness): Promise<AuthorizationContext> => {
  const { membershipA, organizationA, userA } = harness.fixtures;
  const sessionId = "0199f1a8-7f65-7c28-a434-a10796c49999";
  if (
    !isSchemaValue(OrganizationIdSchema, organizationA) ||
    !isSchemaValue(UserIdSchema, userA) ||
    !isSchemaValue(MembershipIdSchema, membershipA) ||
    !isSchemaValue(ResourceIdSchema, sessionId)
  )
    throw new TypeError("Invalid S20 authorization fixture");
  const now = new Date("2026-09-19T12:00:00.000Z");
  const session: AuthenticatedApplicationSession = {
    absoluteExpiresAt: new Date("2026-09-20T12:00:00.000Z"),
    authenticationLevel: "mfa",
    authenticationTime: now,
    createdAt: now,
    idleExpiresAt: new Date("2026-09-19T13:00:00.000Z"),
    lastSeenAt: now,
    rotatedAt: now,
    rotationDue: false,
    sessionId,
    userId: userA,
  };
  return resolveAuthorizationContext(session, organizationA, {
    resolveCurrentMembership: () =>
      Promise.resolve({
        allowedLocationIds: [],
        locationScope: "all",
        membershipId: membershipA,
        organizationId: organizationA,
        role: "analyst",
        status: "active",
        userId: userA,
      }),
  });
};

const organizationId = (value: string): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, value))
    throw new TypeError("Invalid S20 tenant fixture");
  return value;
};

export const registerAnalyticsPersistenceTests = (harness: Harness): void => {
  describe("S20 tenant analytics persistence", () => {
    it("uses canonical tenant rows without inflating repeated messages", async () => {
      await harness.seed();
      const report = await createTenantAnalyticsStore(harness.runtime()).read({
        authorization: await authorize(harness),
        query: range(),
      });

      expect(report.funnel).toMatchObject({
        appointment_requests: 1,
        attended: 1,
        awaiting_customer_confirmation: 1,
        confirmed_appointments: 1,
        conversations: 3,
        handoffs: 1,
        inbound_meaningful_messages: 4,
        leads: 1,
        staff_accepted: 1,
        unique_contacts: 1,
      });
      expect(report.channels).toContainEqual({
        appointment_requests: 1,
        channel: "widget",
        confirmed_appointments: 1,
        conversations: 1,
        inbound_meaningful_messages: 2,
        leads: 1,
      });
      expect(report.recorded_attributed_revenue).toEqual({
        amounts: [{ amount_minor: 250_000, currency: "UZS" }],
        available: true,
      });
      expect(report.conversion_basis_points).toEqual({
        appointment_request_to_confirmed: 10_000,
        appointment_request_to_staff_accepted: 10_000,
        confirmed_to_attended: 10_000,
        lead_to_appointment_request: 10_000,
        lead_to_attended: 10_000,
        lead_to_confirmed: 10_000,
        staff_accepted_to_confirmed: 10_000,
      });
      expect(report.usage).toMatchObject({
        automated_messages: 1,
        automation_rate_basis_points: 2_500,
      });
      expect(report.latency.external_message_to_submit_raw).toMatchObject({
        count: 2,
        p50_ms: 4_000,
        p95_ms: 8_000,
      });
      expect(report.latency.platform_meaningful_raw).toMatchObject({
        count: 4,
        within_60_seconds: 4,
      });
      expect(report.range).toMatchObject({
        boundary: "from_inclusive_to_exclusive",
        time_zone: "Asia/Tashkent",
      });
      expect(report.daily.some(({ local_date }) => local_date === "2026-01-01")).toBe(true);
    });

    it("keeps internal costs complete only when every physical attempt is priced", async () => {
      await harness.seed();
      const store = createInternalTenantEconomicsStore(harness.runtime());
      const input = {
        from: new Date("2025-12-31T00:00:00.000Z"),
        organizationId: organizationId(harness.fixtures.organizationA),
        to: new Date("2027-01-01T00:00:00.000Z"),
      };
      await expect(store.readInternalEconomics(input)).resolves.toMatchObject({
        attributableInfrastructureCostMicros: null,
        contributionMicros: null,
        costPerConfirmedAppointmentMicros: 5_000n,
        costPerConversationMicros: 1_667n,
        knownProviderCostMicros: 5_000n,
        projectedCostPerThousandConversationsMicros: 1_666_667n,
        providerCostComplete: true,
        subscriptionRevenueMicros: null,
        unknownCostRunCount: 0,
      });

      await harness
        .privilegedPool()
        .query("update ai_runs set estimated_cost_micros=null where attempt_no=2");
      await expect(store.readInternalEconomics(input)).resolves.toMatchObject({
        costPerConfirmedAppointmentMicros: null,
        knownProviderCostMicros: 2_500n,
        projectedCostPerThousandConversationsMicros: null,
        providerCostComplete: false,
        unknownCostRunCount: 1,
      });
    });

    it("reports provider attempts and current queue health without customer payloads", async () => {
      await harness.seed();
      const operations = await createInternalTenantEconomicsStore(
        harness.runtime(),
      ).readInternalOperations({
        from: new Date("2025-12-31T00:00:00.000Z"),
        now: new Date("2026-09-19T12:00:00.000Z"),
        organizationId: organizationId(harness.fixtures.organizationA),
        to: new Date("2027-01-01T00:00:00.000Z"),
      });
      expect(operations.providers).toEqual([
        expect.objectContaining({ calls: 2, repairsOrRetries: 1, successes: 2 }),
      ]);
      expect(operations.queue).toMatchObject({ deadLettered: 1, pending: 1, retried: 1 });
      expect(JSON.stringify(operations)).not.toMatch(/message|phone|email|ciphertext|payload/iu);
    });
  });
};
