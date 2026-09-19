import { describe, expect, it, vi } from "vitest";

import { createTenantAnalytics } from "../../packages/application/src/index.js";
import {
  MembershipIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type StaffAnalytics,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
} from "../../packages/security/src/index.js";

const org = "0199f1a8-7f65-7c28-a434-a10796c49101";
const user = "0199f1a8-7f65-7c28-a434-a10796c49102";
const member = "0199f1a8-7f65-7c28-a434-a10796c49103";
const sessionId = "0199f1a8-7f65-7c28-a434-a10796c49104";
if (
  !isSchemaValue(OrganizationIdSchema, org) ||
  !isSchemaValue(UserIdSchema, user) ||
  !isSchemaValue(MembershipIdSchema, member) ||
  !isSchemaValue(ResourceIdSchema, sessionId)
)
  throw new TypeError("Invalid S20 authorization fixture");
const utc = (value: string): UtcTimestamp => {
  if (!isSchemaValue(UtcTimestampSchema, value)) throw new TypeError("Invalid S20 timestamp");
  return value;
};
const now = new Date("2026-09-19T10:00:00.000Z");
const session: AuthenticatedApplicationSession = {
  absoluteExpiresAt: new Date(now.getTime() + 86_400_000),
  authenticationLevel: "mfa",
  authenticationTime: now,
  createdAt: now,
  idleExpiresAt: new Date(now.getTime() + 3_600_000),
  lastSeenAt: now,
  rotatedAt: now,
  rotationDue: false,
  sessionId,
  userId: user,
};
const authorization = async (
  role: "analyst" | "staff",
  locationScope: "all" | "restricted" = "all",
) =>
  resolveAuthorizationContext(session, org, {
    resolveCurrentMembership: () =>
      Promise.resolve({
        allowedLocationIds: [],
        locationScope,
        membershipId: member,
        organizationId: org,
        role,
        status: "active",
        userId: user,
      }),
  });
const emptyLatency = {
  count: 0,
  p50_ms: null,
  p75_ms: null,
  p90_ms: null,
  p95_ms: null,
  p99_ms: null,
  max_ms: null,
  within_3_seconds: 0,
  within_5_seconds: 0,
  within_10_seconds: 0,
  within_30_seconds: 0,
  within_60_seconds: 0,
  over_60_seconds: 0,
} as const;
const report: StaffAnalytics = {
  range: {
    from: utc("2026-09-12T10:00:00.000Z"),
    to: utc(now.toISOString()),
    time_zone: "Asia/Tashkent",
    boundary: "from_inclusive_to_exclusive",
  },
  funnel: {
    appointment_requests: 0,
    attended: 0,
    awaiting_customer_confirmation: 0,
    confirmed_appointments: 0,
    conversations: 0,
    handoffs: 0,
    inbound_meaningful_messages: 0,
    leads: 0,
    qualified_leads: 0,
    staff_accepted: 0,
    unique_contacts: 0,
  },
  conversion_basis_points: {
    appointment_request_to_staff_accepted: null,
    appointment_request_to_confirmed: null,
    confirmed_to_attended: null,
    lead_to_appointment_request: null,
    lead_to_attended: null,
    lead_to_confirmed: null,
    staff_accepted_to_confirmed: null,
  },
  channels: [],
  daily: [],
  latency: {
    acknowledgement: emptyLatency,
    external_message_to_submit_normal_availability: emptyLatency,
    external_message_to_submit_raw: emptyLatency,
    platform_meaningful_normal_availability: emptyLatency,
    platform_meaningful_raw: emptyLatency,
    widget_customer_render: emptyLatency,
  },
  usage: { automated_messages: 0, automation_rate_basis_points: null },
  recorded_attributed_revenue: { available: false, amounts: [] },
};

describe("S20 tenant analytics application boundary", () => {
  it("permits analytics readers and preserves the explicit bounded range", async () => {
    const read = vi.fn(() => Promise.resolve(report));
    const analytics = createTenantAnalytics({ read });
    await expect(
      analytics.read(await authorization("analyst"), {
        from: report.range.from,
        to: report.range.to,
        group_by: "day",
      }),
    ).resolves.toEqual(report);
    expect(read).toHaveBeenCalledOnce();
  });

  it("denies staff and invalid/unbounded ranges before persistence", async () => {
    const read = vi.fn(() => Promise.resolve(report));
    const analytics = createTenantAnalytics({ read });
    await expect(
      analytics.read(await authorization("staff"), {
        from: report.range.from,
        to: report.range.to,
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      analytics.read(await authorization("analyst", "restricted"), {
        from: report.range.from,
        to: report.range.to,
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      analytics.read(await authorization("analyst"), {
        from: utc("2020-01-01T00:00:00.000Z"),
        to: report.range.to,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(read).not.toHaveBeenCalled();
  });
});
