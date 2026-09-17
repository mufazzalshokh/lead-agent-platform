import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createAIOrchestrator,
  createCanonicalInboundUseCases,
  type AIProviderResult,
  type AIWorkReference,
  type CanonicalInboundReceipt,
} from "../../packages/application/src/index.js";
import {
  AgentFactualClaimSchema,
  CanonicalInboundEventSchema,
  ChannelConnectionIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import {
  createAIOrchestrationStore,
  createCanonicalInboundPersistenceStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  createAIProposalProtection,
  createCustomerDataProtection,
} from "../../packages/security/src/index.js";
import {
  AI_METADATA,
  AI_REFERENCE,
  AI_SNAPSHOT,
  fixtureId,
  validDecision,
} from "../ai/fixtures.js";

type Harness = Readonly<{ privilegedPool: () => Pool; runtime: () => TenantDatabaseRuntime }>;
const keys = {
  currentEncryptionKey: new Uint8Array(32).fill(61),
  currentKeyId: "s12-test-key",
  lookupKey: new Uint8Array(32).fill(62),
};
const dataProtection = createCustomerDataProtection(keys);
const proposalProtection = createAIProposalProtection(keys);
const tenantB = fixtureId(13001),
  channelB = fixtureId(13002);
if (
  !isSchemaValue(OrganizationIdSchema, tenantB) ||
  !isSchemaValue(ChannelConnectionIdSchema, channelB)
)
  throw new TypeError("Invalid hostile fixture");
const result = (): AIProviderResult => ({
  ...AI_METADATA,
  kind: "completed",
  value: validDecision(),
});
const seed = async (harness: Harness, tenant: "a" | "b" = "a"): Promise<void> => {
  const org = tenant === "a" ? AI_REFERENCE.organizationId : tenantB;
  const channel = tenant === "a" ? AI_SNAPSHOT.channelConnectionId : channelB;
  await harness
    .privilegedPool()
    .query(
      `insert into organizations (id,slug,display_name,status,default_locale,default_time_zone) values ($1,$2,'S12 synthetic tenant','active','en','Asia/Tashkent')`,
      [org, `s12-${tenant}`],
    );
  await harness
    .privilegedPool()
    .query(
      `insert into channel_connections (id,organization_id,channel_type,status,display_name,configuration_jsonb,verified_at) values ($1,$2,'widget','active','S12 test Widget','{}'::jsonb,now())`,
      [channel, org],
    );
};
const accept = async (
  harness: Harness,
  options: Readonly<{ tenant?: "a" | "b"; sequence?: number; text?: string }> = {},
): Promise<CanonicalInboundReceipt> => {
  const org = options.tenant === "b" ? tenantB : AI_REFERENCE.organizationId;
  const channel = options.tenant === "b" ? channelB : AI_SNAPSHOT.channelConnectionId;
  const sequence = options.sequence ?? 1;
  const event: unknown = {
    channel: "widget",
    channel_connection_id: channel,
    content: { locale_hint: "en", type: "text", text: options.text ?? "Hello synthetic customer" },
    event_id: `s12:event:${sequence}`,
    external_account_id: null,
    external_conversation_id: "s12:thread",
    external_message_id: `s12:message:${sequence}`,
    external_sender_id: "s12:participant",
    kind: "text",
    occurred_at: "2026-09-15T08:00:00.000Z",
    received_at: "2026-09-15T08:00:00.000Z",
  };
  if (!isSchemaValue(CanonicalInboundEventSchema, event))
    throw new TypeError("Invalid S12 inbound fixture");
  const accepted = await createCanonicalInboundUseCases(
    createCanonicalInboundPersistenceStore(harness.runtime()),
    dataProtection,
  ).acceptInbound({ context: { organizationId: org, channelConnectionId: channel }, event });
  if (!accepted.ok) throw new Error(`S12 seed failed: ${accepted.error.code}`);
  return accepted.value;
};
const referenceFor = (receipt: CanonicalInboundReceipt): AIWorkReference => ({
  ...AI_REFERENCE,
  conversationId: receipt.conversationId,
  messageId: receipt.messageId,
});
const bindWidget = async (harness: Harness, receipt: CanonicalInboundReceipt): Promise<void> => {
  const pool = harness.privilegedPool();
  const user = fixtureId(13003),
    membership = fixtureId(13004),
    origin = fixtureId(13005),
    session = fixtureId(13006);
  await pool.query(`insert into users (id,status) values ($1,'active')`, [user]);
  await pool.query(
    `insert into memberships (id,organization_id,user_id,role,status,location_scope,activated_at) values ($1,$2,$3,'owner','active','all',now())`,
    [membership, AI_REFERENCE.organizationId, user],
  );
  await pool.query(
    `insert into widget_allowed_origins (id,organization_id,channel_connection_id,match_type,scheme,normalized_host,status,created_by_user_id) values ($1,$2,$3,'exact','https','s12.example.com','active',$4)`,
    [origin, AI_REFERENCE.organizationId, AI_SNAPSHOT.channelConnectionId, user],
  );
  await pool.query(
    `insert into widget_sessions (id,organization_id,channel_connection_id,widget_allowed_origin_id,session_token_jti_hash,participant_lookup_hash,status,requested_locale,contact_id,conversation_id,issued_at,last_seen_at,expires_at)
    select $1,$2,$3,$4,$5,lookup_hash,'active','en',$6,$7,now(),now(),now()+interval '1 hour' from contact_identities where organization_id=$2 and contact_id=$6 and identity_type='widget_participant'`,
    [
      session,
      AI_REFERENCE.organizationId,
      AI_SNAPSHOT.channelConnectionId,
      origin,
      Buffer.alloc(32, 91),
      receipt.contactId,
      receipt.conversationId,
    ],
  );
};
const store = (harness: Harness, protectProposal = proposalProtection.protect) =>
  createAIOrchestrationStore(harness.runtime(), {
    requestedModel: "configured-test-model",
    dataProtection,
    protectProposal,
  });
const counts = async (pool: Pool) =>
  (
    await pool.query<Record<string, unknown>>(
      `select (select count(*)::int from ai_runs where status='succeeded') as completed,(select count(*)::int from ai_action_evaluations) as evaluations,(select count(*)::int from audit_events where target_type='ai_run') as audits,(select count(*)::int from outbox_events where aggregate_type='ai_run') as outbox,(select count(*)::int from messages where direction='outbound') as outbound,(select count(*)::int from appointment_requests) as appointments,(select count(*)::int from handoffs) as handoffs`,
    )
  ).rows[0];
export const registerAIOrchestrationTests = (harness: Harness): void => {
  describe("S12 tenant-bound safe AI persistence", () => {
    it("atomically persists provenance/evaluation/audit/Outbox without protected actions or plaintext snapshots", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const decide = vi.fn(() =>
        Promise.resolve({
          ...AI_METADATA,
          kind: "completed" as const,
          value: validDecision({ action: { type: "create_appointment_request" } }),
        }),
      );
      expect(
        await createAIOrchestrator({
          provider: { decide },
          store: store(harness),
          timeoutMs: 5_000,
        }).run(referenceFor(receipt)),
      ).toMatchObject({ kind: "decision", applied: false });
      expect(await counts(harness.privilegedPool())).toEqual({
        completed: 1,
        evaluations: 1,
        audits: 1,
        outbox: 1,
        outbound: 0,
        appointments: 0,
        handoffs: 0,
      });
      const rows = await harness
        .privilegedPool()
        .query<Record<string, unknown>>(
          `select r.*,e.arguments_ciphertext,e.application_status from ai_runs r join ai_action_evaluations e on e.organization_id=r.organization_id and e.ai_run_id=r.id`,
        );
      expect(rows.rows[0]).toMatchObject({
        status: "succeeded",
        schema_valid: true,
        policy_allowed: true,
        input_snapshot_ciphertext: null,
        output_snapshot_ciphertext: null,
        snapshot_capture_policy_id: null,
        estimated_cost_micros: null,
        application_status: "not_applied",
      });
      const row = rows.rows[0];
      if (row === undefined) throw new Error("Missing run");
      const runId = row["id"];
      const argumentsCiphertext = row["arguments_ciphertext"];
      if (typeof runId !== "string" || !(argumentsCiphertext instanceof Uint8Array))
        throw new Error("Invalid run evidence");
      expect(
        proposalProtection.reveal({
          organizationId: AI_REFERENCE.organizationId,
          runId,
          ciphertext: argumentsCiphertext,
        }),
      ).toBe('{"type":"create_appointment_request"}');
      expect(JSON.stringify(rows.rows)).not.toContain("Hello synthetic customer");
    });
    it("keeps Lead/Conversation versions and qualification unchanged", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const before = (
        await harness
          .privilegedPool()
          .query(
            `select l.status,l.version,c.version as conversation_version,c.status as conversation_status from leads l join conversations c on c.organization_id=l.organization_id and c.lead_id=l.id`,
          )
      ).rows;
      await createAIOrchestrator({
        provider: {
          decide: () =>
            Promise.resolve({
              ...AI_METADATA,
              kind: "completed",
              value: validDecision({
                action: { type: "request_handoff", reason: "customer_requested" },
              }),
            }),
        },
        store: store(harness),
        timeoutMs: 5_000,
      }).run(referenceFor(receipt));
      expect(
        (
          await harness
            .privilegedPool()
            .query(
              `select l.status,l.version,c.version as conversation_version,c.status as conversation_status from leads l join conversations c on c.organization_id=l.organization_id and c.lead_id=l.id`,
            )
        ).rows,
      ).toEqual(before);
      expect(await counts(harness.privilegedPool())).toMatchObject({ handoffs: 0, outbound: 0 });
    });
    it("duplicate work cannot invoke the provider or create another authoritative result", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const decide = vi.fn(() => Promise.resolve(result()));
      const orchestrator = createAIOrchestrator({
        provider: { decide },
        store: store(harness),
        timeoutMs: 5_000,
      });
      await orchestrator.run(referenceFor(receipt));
      await orchestrator.run(referenceFor(receipt));
      expect(decide).toHaveBeenCalledTimes(1);
      expect(await counts(harness.privilegedPool())).toMatchObject({
        completed: 1,
        evaluations: 1,
        audits: 1,
        outbox: 1,
      });
    });
    it("concurrent physical calls have at most ONE authoritative completion", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const reference = referenceFor(receipt);
      const persistence = store(harness);
      const snapshot = await persistence.load(reference);
      if (snapshot === null) throw new Error("Missing context");
      const reservations = await Promise.all([
        persistence.reserve({ reference, snapshot, inputHash: new Uint8Array(32).fill(1) }),
        persistence.reserve({ reference, snapshot, inputHash: new Uint8Array(32).fill(1) }),
      ]);
      const candidates = reservations.filter((reservation) => reservation !== null);
      expect(candidates).toHaveLength(2);
      expect(new Set(candidates.map((candidate) => candidate.attemptNo)).size).toBe(2);
      const outcomes = await Promise.all(
        candidates.map((reservation) =>
          persistence.finish({
            reference,
            snapshot,
            reservation,
            provider: result(),
            outcome: {
              kind: "decision",
              decision: validDecision(),
              disposition: "candidate",
              applied: false,
            },
            allowRepair: false,
          }),
        ),
      );
      expect(outcomes.filter((outcome) => outcome.kind === "decision")).toHaveLength(1);
      expect(await counts(harness.privilegedPool())).toMatchObject({
        completed: 1,
        audits: 2,
        outbox: 2,
      });
    });
    it("Tenant A/B source IDs fail closed symmetrically before provider calls", async () => {
      await seed(harness);
      await seed(harness, "b");
      const a = await accept(harness),
        b = await accept(harness, { tenant: "b" });
      const persistence = store(harness);
      expect(
        await persistence.load({ ...referenceFor(b), organizationId: AI_REFERENCE.organizationId }),
      ).toBeNull();
      expect(await persistence.load({ ...referenceFor(a), organizationId: tenantB })).toBeNull();
      expect(
        await persistence.load({ ...referenceFor(a), conversationId: b.conversationId }),
      ).toBeNull();
      expect(await counts(harness.privilegedPool())).toMatchObject({ completed: 0, audits: 0 });
    });
    it("rejects a forged source/context pairing before reservation", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const persistence = store(harness);
      const reference = referenceFor(receipt);
      const snapshot = await persistence.load(reference);
      if (snapshot === null) throw new Error("Missing context");
      await expect(
        persistence.reserve({
          reference,
          snapshot: { ...snapshot, sourceMessageId: AI_REFERENCE.messageId },
          inputHash: new Uint8Array(32),
        }),
      ).rejects.toMatchObject({ code: "repository_data_integrity_error" });
    });
    it("provider executes outside business transactions and delayed input becomes stale", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const decide = vi.fn(async () => {
        await accept(harness, { sequence: 2 });
        return result();
      });
      expect(
        await createAIOrchestrator({
          provider: { decide },
          store: store(harness),
          timeoutMs: 5_000,
        }).run(referenceFor(receipt)),
      ).toMatchObject({ reason: "stale_context" });
      expect(await counts(harness.privilegedPool())).toMatchObject({ completed: 0, outbound: 0 });
      expect(
        (await harness.privilegedPool().query(`select status from ai_runs`)).rows[0],
      ).toMatchObject({ status: "stale" });
    });
    it("resolved/paused automation suppresses a result arriving after provider call", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const decide = async () => {
        await harness
          .privilegedPool()
          .query(
            `update conversations set status='resolved',automation_mode='paused',resolved_at=now(),version=version+1,updated_at=now() where id=$1`,
            [receipt.conversationId],
          );
        return result();
      };
      expect(
        await createAIOrchestrator({
          provider: { decide },
          store: store(harness),
          timeoutMs: 5_000,
        }).run(referenceFor(receipt)),
      ).toMatchObject({ reason: "stale_context" });
    });
    it("ONE repair produces separate rejected and successful run/event records", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      let attempt = 0;
      const decide = (): Promise<AIProviderResult> =>
        Promise.resolve(
          ++attempt === 1
            ? { ...AI_METADATA, kind: "completed", value: { schema_version: "2" } }
            : result(),
        );
      await createAIOrchestrator({
        provider: { decide },
        store: store(harness),
        timeoutMs: 5_000,
      }).run(referenceFor(receipt));
      expect(
        (
          await harness
            .privilegedPool()
            .query(`select status,attempt_no from ai_runs order by attempt_no`)
        ).rows,
      ).toEqual([
        { status: "schema_rejected", attempt_no: 1 },
        { status: "succeeded", attempt_no: 2 },
      ]);
      expect(await counts(harness.privilegedPool())).toMatchObject({
        completed: 1,
        audits: 2,
        outbox: 2,
      });
    });
    it.each(["refusal", "timeout", "incomplete"] as const)(
      "persists %s as failure, not success/customer prose",
      async (kind) => {
        await seed(harness);
        const receipt = await accept(harness);
        const providerResult: AIProviderResult =
          kind === "incomplete"
            ? { ...AI_METADATA, kind, reason: "output_limit" }
            : { ...AI_METADATA, kind };
        await createAIOrchestrator({
          provider: { decide: () => Promise.resolve(providerResult) },
          store: store(harness),
          timeoutMs: 5_000,
        }).run(referenceFor(receipt));
        expect(
          (await harness.privilegedPool().query(`select status,failure_category from ai_runs`))
            .rows[0],
        ).toMatchObject({ status: "failed" });
        expect(await counts(harness.privilegedPool())).toMatchObject({
          completed: 0,
          audits: 1,
          outbox: 1,
          outbound: 0,
        });
      },
    );
    it("policy denial emits policy_denied and cannot force a mandatory phone", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      await bindWidget(harness, receipt);
      await createAIOrchestrator({
        provider: {
          decide: () =>
            Promise.resolve({
              ...AI_METADATA,
              kind: "completed",
              value: validDecision({ action: { type: "request_information", field: "phone" } }),
            }),
        },
        store: store(harness),
        timeoutMs: 5_000,
      }).run(referenceFor(receipt));
      expect(
        (await harness.privilegedPool().query(`select status from ai_runs`)).rows[0],
      ).toMatchObject({ status: "policy_denied" });
      expect(
        (
          await harness
            .privilegedPool()
            .query(`select validation_status,application_status from ai_action_evaluations`)
        ).rows[0],
      ).toEqual({ validation_status: "denied", application_status: "not_applied" });
    });
    it("contactability uses a valid bound Widget session, not identity alone", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const reference = referenceFor(receipt);
      expect((await store(harness).load(reference))?.policy.contactableWithoutPhone).toBe(false);
      await bindWidget(harness, receipt);
      expect((await store(harness).load(reference))?.policy.contactableWithoutPhone).toBe(true);
      await harness
        .privilegedPool()
        .query(
          `update widget_sessions set status='revoked',revoked_at=now(),revocation_reason='synthetic-test-revocation'`,
        );
      expect((await store(harness).load(reference))?.policy.contactableWithoutPhone).toBe(false);
    });
    it("unknown usage/cost remain null, not invented zero", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      await createAIOrchestrator({
        provider: {
          decide: () =>
            Promise.resolve({
              ...AI_METADATA,
              usage: { input: null, output: null, total: null, cachedInput: null, reasoning: null },
              kind: "completed",
              value: validDecision(),
            }),
        },
        store: store(harness),
        timeoutMs: 5_000,
      }).run(referenceFor(receipt));
      expect(
        (
          await harness
            .privilegedPool()
            .query(`select input_units,output_units,total_units,estimated_cost_micros from ai_runs`)
        ).rows[0],
      ).toEqual({
        input_units: null,
        output_units: null,
        total_units: null,
        estimated_cost_micros: null,
      });
    });
    it.each(["extra_fields", "excessive_references"] as const)(
      "rejects %s without copying unsafe knowledge into provenance",
      async (kind) => {
        await seed(harness);
        const receipt = await accept(harness);
        const factReference: unknown = {
          claim_kind: "service",
          source_type: "service",
          source_id: fixtureId(13100),
          source_version: 1,
        };
        if (!isSchemaValue(AgentFactualClaimSchema, factReference))
          throw new Error("Invalid knowledge fixture");
        const facts =
          kind === "extra_fields"
            ? [
                {
                  reference: { ...factReference, private_text: "synthetic-private-claim" },
                  text: "Synthetic fact",
                },
              ]
            : Array.from({ length: 25 }, () => ({
                reference: factReference,
                text: "Synthetic fact",
              }));
        const decide = vi.fn(() => Promise.resolve(result()));
        const persistence = createAIOrchestrationStore(harness.runtime(), {
          requestedModel: "configured-test-model",
          dataProtection,
          protectProposal: proposalProtection.protect,
          knowledge: () => Promise.resolve(facts),
        });
        expect(
          await createAIOrchestrator({
            provider: { decide },
            store: persistence,
            timeoutMs: 5_000,
          }).run(referenceFor(receipt)),
        ).toMatchObject({ reason: "context_too_large" });
        expect(decide).not.toHaveBeenCalled();
        const evidence = await harness
          .privilegedPool()
          .query<Record<string, unknown>>(`select status,knowledge_manifest_jsonb from ai_runs`);
        expect(evidence.rows[0]).toEqual({
          status: "failed",
          knowledge_manifest_jsonb: { sources: [] },
        });
        expect(JSON.stringify(evidence.rows)).not.toContain("synthetic-private-claim");
      },
    );
    it("argument-encryption failure rolls back the entire terminal write", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const persistence = store(harness, () => {
        throw new Error("synthetic-encryption-unavailable");
      });
      await expect(
        createAIOrchestrator({
          provider: { decide: () => Promise.resolve(result()) },
          store: persistence,
          timeoutMs: 5_000,
        }).run(referenceFor(receipt)),
      ).rejects.toThrow("synthetic-encryption-unavailable");
      expect(await counts(harness.privilegedPool())).toMatchObject({
        completed: 0,
        evaluations: 0,
        audits: 0,
        outbox: 0,
      });
      expect((await harness.privilegedPool().query(`select status from ai_runs`)).rows[0]).toEqual({
        status: "started",
      });
    });
    it("Outbox failure rolls back run, evaluation, audit and message linkage together", async () => {
      await seed(harness);
      const receipt = await accept(harness);
      const pool = harness.privilegedPool();
      await pool.query(
        `create function public.s12_reject_ai_outbox_test() returns trigger language plpgsql as $$ begin if new.event_type='ai_run.completed' then raise exception 'synthetic_s12_outbox_failure'; end if; return new; end $$`,
      );
      await pool.query(
        `create trigger s12_reject_ai_outbox_test before insert on outbox_events for each row execute function public.s12_reject_ai_outbox_test()`,
      );
      try {
        await expect(
          createAIOrchestrator({
            provider: { decide: () => Promise.resolve(result()) },
            store: store(harness),
            timeoutMs: 5_000,
          }).run(referenceFor(receipt)),
        ).rejects.toMatchObject({ code: "repository_database_error" });
        expect(await counts(pool)).toMatchObject({
          completed: 0,
          evaluations: 0,
          audits: 0,
          outbox: 0,
        });
        expect((await pool.query(`select status from ai_runs`)).rows[0]).toEqual({
          status: "started",
        });
        expect(
          (await pool.query(`select ai_run_id from messages where id=$1`, [receipt.messageId]))
            .rows[0],
        ).toEqual({ ai_run_id: null });
      } finally {
        await pool.query(`drop trigger s12_reject_ai_outbox_test on outbox_events`);
        await pool.query(`drop function public.s12_reject_ai_outbox_test()`);
      }
    });
  });
};
