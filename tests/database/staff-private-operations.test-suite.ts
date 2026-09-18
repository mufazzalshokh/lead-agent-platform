import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createStaffOperationsDependencies } from "../../apps/api/src/staff/composition.js";
import {
  createStaffOperations,
  createStaffQueryCursorCodec,
  type CanonicalInboundReceipt,
} from "../../packages/application/src/index.js";
import {
  createStaffOperationsStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  OrganizationIdSchema,
  MembershipIdSchema,
  UserIdSchema,
  ResourceIdSchema,
  StaffAcceptAppointmentInputSchema,
  StaffAttendanceInputSchema,
  StaffRevenueInputSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type MembershipRole,
} from "../../packages/security/src/index.js";
import { fixtureId } from "../ai/fixtures.js";

type Harness = Readonly<{
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
  seedRequest: (tenant: "a" | "b") => Promise<CanonicalInboundReceipt>;
}>;
export const registerStaffPrivateOperationsTests = (harness: Harness): void => {
  const now = new Date("2026-09-18T09:00:00.000Z"),
    rootKey = new Uint8Array(32).fill(17);
  const operations = () =>
    createStaffOperationsDependencies(harness.runtime(), rootKey, () => now).operations;
  const authorization = async (
    receipt: CanonicalInboundReceipt,
    role: MembershipRole = "staff",
    locationScope: "all" | "restricted" = "all",
  ) => {
    const row = (
      await harness
        .privilegedPool()
        .query(
          `select organization_id,user_id,id from memberships where organization_id=(select organization_id from conversations where id=$1) order by id limit 1`,
          [receipt.conversationId],
        )
    ).rows[0] as Record<string, unknown> | undefined;
    if (
      row === undefined ||
      !isSchemaValue(OrganizationIdSchema, row["organization_id"]) ||
      !isSchemaValue(MembershipIdSchema, row["id"]) ||
      !isSchemaValue(UserIdSchema, row["user_id"])
    )
      throw new Error("Invalid S17 actor fixture");
    const org = row["organization_id"],
      member = row["id"],
      user = row["user_id"];
    await harness
      .privilegedPool()
      .query(`update memberships set role=$2,location_scope=$3 where id=$1`, [
        member,
        role,
        locationScope,
      ]);
    const session: AuthenticatedApplicationSession = {
      userId: user,
      sessionId: fixtureId(27001),
      authenticationLevel: "mfa",
      authenticationTime: now,
      createdAt: now,
      lastSeenAt: now,
      rotatedAt: now,
      rotationDue: false,
      idleExpiresAt: new Date(now.getTime() + 3600000),
      absoluteExpiresAt: new Date(now.getTime() + 86400000),
    };
    return resolveAuthorizationContext(session, org, {
      resolveCurrentMembership: () =>
        Promise.resolve({
          organizationId: org,
          membershipId: member,
          userId: user,
          role,
          status: "active",
          locationScope,
          allowedLocationIds: [],
        }),
    });
  };
  const requested = async (tenant: "a" | "b" = "a") => {
    const receipt = await harness.seedRequest(tenant),
      auth = await authorization(receipt),
      ops = operations();
    const item = (await ops.list(auth, "appointment_request", {})).items[0];
    if (item === undefined) throw new Error("S17 requires an S16 requested fixture");
    return { receipt, auth, ops, item };
  };
  const acceptSlot = { start_at: "2026-09-19T12:00:00.000Z", end_at: "2026-09-19T12:30:00.000Z" };
  const mutation = (f: Awaited<ReturnType<typeof requested>>, key = "s17-accept") =>
    f.ops.mutate(
      f.auth,
      "appointment_request",
      f.item.id,
      f.item.version,
      key,
      { action: "accept", input: checkedSlot() },
      "request:s17",
      "unused",
    );
  const checkedSlot = () => {
    // Obtain branded timestamps through the existing runtime validator, never an unchecked cast.
    const value: unknown = acceptSlot;
    if (!isSchemaValue(StaffAcceptAppointmentInputSchema, value))
      throw new Error("Invalid slot fixture");
    return value;
  };
  const counts = async () => {
    const row = (
      await harness.privilegedPool().query<{
        accepted_events: number;
        audits: number;
        transitions: number;
        keys: number;
      }>(`select
    (select count(*)::int from outbox_events where event_type='appointment_request.staff_accepted') as accepted_events,
    (select count(*)::int from audit_events where action='appointment_request.transition') as audits,
    (select count(*)::int from appointment_request_transitions) as transitions,
    (select count(*)::int from idempotency_keys where scope like 's17:%') as keys`)
    ).rows[0];
    if (row === undefined) throw new Error("Missing S17 count fixture");
    return row;
  };
  describe("S17 real PostgreSQL private operations", () => {
    it("opens S16 no-phone requested work with preferences and existing conversation/contact context", async () => {
      const f = await requested(),
        page = await f.ops.list(f.auth, "conversation", {});
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        conversation_id: f.receipt.conversationId,
        contact_id: f.receipt.contactId,
        lead_id: f.receipt.leadId,
        appointment_status: "requested",
        actionable: true,
      });
      expect(f.item.preferences).toHaveLength(1);
      expect(f.item.preferences[0]).toMatchObject({
        precision: "exact",
        time_zone: "Asia/Tashkent",
      });
      expect(JSON.stringify(page)).not.toMatch(
        /ciphertext|confirmation_token|reasoning|provider_payload/u,
      );
    });
    it("accepts only to staff_accepted with atomic audit/history/existing analytics Outbox and replay", async () => {
      const f = await requested(),
        before = await counts(),
        result = await mutation(f),
        after = await counts();
      expect(result.resource).toMatchObject({
        status: "staff_accepted",
        appointment_status: "staff_accepted",
        version: 2,
      });
      expect(after.accepted_events).toBe(before.accepted_events + 1);
      expect(after.audits).toBe(before.audits + 1);
      expect(after.transitions).toBe(before.transitions + 1);
      expect(await mutation(f)).toEqual(result);
      expect(await counts()).toEqual(after);
      expect((await f.ops.list(f.auth, "appointment_request", {})).items).toHaveLength(0);
      expect(
        (await f.ops.list(f.auth, "appointment_request", { view: "history" })).items,
      ).toHaveLength(1);
      const row = (
        await harness
          .privilegedPool()
          .query<Record<string, unknown>>(
            `select confirmation_token_hash,confirmation_issued_at,confirmed_at from appointment_requests where id=$1`,
            [f.item.id],
          )
      ).rows[0];
      expect(row).toEqual({
        confirmation_token_hash: null,
        confirmation_issued_at: null,
        confirmed_at: null,
      });
      await expect(
        f.ops.mutate(
          f.auth,
          "appointment_request",
          f.item.id,
          1,
          "s17-accept",
          { action: "accept", input: { ...checkedSlot(), end_at: checkedSlot().start_at } },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "idempotency_conflict" });
    });
    it.each(["accept_accept", "accept_reject"])(
      "allows one authoritative concurrent decision: %s",
      async (race) => {
        const f = await requested(),
          before = await counts();
        const other =
          race === "accept_accept"
            ? mutation(f, "second-accept")
            : f.ops.mutate(
                f.auth,
                "appointment_request",
                f.item.id,
                1,
                "s17-reject",
                { action: "reject", input: { reason_code: "unavailable" } },
                "request:s17",
                "unused",
              );
        const results = await Promise.allSettled([mutation(f), other]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const failed = results.find((result) => result.status === "rejected");
        expect(failed).toMatchObject({ status: "rejected", reason: { code: "version_conflict" } });
        expect((await counts()).transitions).toBe(before.transitions + 1);
        expect((await counts()).audits).toBe(before.audits + 1);
      },
    );
    it("denies symmetric cross-tenant IDs", async () => {
      const a = await requested("a"),
        b = await requested("b");
      for (const [actor, target] of [
        [a, b],
        [b, a],
      ] as const) {
        await expect(
          actor.ops.get(actor.auth, "appointment_request", target.item.id),
        ).rejects.toMatchObject({ code: "resource_not_found" });
        await expect(
          actor.ops.mutate(
            actor.auth,
            "appointment_request",
            target.item.id,
            1,
            "s17-attack",
            { action: "accept", input: checkedSlot() },
            "request:s17",
            "unused",
          ),
        ).rejects.toMatchObject({ code: "resource_not_found" });
      }
      expect(
        (await a.ops.list(a.auth, "conversation", {})).items.every(
          (item) => item.conversation_id === a.receipt.conversationId,
        ),
      ).toBe(true);
      expect(
        (await b.ops.list(b.auth, "conversation", {})).items.every(
          (item) => item.conversation_id === b.receipt.conversationId,
        ),
      ).toBe(true);
    });
    it("rechecks suspended membership inside the repository", async () => {
      const f = await requested();
      await harness
        .privilegedPool()
        .query(`update memberships set status='suspended' where id=$1`, [f.auth.membershipId]);
      await expect(f.ops.get(f.auth, "appointment_request", f.item.id)).rejects.toMatchObject({
        code: "permission_denied",
      });
      await expect(mutation(f)).rejects.toMatchObject({ code: "permission_denied" });
      expect((await counts()).keys).toBe(0);
    });
    it("never treats a shared queue read as per-staff acknowledgment", async () => {
      const f = await requested(),
        notification = (await f.ops.list(f.auth, "notification", {})).items[0];
      if (notification === undefined) throw new Error("S16 task missing");
      expect(notification).toMatchObject({
        acknowledgment_supported: false,
        recipient_read_at: null,
        location_id: f.item.location_id,
      });
      await expect(
        f.ops.mutate(
          f.auth,
          "notification",
          notification.id,
          notification.version,
          "s17-acknowledge",
          { action: "acknowledge", input: {} },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "business_rule_failed" });
      expect(
        (
          await harness
            .privilegedPool()
            .query(`select read_at from notifications where id=$1`, [notification.id])
        ).rows[0],
      ).toEqual({ read_at: null });
    });
    it("acknowledges membership-targeted notification only by its recipient", async () => {
      const f = await requested();
      await harness
        .privilegedPool()
        .query(
          `update notifications set audience_type='membership',recipient_membership_id=$1,queue_key=null where organization_id=$2`,
          [f.auth.membershipId, f.auth.organizationId],
        );
      const notification = (await f.ops.list(f.auth, "notification", {})).items[0];
      if (notification === undefined) throw new Error("Task missing");
      const result = await f.ops.mutate(
        f.auth,
        "notification",
        notification.id,
        notification.version,
        "s17-acknowledge",
        { action: "acknowledge", input: {} },
        "request:s17",
        "unused",
      );
      expect(result.resource.recipient_read_at).not.toBeNull();
      expect(result.resource.actionable).toBe(true);
      const other = fixtureId(27002);
      await harness
        .privilegedPool()
        .query(`insert into users (id,status) values ($1,'active');`, [other]);
      const otherMember = fixtureId(27003);
      await harness
        .privilegedPool()
        .query(
          `insert into memberships(id,organization_id,user_id,role,status,location_scope,activated_at) values ($1,$2,$3,'staff','active','all',now())`,
          [otherMember, f.auth.organizationId, other],
        );
      const session: AuthenticatedApplicationSession = {
        userId: requireUser(other),
        sessionId: otherMember,
        authenticationLevel: "mfa",
        authenticationTime: now,
        createdAt: now,
        lastSeenAt: now,
        rotatedAt: now,
        rotationDue: false,
        idleExpiresAt: now,
        absoluteExpiresAt: now,
      };
      const auth = await resolveAuthorizationContext(session, f.auth.organizationId, {
        resolveCurrentMembership: () =>
          Promise.resolve({
            organizationId: f.auth.organizationId,
            membershipId: requireMember(otherMember),
            userId: requireUser(other),
            role: "staff",
            status: "active",
            locationScope: "all",
            allowedLocationIds: [],
          }),
      });
      await expect(f.ops.get(auth, "notification", notification.id)).rejects.toMatchObject({
        code: "resource_not_found",
      });
    });
    it("claims/starts and resolves Handoff with coupled Conversation CAS and explicit disposition", async () => {
      const f = await requested(),
        handoff = fixtureId(27004);
      await harness
        .privilegedPool()
        .query(
          `insert into handoffs(id,organization_id,conversation_id,lead_id,location_id,status,trigger_reason,queue_key,requested_at,sla_due_at,created_at,updated_at) values ($1,$2,$3,$4,$5,'requested','customer_requested','staff',$6,$6::timestamptz+interval '1 hour',$6,$6)`,
          [
            handoff,
            f.auth.organizationId,
            f.receipt.conversationId,
            f.receipt.leadId,
            f.item.location_id,
            now,
          ],
        );
      await harness
        .privilegedPool()
        .query(
          `update conversations set status='awaiting_staff',automation_mode='paused',active_handoff_id=$1 where id=$2`,
          [handoff, f.receipt.conversationId],
        );
      const id = requireResource(handoff),
        item = await f.ops.get(f.auth, "handoff", id);
      if (item.conversation_version === null) throw new Error("Missing version");
      const command = {
        action: "claim" as const,
        input: { conversation_version: item.conversation_version },
      };
      const results = await Promise.allSettled([
        f.ops.mutate(
          f.auth,
          "handoff",
          id,
          item.version,
          "s17-claim-a",
          command,
          "request:s17",
          "unused",
        ),
        f.ops.mutate(
          f.auth,
          "handoff",
          id,
          item.version,
          "s17-claim-b",
          command,
          "request:s17",
          "unused",
        ),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const claimed = await f.ops.get(f.auth, "handoff", id);
      expect(claimed).toMatchObject({
        status: "in_progress",
        assigned_membership_id: f.auth.membershipId,
      });
      if (claimed.conversation_version === null) throw new Error("Missing version");
      const result = await f.ops.mutate(
        f.auth,
        "handoff",
        id,
        claimed.version,
        "s17-resolve",
        {
          action: "resolve",
          input: {
            conversation_version: claimed.conversation_version,
            resolution_code: "handled",
            disposition: "resolve_conversation",
          },
        },
        "request:s17",
        "unused",
      );
      expect(result.resource.status).toBe("resolved");
      expect((await f.ops.list(f.auth, "handoff", {})).items).toHaveLength(0);
      expect(
        (
          await harness
            .privilegedPool()
            .query(`select status,active_handoff_id from conversations where id=$1`, [
              f.receipt.conversationId,
            ])
        ).rows[0],
      ).toEqual({ status: "resolved", active_handoff_id: null });
    });
    it("paginates equal-time queue items without duplication and binds cursors to actor/tenant", async () => {
      const f = await requested(),
        other = await requested("b");
      const notification = (await f.ops.list(f.auth, "notification", {})).items[0];
      if (notification === undefined) throw new Error("Task missing");
      for (const suffix of [27006, 27007]) {
        await harness.privilegedPool().query(
          `insert into notifications select (jsonb_populate_record(null::notifications,
           to_jsonb(n)||jsonb_build_object('id',$2::text,'dedupe_key',$3::text))).*
           from notifications n where n.id=$1`,
          [notification.id, fixtureId(suffix), `s17-pagination-${suffix}`],
        );
      }
      const first = await f.ops.list(f.auth, "notification", { limit: 1 });
      if (first.nextCursor === null) throw new Error("Expected next cursor");
      await expect(
        other.ops.list(other.auth, "notification", { cursor: first.nextCursor }),
      ).rejects.toMatchObject({ code: "validation_failed" });
      const second = await f.ops.list(f.auth, "notification", {
        limit: 1,
        cursor: first.nextCursor,
      });
      if (second.nextCursor === null) throw new Error("Expected second cursor");
      const third = await f.ops.list(f.auth, "notification", {
        limit: 1,
        cursor: second.nextCursor,
      });
      const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids).toEqual([...ids].sort().reverse());
      expect(third.nextCursor).toBeNull();
    });
    it("denies stale location scope and excludes unknown/unassigned locations for restricted staff", async () => {
      const f = await requested();
      const restricted = await authorization(f.receipt, "staff", "restricted");
      await expect(mutation(f)).rejects.toMatchObject({ code: "permission_denied" });
      expect((await f.ops.list(restricted, "appointment_request", {})).items).toHaveLength(0);
      expect((await f.ops.list(restricted, "notification", {})).items).toHaveLength(0);
      await expect(f.ops.get(restricted, "appointment_request", f.item.id)).rejects.toMatchObject({
        code: "resource_not_found",
      });
      await expect(
        f.ops.mutate(
          restricted,
          "appointment_request",
          f.item.id,
          f.item.version,
          "restricted",
          { action: "accept", input: checkedSlot() },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "resource_not_found" });
      expect((await counts()).keys).toBe(0);
    });
    it("rejects appointment decisions after the conversation became terminal", async () => {
      const f = await requested(),
        before = await counts();
      await harness
        .privilegedPool()
        .query(
          `update conversations set status='resolved',automation_mode='paused',active_handoff_id=null,resolved_at=$2,version=version+1,updated_at=$2 where id=$1`,
          [f.receipt.conversationId, now],
        );
      await expect(mutation(f)).rejects.toMatchObject({ code: "business_rule_failed" });
      expect((await f.ops.get(f.auth, "appointment_request", f.item.id)).status).toBe("requested");
      expect(await counts()).toEqual(before);
    });
    it("cannot record attendance or revenue for an unconfirmed appointment", async () => {
      const f = await requested(),
        before = await counts();
      await expect(
        f.ops.mutate(
          f.auth,
          "appointment_request",
          f.item.id,
          f.item.version,
          "attendance",
          { action: "attendance", input: { outcome: "attended" } },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "business_rule_failed" });
      const revenue: unknown = {
        entry_type: "charge",
        amount_minor: 25000000,
        currency: "UZS",
        category_code: "service",
        recognized_at: now.toISOString(),
      };
      if (!isSchemaValue(StaffRevenueInputSchema, revenue))
        throw new Error("Invalid revenue fixture");
      await expect(
        f.ops.mutate(
          f.auth,
          "appointment_request",
          f.item.id,
          f.item.version,
          "s17-revenue",
          { action: "revenue", input: revenue },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "business_rule_failed" });
      expect(await counts()).toEqual(before);
    });
    it("appends audited attendance corrections and exact-money reversals for historical confirmed work", async () => {
      const f = await requested();
      // This privileged historical fixture is not an S17 confirmation operation.
      await harness.privilegedPool().query(
        `update appointment_requests set status='confirmed',version=2,
         staff_decided_by_membership_id=$2,staff_decided_at='2026-09-18T09:00:00Z',
         start_at='2026-09-19T12:00:00Z',end_at='2026-09-19T12:30:00Z',
         offered_time_zone='Asia/Tashkent',offered_local_start='2026-09-19T17:00:00',offer_version=1,
         confirmation_issued_at='2026-09-18T10:00:00Z',offer_expires_at='2026-09-19T11:00:00Z',
         confirmed_at='2026-09-19T09:00:00Z',confirmation_source='customer_session',
         updated_at='2026-09-19T09:00:00Z' where id=$1`,
        [f.item.id, f.auth.membershipId],
      );
      const ops = createStaffOperationsDependencies(
        harness.runtime(),
        rootKey,
        () => new Date("2026-09-20T09:00:00Z"),
      ).operations;
      const recorded = await ops.mutate(
        f.auth,
        "appointment_request",
        f.item.id,
        2,
        "attended",
        { action: "attendance", input: { outcome: "attended" } },
        "request:s17",
        "unused",
      );
      if (recorded.outcome_id === null) throw new Error("Missing attendance identity");
      const correction: unknown = {
        outcome: "did_not_attend",
        supersedes_attendance_id: recorded.outcome_id,
        reason_code: "corrected_record",
      };
      if (!isSchemaValue(StaffAttendanceInputSchema, correction))
        throw new Error("Invalid correction");
      await ops.mutate(
        f.auth,
        "appointment_request",
        f.item.id,
        2,
        "corrected",
        { action: "attendance", input: correction },
        "request:s17",
        "unused",
      );
      await expect(
        ops.mutate(
          f.auth,
          "appointment_request",
          f.item.id,
          2,
          "stale-correction",
          { action: "attendance", input: correction },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "version_conflict" });
      const attendance = (await ops.outcomes(f.auth, f.item.id, "attendance", {})).items;
      expect(attendance).toHaveLength(2);
      expect(attendance.filter((row) => row.is_current)).toHaveLength(1);
      expect(attendance.find((row) => row.is_current)).toMatchObject({
        outcome: "did_not_attend",
        supersedes_id: recorded.outcome_id,
      });
      expect(attendance.find((row) => row.id === recorded.outcome_id)).toMatchObject({
        outcome: "attended",
        is_current: false,
      });
      const charge: unknown = {
        entry_type: "charge",
        amount_minor: 25000000,
        currency: "UZS",
        category_code: "service",
        recognized_at: "2026-09-19T12:30:00.000Z",
      };
      if (!isSchemaValue(StaffRevenueInputSchema, charge)) throw new Error("Invalid charge");
      const charged = await ops.mutate(
        f.auth,
        "appointment_request",
        f.item.id,
        2,
        "s17-charge",
        { action: "revenue", input: charge },
        "request:s17",
        "unused",
      );
      if (charged.outcome_id === null) throw new Error("Missing attribution identity");
      const reversal = {
        entry_type: "reversal" as const,
        reverses_attribution_id: charged.outcome_id,
        reason_code: "refunded",
      };
      const reversed = await ops.mutate(
        f.auth,
        "appointment_request",
        f.item.id,
        2,
        "s17-reverse",
        { action: "revenue", input: reversal },
        "request:s17",
        "unused",
      );
      expect(
        await ops.mutate(
          f.auth,
          "appointment_request",
          f.item.id,
          2,
          "s17-reverse",
          { action: "revenue", input: reversal },
          "request:s17",
          "unused",
        ),
      ).toEqual(reversed);
      await expect(
        ops.mutate(
          f.auth,
          "appointment_request",
          f.item.id,
          2,
          "reverse-again",
          { action: "revenue", input: reversal },
          "request:s17",
          "unused",
        ),
      ).rejects.toMatchObject({ code: "version_conflict" });
      const revenues = (await ops.outcomes(f.auth, f.item.id, "revenue", {})).items;
      expect(revenues).toHaveLength(2);
      expect(revenues.every((row) => row.amount_minor === 25000000 && row.currency === "UZS")).toBe(
        true,
      );
      expect(revenues.find((row) => row.entry_type === "reversal")).toMatchObject({
        supersedes_id: charged.outcome_id,
      });
      expect((await ops.get(f.auth, "appointment_request", f.item.id)).status).toBe("confirmed");
      expect(
        (
          await harness
            .privilegedPool()
            .query<{ event_type: string }>(
              `select event_type from outbox_events where aggregate_id=$1 and event_type like 'appointment.%' order by event_type`,
              [f.item.id],
            )
        ).rows.map((row) => row.event_type),
      ).toEqual([
        "appointment.attendance_corrected",
        "appointment.attendance_recorded",
        "appointment.revenue_attributed",
        "appointment.revenue_reversed",
      ]);
      expect(
        (
          await harness
            .privilegedPool()
            .query(
              `select count(*)::int as count from audit_events where target_id=$1 and action in ('staff.attendance','staff.revenue')`,
              [f.item.id],
            )
        ).rows[0],
      ).toEqual({ count: 4 });
    });
    it("rolls back appointment state/history/audit/idempotency when required Outbox insertion fails", async () => {
      const f = await requested(),
        before = await counts(),
        pool = harness.privilegedPool();
      await pool.query(
        `create function public.s17_reject_outbox_test() returns trigger language plpgsql as $$ begin if new.event_type='appointment_request.staff_accepted' then raise exception 'synthetic_s17_outbox_failure'; end if; return new; end $$`,
      );
      await pool.query(
        `create trigger s17_reject_outbox_test before insert on outbox_events for each row execute function public.s17_reject_outbox_test()`,
      );
      try {
        await expect(mutation(f)).rejects.toThrow();
        expect((await f.ops.get(f.auth, "appointment_request", f.item.id)).status).toBe(
          "requested",
        );
        expect(await counts()).toEqual(before);
      } finally {
        await pool.query(`drop trigger s17_reject_outbox_test on outbox_events`);
        await pool.query(`drop function public.s17_reject_outbox_test()`);
      }
    });
    it("rolls back state/history/Outbox/idempotency if the required audit fails", async () => {
      const f = await requested(),
        before = await counts();
      // Inject a duplicate audit identity using the existing identifier seam, not a production special case.
      const occupied = fixtureId(27005);
      await harness
        .privilegedPool()
        .query(
          `insert into audit_events (organization_id,id,event_type,actor_type,target_type,target_id,action,result,request_id,correlation_id,occurred_at) values ($1,$2,'test.fixture','system','appointment_request',$3,'test.fixture','succeeded','request:s17:fixture',$4,now())`,
          [f.auth.organizationId, occupied, f.item.id, fixtureId(27008)],
        );
      const broken = createStaffOperations(
        createStaffOperationsStore(
          harness.runtime(),
          { protect: (_scope, bytes) => bytes, reveal: (_scope, bytes) => bytes },
          () => occupied,
        ),
        createStaffQueryCursorCodec(rootKey),
        () => now,
      );
      await expect(
        broken.mutate(
          f.auth,
          "appointment_request",
          f.item.id,
          1,
          "s17-failure",
          { action: "accept", input: checkedSlot() },
          "request:s17",
          "unused",
        ),
      ).rejects.toThrow();
      expect((await f.ops.get(f.auth, "appointment_request", f.item.id)).status).toBe("requested");
      expect(await counts()).toEqual(before);
    });
  });
};
const requireResource = (value: string) => {
  if (!isSchemaValue(ResourceIdSchema, value)) throw new Error("Invalid fixture id");
  return value;
};
const requireUser = (value: string) => {
  if (!isSchemaValue(UserIdSchema, value)) throw new Error("Invalid fixture user");
  return value;
};
const requireMember = (value: string) => {
  if (!isSchemaValue(MembershipIdSchema, value)) throw new Error("Invalid fixture member");
  return value;
};
