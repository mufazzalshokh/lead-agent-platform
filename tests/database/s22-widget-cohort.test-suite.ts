import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  S22_BOOKING_COHORT,
  S22_WIDGET_SELECTION_ENVELOPE,
} from "../../packages/config/src/index.js";
import {
  isSchemaValue,
  OrganizationIdSchema,
  UserIdSchema,
  MembershipIdSchema,
  ResourceIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  MessageIdSchema,
} from "../../packages/contracts/src/index.js";
import {
  createAIJourneyBudgetGuard,
  createS22WidgetCohortStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import { executeTenantQuery } from "../../packages/database/src/runtime/tenant.js";
import { resolveAuthorizationContext } from "../../packages/security/src/index.js";
import { fixtureId } from "../ai/fixtures.js";

type Options = Readonly<{ privilegedPool(): Pool; runtime(): TenantDatabaseRuntime }>;
const NOW = new Date("2026-10-08T17:50:00Z");
const CONFIG = {
  ...S22_BOOKING_COHORT,
  mode: "widget_booking" as const,
  widgetSessionId: S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
};
const ORG = S22_BOOKING_COHORT.organizationId;
const CHANNEL = S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId;
const ORIGIN = S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId;
const USER = fixtureId(24001),
  MEMBER = fixtureId(24002),
  CONTACT = fixtureId(24003),
  LEAD = fixtureId(24004);
const WIDGET_CONTACT = fixtureId(24005),
  WIDGET_LEAD = fixtureId(24006),
  WIDGET_CONVERSATION = fixtureId(24007);
const FIRST = fixtureId(24008),
  SECOND = fixtureId(24009),
  WIDGET_MESSAGE = fixtureId(24010),
  WIDGET_RUN = fixtureId(24011);
const OTHER_ORG = fixtureId(24012),
  OTHER_CHANNEL = fixtureId(24013),
  OTHER_ORIGIN = fixtureId(24014),
  OTHER_SESSION = fixtureId(24015),
  OTHER_MEMBER = fixtureId(24016);
const hash = (label: string) => createHash("sha256").update(`synthetic-s22:${label}`).digest();
const later = (milliseconds: number) => new Date(NOW.getTime() + milliseconds);

/** Uses the existing disposable PostgreSQL 17 harness and actual runtime role.
 * These explicitly fictional rows are never deployed/charged/provider evidence.
 * No mock pg transport, new schema, provider call or staging connection is used. */
export const registerS22WidgetCohortTests = (options: Options): void => {
  const seedSession = async (
    id: string,
    org: string = ORG,
    channel: string = CHANNEL,
    origin: string = ORIGIN,
    age = 60_000,
  ) => {
    await options.privilegedPool().query(
      `insert into widget_sessions (id,organization_id,channel_connection_id,widget_allowed_origin_id,
        session_token_jti_hash,participant_lookup_hash,status,requested_locale,version,issued_at,last_seen_at,expires_at)
       values ($1,$2,$3,$4,$5,$6,'active','uz',2,$7,$8,$9)`,
      [
        id,
        org,
        channel,
        origin,
        hash(`token:${id}`),
        hash(`participant:${id}`),
        later(-age),
        later(-age + 1000),
        later(-age + 7_200_000),
      ],
    );
  };
  const conversation = async (id: string, contact: string, lead: string) => {
    const pool = options.privilegedPool();
    await pool.query(
      `insert into contacts (id,organization_id,preferred_locale,status,first_seen_at,last_seen_at)
      values ($1,$2,'uz','active',$3,$3)`,
      [contact, ORG, NOW],
    );
    await pool.query(
      `insert into leads (id,organization_id,contact_id,status,source_channel_connection_id)
      values ($1,$2,$3,'new',$4)`,
      [lead, ORG, contact, CHANNEL],
    );
    await pool.query(
      `insert into conversations (id,organization_id,contact_id,lead_id,channel_connection_id,
      external_thread_hash,status,preferred_locale,automation_mode,started_at,last_activity_at)
      values ($1,$2,$3,$4,$5,$6,'open','uz','ai',$7,$7)`,
      [id, ORG, contact, lead, CHANNEL, hash(`thread:${id}`), NOW],
    );
  };
  const message = async (id: string, convo: string, contact: string, sequence: number) => {
    await options.privilegedPool().query(
      `insert into messages (id,organization_id,conversation_id,channel_connection_id,
      direction,sender_type,sender_contact_id,sequence_no,external_event_id,external_message_id,external_sent_at,
      content_type,body_ciphertext,body_hash,locale,processing_status,delivery_status)
      values ($1,$2,$3,$4,'inbound','customer',$5,$6,$7,$7,$8,'text',$9,$10,'uz','accepted','not_applicable')`,
      [
        id,
        ORG,
        convo,
        CHANNEL,
        contact,
        sequence,
        `synthetic-event:${id}`,
        NOW,
        Buffer.from("synthetic-test-only"),
        hash(`body:${id}`),
      ],
    );
  };
  const run = async (
    id: string,
    convo: string,
    trigger: string,
    cost: number | null,
    started = false,
  ) => {
    await options.privilegedPool().query(
      `insert into ai_runs (id,organization_id,conversation_id,trigger_message_id,
      expected_conversation_version,provider_id,requested_model_id,model_profile_version,provider_resolved_model_id,
      orchestrator_version,prompt_template_version,decision_schema_version,policy_version,status,input_units,output_units,
      cached_input_units,total_units,estimated_cost_micros,cost_currency,cost_catalog_version,latency_ms,attempt_no,
      knowledge_manifest_jsonb,input_hash,output_hash,schema_valid,policy_allowed,started_at,finished_at,correlation_id)
      values ($1,$2,$3,$4,1,'gemini','gemini-3.8-flash','s13-commercial-v1.v1',
       case when $5::boolean then null else 'gemini-3.8-flash' end,'s12-orchestrator.v1','s16-appointment-submission.v1',
       '1','application-policy-v1',case when $5::boolean then 'started' else 'succeeded' end,
       case when $5::boolean then null else 520 end,case when $5::boolean then null else 217 end,
       case when $5::boolean then null else 0 end,case when $5::boolean then null else 737 end,$6,'USD',
       'ai-provider-prices.2026-09-17.v1',case when $5::boolean then null else 1000 end,1,'{}'::jsonb,$7,
       case when $5::boolean then null else $8::bytea end,case when $5::boolean then null else true end,
       case when $5::boolean then null else true end,$9,case when $5::boolean then null else $10::timestamptz end,$11)`,
      [
        id,
        ORG,
        convo,
        trigger,
        started,
        cost,
        hash(`input:${id}`),
        hash(`output:${id}`),
        NOW,
        later(1000),
        id,
      ],
    );
  };
  const audit = async (
    id: string,
    target: string,
    action: string,
    metadata: Readonly<Record<string, unknown>>,
  ) => {
    await options.privilegedPool().query(
      `insert into audit_events (id,organization_id,event_type,actor_type,
      target_type,target_id,action,result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
      values ($1,$2,$3,'system','ai_run',$4,$3,'succeeded',$5,$1,$6::jsonb,$7)`,
      [id, ORG, action, target, `synthetic-audit:${id}`, JSON.stringify(metadata), NOW],
    );
  };
  const seed = async () => {
    const pool = options.privilegedPool();
    for (const [org, slug] of [
      [ORG, "s22-widget-owner-test"],
      [OTHER_ORG, "s22-widget-other-test"],
    ])
      await pool.query(
        `insert into organizations (id,slug,display_name,status,default_locale,default_time_zone)
        values ($1,$2,'S22 synthetic fixture','active','uz','Asia/Tashkent')`,
        [org, slug],
      );
    await pool.query(
      `insert into users (id,email_ciphertext,email_lookup_hash,display_name_ciphertext,status)
      values ($1,$2,$3,$4,'active')`,
      [
        USER,
        Buffer.from("synthetic-owner-email-ciphertext"),
        hash("user"),
        Buffer.from("synthetic-owner-display-ciphertext"),
      ],
    );
    // Origin creation is tenant-membership-bound even for a global user who
    // belongs to both organizations. The current tenant context still cannot
    // read/select the other organization's session.
    for (const [membership, org] of [
      [MEMBER, ORG],
      [OTHER_MEMBER, OTHER_ORG],
    ])
      await pool.query(
        `insert into memberships (id,organization_id,user_id,role,status,location_scope,activated_at)
        values ($1,$2,$3,'owner','active','all',$4)`,
        [membership, org, USER, NOW],
      );
    for (const [org, channel, origin] of [
      [ORG, CHANNEL, ORIGIN],
      [OTHER_ORG, OTHER_CHANNEL, OTHER_ORIGIN],
    ]) {
      await pool.query(
        `insert into channel_connections (id,organization_id,channel_type,status,display_name,configuration_jsonb)
        values ($1,$2,'widget','active','Website Chat','{}'::jsonb)`,
        [channel, org],
      );
      await pool.query(
        `insert into widget_allowed_origins (id,organization_id,channel_connection_id,match_type,scheme,
        normalized_host,status,created_by_user_id) values ($1,$2,$3,'exact','https','s22-synthetic.example','active',$4)`,
        [origin, org, channel, USER],
      );
    }
    await conversation(S22_BOOKING_COHORT.conversationId, CONTACT, LEAD);
    await conversation(WIDGET_CONVERSATION, WIDGET_CONTACT, WIDGET_LEAD);
    const costs = [null, null, 1950, 1792, 2465, 2507];
    for (let index = 0; index < 6; index++) {
      const trigger = fixtureId(24100 + index),
        id = index < 2 ? S22_BOOKING_COHORT.historicalRunIds[index] : fixtureId(24200 + index);
      if (id === undefined) throw new Error("Invalid historical fixture");
      await message(trigger, S22_BOOKING_COHORT.conversationId, CONTACT, index + 1);
      await run(id, S22_BOOKING_COHORT.conversationId, trigger, costs[index] ?? null, index < 2);
      if (index >= 2) {
        await audit(fixtureId(24300 + index), id, "ai_run.journey_started", {
          profile: S22_BOOKING_COHORT.profile,
          dispatch_authorized: false,
        });
        await audit(fixtureId(24400 + index), id, "ai_run.dispatch_reserved", {
          profile: S22_BOOKING_COHORT.profile,
          reservation_micros: "801432",
        });
      }
    }
    await seedSession(
      S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
      ORG,
      CHANNEL,
      ORIGIN,
      5_940_000,
    );
    await seedSession(FIRST);
    await seedSession(SECOND);
    await seedSession(OTHER_SESSION, OTHER_ORG, OTHER_CHANNEL, OTHER_ORIGIN);
  };
  const owner = async () => {
    if (
      !isSchemaValue(OrganizationIdSchema, ORG) ||
      !isSchemaValue(UserIdSchema, USER) ||
      !isSchemaValue(MembershipIdSchema, MEMBER)
    )
      throw new Error("Invalid authorization fixture");
    return resolveAuthorizationContext(
      {
        absoluteExpiresAt: later(3_600_000),
        authenticationLevel: "mfa",
        authenticationTime: NOW,
        createdAt: NOW,
        idleExpiresAt: later(3_600_000),
        lastSeenAt: NOW,
        rotatedAt: NOW,
        rotationDue: false,
        sessionId: fixtureId(24501),
        userId: USER,
      },
      ORG,
      {
        resolveCurrentMembership: () =>
          Promise.resolve({
            organizationId: ORG,
            userId: USER,
            membershipId: MEMBER,
            role: "owner",
            status: "active",
            locationScope: "all",
            allowedLocationIds: [],
          }),
      },
    );
  };
  const command = async (sessionId: string = FIRST, predecessor = 0) => {
    if (!isSchemaValue(ResourceIdSchema, sessionId)) throw new Error("Invalid session fixture");
    return {
      actor: await owner(),
      body: {
        session_id: sessionId,
        expected_session_version: 2 as const,
        expected_selection_version: predecessor,
      },
      requestId: `synthetic-select:${sessionId}`,
      correlationId: fixtureId(24502),
    };
  };
  const bind = async () => {
    await options.privilegedPool().query(
      `update widget_sessions set conversation_id=$1,contact_id=$2,version=3
      where organization_id=$3 and id=$4`,
      [WIDGET_CONVERSATION, WIDGET_CONTACT, ORG, FIRST],
    );
    await message(WIDGET_MESSAGE, WIDGET_CONVERSATION, WIDGET_CONTACT, 1);
    await run(WIDGET_RUN, WIDGET_CONVERSATION, WIDGET_MESSAGE, null, true);
    await audit(fixtureId(24503), WIDGET_RUN, "ai_run.journey_started", {
      profile: S22_BOOKING_COHORT.profile,
      dispatch_authorized: false,
    });
  };

  describe("S22 audited Widget selection — real PostgreSQL 17", () => {
    it("commits exactly one concurrent CAS selection with durable owner attribution", async () => {
      await seed();
      const store = createS22WidgetCohortStore(options.runtime(), CONFIG, () => NOW);
      const outcomes = await Promise.allSettled([
        store.select(await command(FIRST)),
        store.select(await command(SECOND)),
      ]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
      const rows = await options.privilegedPool().query(
        `select actor_type,actor_id::text,actor_membership_id::text,
        target_id::text,metadata_redacted_jsonb->>'selection_version' as selection_version
        from audit_events where organization_id=$1 and action='ai_run.widget_cohort_selected'`,
        [ORG],
      );
      expect(rows.rows).toEqual([
        {
          actor_type: "member",
          actor_id: USER,
          actor_membership_id: MEMBER,
          target_id: S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
          selection_version: "1",
        },
      ]);
    });
    it("idempotent selection leaves session timestamps/version and historical NULLs unchanged", async () => {
      await seed();
      const store = createS22WidgetCohortStore(options.runtime(), CONFIG, () => NOW),
        input = await command();
      const before = await options
        .privilegedPool()
        .query(
          `select issued_at,last_seen_at,expires_at,version from widget_sessions where id=$1`,
          [FIRST],
        );
      const receipt = await store.select(input);
      expect(await store.select(input)).toEqual(receipt);
      expect(
        (
          await options
            .privilegedPool()
            .query(
              `select issued_at,last_seen_at,expires_at,version from widget_sessions where id=$1`,
              [FIRST],
            )
        ).rows,
      ).toEqual(before.rows);
      expect(await store.get({ actor: input.actor })).toMatchObject({
        selection_version: 1,
        selected_session_id: FIRST,
        blocked: false,
        can_select: true,
        known_cost_micros: "8714",
        combined_exposure_micros: "1042110",
        unresolved_reserve_micros: "0",
      });
      const history = await options
        .privilegedPool()
        .query<{ estimated_cost_micros: string | null }>(
          `select estimated_cost_micros from ai_runs where organization_id=$1 and id=any($2::uuid[])`,
          [ORG, S22_BOOKING_COHORT.historicalRunIds],
        );
      expect(history.rows).toHaveLength(2);
      expect(history.rows.every((row) => row.estimated_cost_micros === null)).toBe(true);
    });
    it("RLS hides another tenant's session, and selection rejects a foreign explicit ID", async () => {
      await seed();
      const input = await command(OTHER_SESSION),
        store = createS22WidgetCohortStore(options.runtime(), CONFIG, () => NOW);
      await expect(store.select(input)).rejects.toMatchObject({ code: "selection_conflict" });
      const rows = await options
        .runtime()
        .withTenantTransaction(input.actor.organizationId, (session) =>
          executeTenantQuery(session, (organizationId) => ({
            text: `select id from widget_sessions where organization_id<>$1`,
            values: [organizationId],
          })),
        );
      expect(rows.rows).toEqual([]);
      expect(
        (await store.get({ actor: input.actor })).candidates.map((value) => value.session_id),
      ).not.toContain(OTHER_SESSION);
    });
    it("a bound original anchor blocks first selection even without any Widget reservation", async () => {
      await seed();
      await options.privilegedPool().query(
        `update widget_sessions set conversation_id=$1,contact_id=$2,version=3
        where organization_id=$3 and id=$4`,
        [WIDGET_CONVERSATION, WIDGET_CONTACT, ORG, S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId],
      );
      const store = createS22WidgetCohortStore(options.runtime(), CONFIG, () => NOW),
        input = await command();
      await expect(store.select(input)).rejects.toMatchObject({ code: "cohort_blocked" });
      expect(await store.get({ actor: input.actor })).toMatchObject({
        can_select: false,
        reason: "widget_already_bound",
      });
    });
    it("dispatch and replacement share the mutex; duplicate dispatch retains one slot and unknown costs block", async () => {
      await seed();
      const guard = createAIJourneyBudgetGuard(options.runtime(), CONFIG, () => NOW, {
        ownerSelection: true,
      });
      const concurrentGuard = createAIJourneyBudgetGuard(options.runtime(), CONFIG, () => NOW, {
        ownerSelection: true,
      });
      await guard.widgetCohortStore.select(await command());
      await bind();
      if (
        !isSchemaValue(OrganizationIdSchema, ORG) ||
        !isSchemaValue(ConversationIdSchema, WIDGET_CONVERSATION) ||
        !isSchemaValue(MessageIdSchema, WIDGET_MESSAGE) ||
        !isSchemaValue(CorrelationIdSchema, WIDGET_RUN)
      )
        throw new Error("Invalid dispatch fixture");
      const input = {
        reference: {
          organizationId: ORG,
          conversationId: WIDGET_CONVERSATION,
          messageId: WIDGET_MESSAGE,
          correlationId: WIDGET_RUN,
          causationId: WIDGET_MESSAGE,
        },
        reservation: { runId: WIDGET_RUN, attemptNo: 1 },
      };
      const results = await Promise.allSettled([
        concurrentGuard.authorizeDispatch(input),
        guard.widgetCohortStore.select(await command(SECOND, 1)),
        guard.authorizeDispatch(input),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled" && result.value === true),
      ).toHaveLength(1);
      expect(
        results.some((result) => {
          if (result.status !== "rejected") return false;
          const reason: unknown = result.reason;
          return (
            typeof reason === "object" &&
            reason !== null &&
            "code" in reason &&
            reason.code === "cohort_blocked"
          );
        }),
      ).toBe(true);
      const markers = await options.privilegedPool().query<{ action: string; count: number }>(
        `select action,count(*)::int as count from audit_events
        where organization_id=$1 and (action='ai_run.widget_cohort_selected' or
        (action='ai_run.dispatch_reserved' and target_id=$2)) group by action`,
        [ORG, WIDGET_RUN],
      );
      expect(markers.rows).toHaveLength(2);
      expect(markers.rows.every((row) => row.count === 1)).toBe(true);
      await options.privilegedPool().query(
        `update ai_runs set status='failed',failure_category='provider_unavailable',
        finished_at=$1,latency_ms=1000 where organization_id=$2 and id=$3`,
        [later(1000), ORG, WIDGET_RUN],
      );
      expect(await guard.read((await owner()).organizationId)).toMatchObject({
        blocked: true,
        reason: "cost_unknown",
        unresolvedReserveMicros: "801432",
      });
      await expect(guard.widgetCohortStore.select(await command(SECOND, 1))).rejects.toMatchObject({
        code: "cohort_blocked",
      });
    });
  });
};
