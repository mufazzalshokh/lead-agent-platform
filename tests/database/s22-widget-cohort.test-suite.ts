import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  S22_BOOKING_COHORT,
  S22_WIDGET_SELECTION_ENVELOPE,
  S22_WIDGET_REPLACEMENT,
  S22_WIDGET_DATE_CONTINUATION,
  createWidgetEmbedConfig,
  createWidgetSecurityConfig,
} from "../../packages/config/src/index.js";
import {
  isSchemaValue,
  OrganizationIdSchema,
  ChannelConnectionIdSchema,
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
  createWidgetPersistenceStore,
  createWidgetRecoveryStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import { executeTenantQuery } from "../../packages/database/src/runtime/tenant.js";
import { createWidgetUseCases } from "../../packages/application/src/index.js";
import {
  resolveAuthorizationContext,
  createCustomerDataProtection,
  createWidgetTokenService,
  createWidgetExchangeGrantService,
  createWidgetRecoveryGrantService,
  createWidgetRateLimiter,
} from "../../packages/security/src/index.js";
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
    attemptNo = 1,
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
       'ai-provider-prices.2026-09-17.v1',case when $5::boolean then null else 1000 end,$12,'{}'::jsonb,$7,
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
        attemptNo,
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

  const seedRetirement = async () => {
    await seed();
    const scope = S22_WIDGET_REPLACEMENT,
      pool = options.privilegedPool();
    await seedSession(scope.retiredSessionId);
    await createS22WidgetCohortStore(options.runtime(), CONFIG, () => NOW).select(
      await command(scope.retiredSessionId),
    );
    await conversation(scope.retiredConversationId, fixtureId(24601), fixtureId(24602));
    await message(scope.retiredMessageId, scope.retiredConversationId, fixtureId(24601), 1);
    await run(scope.retiredRunId, scope.retiredConversationId, scope.retiredMessageId, 2250);
    await audit(fixtureId(24603), scope.retiredRunId, "ai_run.journey_started", {
      profile: S22_BOOKING_COHORT.profile,
    });
    await audit(fixtureId(24604), scope.retiredRunId, "ai_run.dispatch_reserved", {
      profile: S22_BOOKING_COHORT.profile,
      reservation_micros: "801432",
      widget_session_id: scope.retiredSessionId,
      conversation_id: scope.retiredConversationId,
    });
    await pool.query(
      `insert into audit_events (id,organization_id,event_type,actor_type,target_type,target_id,action,
      result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
      values ($1,$2,'ai_run.widget_journey_bound','system','widget_session',$3,'ai_run.widget_journey_bound',
      'succeeded','synthetic-retired-binding',$1,$4::jsonb,$5)`,
      [
        fixtureId(24605),
        ORG,
        scope.retiredSessionId,
        JSON.stringify({
          profile: S22_BOOKING_COHORT.profile,
          widget_session_id: scope.retiredSessionId,
          conversation_id: scope.retiredConversationId,
        }),
        NOW,
      ],
    );
    await pool.query(
      `update widget_sessions set conversation_id=$1,contact_id=$2,version=3,
      issued_at=$3,last_seen_at=$4,expires_at=$5 where id=$6`,
      [
        scope.retiredConversationId,
        fixtureId(24601),
        later(-7_300_000),
        later(-7_299_000),
        later(-100_000),
        scope.retiredSessionId,
      ],
    );
    await pool.query(
      `insert into locations (id,organization_id,code,status) values ($1,$2,'synthetic-replacement','active')`,
      [fixtureId(24606), ORG],
    );
    await pool.query(
      `insert into location_versions (id,organization_id,location_id,version_no,name_i18n,address_i18n,
      public_contact_jsonb,time_zone,published_at,published_by_user_id,content_hash,created_at)
      values ($1,$2,$3,1,'{"en":"Synthetic"}','{"en":"Test"}','{}','Asia/Tashkent',$4,$5,$6,$4)`,
      [fixtureId(24607), ORG, fixtureId(24606), NOW, USER, hash("location")],
    );
    await pool.query(
      `insert into services (id,organization_id,code,status) values ($1,$2,'synthetic-replacement','active')`,
      [fixtureId(24608), ORG],
    );
    await pool.query(
      `insert into service_versions (id,organization_id,service_id,version_no,name_i18n,description_i18n,
      duration_guidance_minutes,disclaimer_i18n,content_hash,published_at,published_by_user_id,created_at)
      values ($1,$2,$3,1,'{"en":"Synthetic"}','{"en":"Test"}',30,'{"en":"Test only"}',$4,$5,$6,$5)`,
      [fixtureId(24609), ORG, fixtureId(24608), hash("service"), NOW, USER],
    );
    await pool.query(
      `insert into business_policies (id,organization_id,policy_key,version_no,policy_type,schema_version,
      rules_jsonb,status,content_hash) values ($1,$2,'synthetic-replacement',1,'qualification',1,'{"required_fields":["service"]}','draft',$3)`,
      [fixtureId(24610), ORG, hash("policy")],
    );
    await pool.query(
      `insert into appointment_requests (id,organization_id,lead_id,contact_id,conversation_id,
      source_message_id,service_id,service_version_id,location_id,location_version_id,business_policy_id,status,request_dedupe_key)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'requested','synthetic-retired-request')`,
      [
        scope.retiredRequestId,
        ORG,
        fixtureId(24602),
        fixtureId(24601),
        scope.retiredConversationId,
        scope.retiredMessageId,
        fixtureId(24608),
        fixtureId(24609),
        fixtureId(24606),
        fixtureId(24607),
        fixtureId(24610),
      ],
    );
  };
  const dispatch = (
    runId: string = WIDGET_RUN,
    messageId: string = WIDGET_MESSAGE,
    attemptNo = 1,
  ) => {
    if (
      !isSchemaValue(OrganizationIdSchema, ORG) ||
      !isSchemaValue(ConversationIdSchema, WIDGET_CONVERSATION) ||
      !isSchemaValue(MessageIdSchema, messageId) ||
      !isSchemaValue(CorrelationIdSchema, runId)
    )
      throw new Error("Invalid dispatch fixture");
    return {
      reference: {
        organizationId: ORG,
        conversationId: WIDGET_CONVERSATION,
        messageId,
        correlationId: runId,
        causationId: messageId,
      },
      reservation: { runId, attemptNo },
    };
  };
  const guard = (clock: () => Date = () => NOW) =>
    createAIJourneyBudgetGuard(options.runtime(), CONFIG, clock, { ownerSelection: true });

  const seedDateContinuation = async () => {
    await seedRetirement();
    const scope = S22_WIDGET_DATE_CONTINUATION;
    const pool = options.privilegedPool();
    const contact = fixtureId(24801),
      lead = fixtureId(24802);
    await seedSession(scope.sessionId);
    await guard().widgetCohortStore.select(await command(scope.sessionId, 1));
    await conversation(scope.conversationId, contact, lead);
    await message(scope.firstMessageId, scope.conversationId, contact, 1);
    await run(scope.firstRunId, scope.conversationId, scope.firstMessageId, 2277);
    await audit(fixtureId(24803), scope.firstRunId, "ai_run.journey_started", {
      profile: S22_BOOKING_COHORT.profile,
    });
    await audit(fixtureId(24804), scope.firstRunId, "ai_run.dispatch_reserved", {
      profile: S22_BOOKING_COHORT.profile,
      reservation_micros: "801432",
      widget_session_id: scope.sessionId,
      conversation_id: scope.conversationId,
    });
    await audit(fixtureId(24805), scope.firstRunId, "ai_run.completed", {
      profile: S22_BOOKING_COHORT.profile,
      dispatch_authorized: true,
    });
    await pool.query(
      `insert into audit_events (id,organization_id,event_type,actor_type,target_type,target_id,action,
        result,request_id,correlation_id,metadata_redacted_jsonb,occurred_at)
        values ($1,$2,'ai_run.widget_journey_bound','system','widget_session',$3,'ai_run.widget_journey_bound',
        'succeeded','synthetic-date-continuation-binding',$1,$4::jsonb,$5)`,
      [
        fixtureId(24806),
        ORG,
        scope.sessionId,
        JSON.stringify({
          profile: S22_BOOKING_COHORT.profile,
          widget_session_id: scope.sessionId,
          conversation_id: scope.conversationId,
        }),
        NOW,
      ],
    );
    // Model authenticated recovery metadata after original expiry, not redemption
    // of a real code. Prior suites separately exercise the actual recovery flow.
    await pool.query(
      `update widget_sessions set conversation_id=$1,contact_id=$2,version=3,
        issued_at=$3,expires_at=$4,recovery_token_hash=$5,recovery_issued_at=$6,
        recovery_expires_at=$7,recovery_request_origin='https://widget.example',
        recovery_embedding_origin='https://s22-synthetic.example',access_issued_at=$8,
        access_expires_at=$9,last_seen_at=$8 where organization_id=$10 and id=$11`,
      [
        scope.conversationId,
        contact,
        later(-7300000),
        later(-100000),
        hash("synthetic-date-recovery"),
        later(-200000),
        later(86200000),
        NOW,
        later(7200000),
        ORG,
        scope.sessionId,
      ],
    );
    return { scope, contact, pool };
  };

  describe("S22 exact same-chat date continuation — actual PostgreSQL guards", () => {
    it("retains usage through recovery, admits one clarification, never dispatches the third inbound", async () => {
      const { scope, contact, pool } = await seedDateContinuation();
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        blocked: false,
        physicalCalls: 6,
        knownCostMicros: "13241",
        combinedExposureMicros: "1046637",
        widget: { sessionId: scope.sessionId, physicalCalls: 1, customerMessages: 1 },
      });
      const clarification = fixtureId(24807),
        secondRun = fixtureId(24808);
      await message(clarification, scope.conversationId, contact, 2);
      await run(secondRun, scope.conversationId, clarification, null, true);
      await audit(fixtureId(24809), secondRun, "ai_run.journey_started", {
        profile: S22_BOOKING_COHORT.profile,
      });
      const candidate = dispatch(secondRun, clarification);
      if (!isSchemaValue(ConversationIdSchema, scope.conversationId))
        throw new Error("Invalid continuation conversation");
      const input = {
        ...candidate,
        reference: { ...candidate.reference, conversationId: scope.conversationId },
      };
      const concurrent = await Promise.all([
        guard().authorizeDispatch(input),
        guard().authorizeDispatch(input),
      ]);
      expect(concurrent.filter(Boolean)).toHaveLength(1);
      await pool.query(
        `update ai_runs set status='succeeded',finished_at=$1,estimated_cost_micros=1000,
          provider_resolved_model_id='gemini-3.8-flash',input_units=520,output_units=217,
          cached_input_units=0,total_units=737,latency_ms=1000,output_hash=$2,schema_valid=true,policy_allowed=true
          where organization_id=$3 and id=$4`,
        [later(1000), hash("synthetic-date-finished"), ORG, secondRun],
      );
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        blocked: false,
        knownCostMicros: "14241",
        widget: { physicalCalls: 2, customerMessages: 2 },
      });
      const third = fixtureId(24810),
        thirdRun = fixtureId(24811);
      await message(third, scope.conversationId, contact, 3);
      await run(thirdRun, scope.conversationId, third, null, true);
      await audit(fixtureId(24812), thirdRun, "ai_run.journey_started", {
        profile: S22_BOOKING_COHORT.profile,
      });
      const thirdCandidate = dispatch(thirdRun, third);
      expect(
        await guard().authorizeDispatch({
          ...thirdCandidate,
          reference: { ...thirdCandidate.reference, conversationId: scope.conversationId },
        }),
      ).toBe(false);
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        reason: "message_limit",
        widget: { physicalCalls: 2, customerMessages: 3 },
      });
      await message(fixtureId(24813), scope.conversationId, contact, 4);
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        reason: "message_limit",
        widget: { customerMessages: 4 },
      });
      await expect(
        guard().widgetCohortStore.select(await command(SECOND, 2)),
      ).rejects.toMatchObject({ code: "cohort_blocked" });
      expect(
        (
          await pool.query("select estimated_cost_micros from ai_runs where id=$1", [
            scope.firstRunId,
          ])
        ).rows[0],
      ).toMatchObject({ estimated_cost_micros: "2277" });
    });
    it.each([null, 0, 2278])(
      "denies mutated original cost %s without creating another reservation",
      async (cost) => {
        const { scope, pool } = await seedDateContinuation();
        await pool.query(
          "update ai_runs set estimated_cost_micros=$1 where organization_id=$2 and id=$3",
          [cost, ORG, scope.firstRunId],
        );
        expect(await guard().read((await owner()).organizationId)).toMatchObject({ blocked: true });
        expect(
          (
            await pool.query(
              "select id from audit_events where organization_id=$1 and action='ai_run.dispatch_reserved'",
              [ORG],
            )
          ).rows,
        ).toHaveLength(6);
      },
    );
  });

  describe("S22 one replacement lane — actual PostgreSQL locks/RLS", () => {
    it("enforces three physical slots and two customer inbounds across independent guard instances", async () => {
      await seedRetirement();
      await guard().widgetCohortStore.select(await command(FIRST, 1));
      await bind();
      const pool = options.privilegedPool();
      const finish = async (id: string) =>
        pool.query(
          `update ai_runs set status='succeeded',finished_at=$1,
        estimated_cost_micros=1000,provider_resolved_model_id='gemini-3.8-flash',input_units=520,output_units=217,
        cached_input_units=0,total_units=737,latency_ms=1000,output_hash=$2,schema_valid=true,policy_allowed=true
        where id=$3`,
          [later(1000), hash(`finished:${id}`), id],
        );
      const attempt = async (id: string, trigger: string, number: number) => {
        await run(id, WIDGET_CONVERSATION, trigger, null, true, number);
        await audit(fixtureId(24700 + number), id, "ai_run.journey_started", {
          profile: S22_BOOKING_COHORT.profile,
        });
        return dispatch(id, trigger, number);
      };
      expect(await guard().authorizeDispatch(dispatch())).toBe(true);
      await finish(WIDGET_RUN);
      const repair = await attempt(fixtureId(24710), WIDGET_MESSAGE, 2);
      expect(await guard().authorizeDispatch(repair)).toBe(true);
      await finish(repair.reservation.runId);
      const excess = await attempt(fixtureId(24711), WIDGET_MESSAGE, 3);
      expect(await guard().authorizeDispatch(excess)).toBe(false);
      const nextMessage = fixtureId(24712);
      await message(nextMessage, WIDGET_CONVERSATION, WIDGET_CONTACT, 2);
      const next = await attempt(fixtureId(24713), nextMessage, 1);
      expect(await guard().authorizeDispatch(next)).toBe(true);
      await finish(next.reservation.runId);
      // A new process sees the durable counts, not fresh in-memory credits.
      await run(fixtureId(24714), WIDGET_CONVERSATION, nextMessage, null, true, 2);
      await audit(fixtureId(24715), fixtureId(24714), "ai_run.journey_started", {
        profile: S22_BOOKING_COHORT.profile,
      });
      expect(await guard().authorizeDispatch(dispatch(fixtureId(24714), nextMessage, 2))).toBe(
        false,
      );
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        physicalCalls: 8,
        knownCostMicros: "13964",
        widget: { physicalCalls: 3, customerMessages: 2 },
        reason: "attempt_limit",
      });
      await message(fixtureId(24716), WIDGET_CONVERSATION, WIDGET_CONTACT, 3);
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        reason: "message_limit",
      });
    });
    it("actual code recovery retains the replacement identity, request and consumed budget after original expiry", async () => {
      await seedRetirement();
      let now = NOW;
      const clock = () => now;
      const publicOrigin = "https://s22-synthetic.example",
        platformOrigin = "https://widget.example",
        key = "synthetic_public_widget_key_1234567890";
      if (!isSchemaValue(OrganizationIdSchema, ORG)) throw new Error("Invalid organization");
      const organizationId = ORG;
      // This is a synthetic route resolver, not a provider or production account.
      if (!isSchemaValue(ChannelConnectionIdSchema, CHANNEL)) throw new Error("Invalid channel");
      const channelConnectionId = CHANNEL;
      const tokens = createWidgetTokenService(
        createWidgetSecurityConfig(Buffer.alloc(32, 71).toString("base64url")),
      );
      const embedConfig = createWidgetEmbedConfig(
        Buffer.alloc(32, 72).toString("base64url"),
        platformOrigin,
        "https://api.example",
        [Buffer.alloc(32, 71).toString("base64url")],
      );
      const useCases = createWidgetUseCases({
        clock,
        tokens,
        dataProtector: createCustomerDataProtection({
          currentEncryptionKey: Buffer.alloc(32, 73),
          currentKeyId: "synthetic-replacement",
          lookupKey: Buffer.alloc(32, 74),
        }),
        embed: {
          exchanges: createWidgetExchangeGrantService(embedConfig),
          platformOrigin,
          publicApiOrigin: "https://api.example",
        },
        persistence: createWidgetPersistenceStore(options.runtime(), { clock }),
        recovery: {
          grants: createWidgetRecoveryGrantService(embedConfig),
          store: createWidgetRecoveryStore(options.runtime()),
        },
        rateLimiter: createWidgetRateLimiter({ clock, salt: Buffer.alloc(32, 75) }),
        routeResolver: {
          resolveInboundRoute: () => Promise.resolve({ organizationId, channelConnectionId }),
        },
      });
      const fresh = async () => {
        const grant = await useCases.createEmbedGrant({
          clientIp: "127.0.0.1",
          origin: publicOrigin,
          pageUrl: publicOrigin,
          requestedLocale: "uz",
          widgetKey: key,
        });
        return useCases.redeemEmbedSession({
          exchangeGrant: grant.exchangeGrant,
          origin: platformOrigin,
        });
      };
      const initial = await fresh(),
        initialClaims = await tokens.verify(initial.bearerToken, now);
      await guard(clock).widgetCohortStore.select(await command(initialClaims.sessionId, 1));
      const created = await useCases.createConversation({
        bearerToken: initial.bearerToken,
        origin: platformOrigin,
        body: {
          client_message_id: "synthetic.replacement-1",
          kind: "text",
          locale_hint: "uz",
          text: "Synthetic booking request",
        },
        idempotencyKey: "synthetic-replacement-intake",
      });
      const claims = await tokens.verify(created.bearerToken, now),
        pool = options.privilegedPool();
      if (claims.conversationId === null) throw new Error("Missing conversation");
      const messages = await pool.query<{ id: string }>(
        "select id::text from messages where conversation_id=$1 and direction='inbound'",
        [claims.conversationId],
      );
      const msg = messages.rows[0]?.id;
      if (!isSchemaValue(MessageIdSchema, msg)) throw new Error("Missing message");
      const runId = fixtureId(24801);
      await run(runId, claims.conversationId, msg, null, true);
      await audit(fixtureId(24802), runId, "ai_run.journey_started", {
        profile: S22_BOOKING_COHORT.profile,
      });
      const ref = { ...dispatch(runId, msg).reference, conversationId: claims.conversationId };
      expect(
        await guard(clock).authorizeDispatch({
          reference: ref,
          reservation: { runId, attemptNo: 1 },
        }),
      ).toBe(true);
      await pool.query(
        `update ai_runs set status='succeeded',finished_at=$1,estimated_cost_micros=1000,
        provider_resolved_model_id='gemini-3.8-flash',input_units=520,output_units=217,cached_input_units=0,total_units=737,
        latency_ms=1000,output_hash=$2,schema_valid=true,policy_allowed=true where id=$3`,
        [later(1000), hash("recovered-output"), runId],
      );
      const request = fixtureId(24803);
      await pool.query(
        `insert into appointment_requests (id,organization_id,lead_id,contact_id,conversation_id,source_message_id,
        service_id,service_version_id,location_id,location_version_id,business_policy_id,status,request_dedupe_key)
        select $1,$2,cv.lead_id,cv.contact_id,cv.id,$3,ar.service_id,ar.service_version_id,ar.location_id,ar.location_version_id,
          ar.business_policy_id,'requested','synthetic-replacement-request' from conversations cv cross join appointment_requests ar
        where cv.organization_id=$2 and cv.id=$4 and ar.organization_id=$2 and ar.id=$5`,
        [request, ORG, msg, claims.conversationId, S22_WIDGET_REPLACEMENT.retiredRequestId],
      );
      const code = await useCases.issueRecoveryCode({
        bearerToken: created.bearerToken,
        origin: platformOrigin,
        requestId: "synthetic-recovery-code",
      });
      const original = await pool.query(
        "select id,contact_id,conversation_id,issued_at,expires_at from widget_sessions where id=$1",
        [claims.sessionId],
      );
      const ledger = await pool.query("select id,estimated_cost_micros from ai_runs order by id");
      now = later(7_201_000);
      const context = await fresh();
      const resumed = await useCases.resumeConversation({
        bearerToken: context.bearerToken,
        origin: platformOrigin,
        body: { recovery_code: code.recoveryCode },
        clientIp: "127.0.0.1",
        requestId: "synthetic-recovery-resume",
      });
      expect(await tokens.verify(resumed.bearerToken, now)).toMatchObject({
        sessionId: claims.sessionId,
        conversationId: claims.conversationId,
      });
      expect(
        (
          await pool.query(
            "select id,contact_id,conversation_id,issued_at,expires_at from widget_sessions where id=$1",
            [claims.sessionId],
          )
        ).rows,
      ).toEqual(original.rows);
      expect(
        (await pool.query("select id,estimated_cost_micros from ai_runs order by id")).rows,
      ).toEqual(ledger.rows);
      expect(
        (await pool.query("select status,version from appointment_requests where id=$1", [request]))
          .rows,
      ).toEqual([{ status: "requested", version: "1" }]);
      expect(await guard(clock).read(organizationId)).toMatchObject({
        physicalCalls: 6,
        knownCostMicros: "11964",
        unresolvedReserveMicros: "0",
        blocked: false,
        widget: {
          sessionId: claims.sessionId,
          conversationId: claims.conversationId,
          physicalCalls: 1,
          customerMessages: 1,
        },
      });
      await expect(
        useCases.getConversation({
          bearerToken: created.bearerToken,
          origin: platformOrigin,
          conversationId: claims.conversationId,
        }),
      ).rejects.toMatchObject({ code: "token_invalid" });
      await expect(
        useCases.resumeConversation({
          bearerToken: context.bearerToken,
          origin: platformOrigin,
          body: { recovery_code: code.recoveryCode },
          clientIp: "127.0.0.1",
          requestId: "synthetic-recovery-replay",
        }),
      ).rejects.toMatchObject({ code: "token_invalid" });
      expect(
        (
          await pool.query(
            "select id from messages where conversation_id=$1 and direction='inbound'",
            [claims.conversationId],
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("serializes replacement CAS and retains history, costs, attribution and original timestamps", async () => {
      await seedRetirement();
      const ledger = await options
        .privilegedPool()
        .query("select id,estimated_cost_micros from ai_runs order by id");
      const identity = await options
        .privilegedPool()
        .query(
          "select id,issued_at,last_seen_at,expires_at,version from widget_sessions order by id",
        );
      const store = guard().widgetCohortStore;
      const results = await Promise.allSettled([
        store.select(await command(FIRST, 1)),
        guard().widgetCohortStore.select(await command(SECOND, 1)),
      ]);
      expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((value) => value.status === "rejected")).toHaveLength(1);
      const selected = (await store.get({ actor: await owner() })).selected_session_id;
      if (selected === null) throw new Error("Missing selected session");
      const receipt = await store.select(await command(selected, 1));
      expect(receipt.selection_version).toBe(2);
      expect(
        (
          await options
            .privilegedPool()
            .query("select id,estimated_cost_micros from ai_runs order by id")
        ).rows,
      ).toEqual(ledger.rows);
      expect(
        (
          await options
            .privilegedPool()
            .query(
              "select id,issued_at,last_seen_at,expires_at,version from widget_sessions order by id",
            )
        ).rows,
      ).toEqual(identity.rows);
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        physicalCalls: 5,
        logicalMessages: 5,
        knownCostMicros: "10964",
        combinedExposureMicros: "1044360",
        unresolvedReserveMicros: "0",
        blocked: false,
        widget: { physicalCalls: 0 },
      });
      const audits = await options.privilegedPool().query(
        `select actor_id::text,actor_membership_id::text,metadata_redacted_jsonb
        from audit_events where metadata_redacted_jsonb->>'replacement_profile'=$1`,
        [S22_WIDGET_REPLACEMENT.profile],
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]).toMatchObject({
        actor_id: USER,
        actor_membership_id: MEMBER,
        metadata_redacted_jsonb: { retired_session_id: S22_WIDGET_REPLACEMENT.retiredSessionId },
      });
      await expect(
        store.select(await command(selected === FIRST ? SECOND : FIRST, 2)),
      ).rejects.toMatchObject({ code: "cohort_blocked" });
    });
    it("actual transaction rollback preserves the old authority if audit persistence fails", async () => {
      await seedRetirement();
      await options.privilegedPool()
        .query(`create function synthetic_replacement_abort() returns trigger language plpgsql as $$
        begin if new.metadata_redacted_jsonb->>'replacement_profile'='s22-widget-replacement.v1' then
          raise exception 'synthetic replacement rollback'; end if; return new; end $$;
        create trigger synthetic_replacement_abort before insert on audit_events for each row execute function synthetic_replacement_abort()`);
      try {
        await expect(
          guard().widgetCohortStore.select(await command(FIRST, 1)),
        ).rejects.toMatchObject({ code: "repository_database_error" });
        expect(
          (await guard().widgetCohortStore.get({ actor: await owner() })).selection_version,
        ).toBe(1);
      } finally {
        await options
          .privilegedPool()
          .query(
            "drop trigger synthetic_replacement_abort on audit_events; drop function synthetic_replacement_abort()",
          );
      }
    });
    it.each([
      "historical-zero",
      "unknown-retired-cost",
      "extra-retired-inbound",
      "active-retired-access",
      "missing-reservation",
      "missing-binding",
    ])("denies changed %s at the real database boundary", async (kind) => {
      await seedRetirement();
      const pool = options.privilegedPool(),
        s = S22_WIDGET_REPLACEMENT;
      if (kind === "historical-zero")
        await pool.query("update ai_runs set estimated_cost_micros=0 where id=$1", [
          S22_BOOKING_COHORT.historicalRunIds[0],
        ]);
      if (kind === "unknown-retired-cost")
        await pool.query("update ai_runs set estimated_cost_micros=null where id=$1", [
          s.retiredRunId,
        ]);
      if (kind === "extra-retired-inbound")
        await message(fixtureId(24611), s.retiredConversationId, fixtureId(24601), 2);
      if (kind === "active-retired-access")
        await pool.query("update widget_sessions set expires_at=$1 where id=$2", [
          later(100000),
          s.retiredSessionId,
        ]);
      if (kind === "missing-reservation")
        await pool.query(
          "delete from audit_events where target_id=$1 and action='ai_run.dispatch_reserved'",
          [s.retiredRunId],
        );
      if (kind === "missing-binding")
        await pool.query(
          "delete from audit_events where target_id=$1 and action='ai_run.widget_journey_bound'",
          [s.retiredSessionId],
        );
      await expect(guard().widgetCohortStore.select(await command(FIRST, 1))).rejects.toMatchObject(
        { code: "cohort_blocked" },
      );
      expect(
        (
          await pool.query(
            "select id from audit_events where metadata_redacted_jsonb->>'replacement_profile'=$1",
            [s.profile],
          )
        ).rows,
      ).toHaveLength(0);
    });
    it("denies cross-tenant choice, old dispatch, duplicate/new pending dispatch and a second replacement", async () => {
      await seedRetirement();
      await expect(
        guard().widgetCohortStore.select(await command(OTHER_SESSION, 1)),
      ).rejects.toMatchObject({ code: "selection_conflict" });
      await guard().widgetCohortStore.select(await command(FIRST, 1));
      await bind();
      const old = dispatch(
        S22_WIDGET_REPLACEMENT.retiredRunId,
        S22_WIDGET_REPLACEMENT.retiredMessageId,
      );
      if (!isSchemaValue(ConversationIdSchema, S22_WIDGET_REPLACEMENT.retiredConversationId))
        throw new Error("Invalid old conversation");
      expect(
        await guard().authorizeDispatch({
          ...old,
          reference: {
            ...old.reference,
            conversationId: S22_WIDGET_REPLACEMENT.retiredConversationId,
          },
        }),
      ).toBe(false);
      const results = await Promise.all([
        guard().authorizeDispatch(dispatch()),
        guard().authorizeDispatch(dispatch()),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await guard().read((await owner()).organizationId)).toMatchObject({
        physicalCalls: 6,
        unresolvedReserveMicros: "801432",
        blocked: true,
      });
      await expect(
        guard().widgetCohortStore.select(await command(SECOND, 2)),
      ).rejects.toMatchObject({ code: "cohort_blocked" });
    });
  });

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
      // Model an explicitly authenticated recovery lease after the immutable
      // original expiry. The durable selected identity and consumed ledger stay put.
      const original = await options
        .privilegedPool()
        .query<{ issued_at: Date; expires_at: Date }>(
          "select issued_at,expires_at from widget_sessions where id=$1",
          [FIRST],
        );
      await options.privilegedPool().query(
        `update widget_sessions set recovery_token_hash=$2,recovery_issued_at=$3,recovery_expires_at=$4,
          recovery_request_origin='https://widget.example',recovery_embedding_origin='https://clinic.example',
          access_issued_at=$5,access_expires_at=$6,last_seen_at=$5,version=version+1 where id=$1`,
        [
          FIRST,
          hash("recovery-proof"),
          NOW,
          later(86_400_000),
          later(10_800_000),
          later(18_000_000),
        ],
      );
      const recoveredGuard = createAIJourneyBudgetGuard(
        options.runtime(),
        CONFIG,
        () => later(10_800_000),
        { ownerSelection: true },
      );
      expect(await recoveredGuard.read(ORG)).toMatchObject({
        blocked: true,
        reason: "cost_unknown",
        unresolvedReserveMicros: "801432",
        widget: { sessionId: FIRST, customerMessages: 1, physicalCalls: 1, logicalMessages: 1 },
      });
      expect(
        (
          await options
            .privilegedPool()
            .query("select issued_at,expires_at from widget_sessions where id=$1", [FIRST])
        ).rows,
      ).toEqual(original.rows);
      await expect(guard.widgetCohortStore.select(await command(SECOND, 1))).rejects.toMatchObject({
        code: "cohort_blocked",
      });
    });
  });
};
