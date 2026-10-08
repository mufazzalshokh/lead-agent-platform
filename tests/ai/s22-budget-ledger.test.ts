import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Pg from "pg";
import {
  S22_BOOKING_COHORT,
  S22_WIDGET_ALLOWANCE,
  createTenantDatabaseRuntimeConfig,
} from "../../packages/config/src/index.js";
import { AI_REFERENCE, fixtureId } from "./fixtures.js";
import {
  createAIJourneyBudgetGuard,
  createTenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  isSchemaValue,
  OrganizationIdSchema,
  MessageIdSchema,
  ConversationIdSchema,
} from "../../packages/contracts/src/index.js";

// The real tenant runtime/session/query guards are used. Only pg transport is
// modelled here; this is NOT PostgreSQL/RLS/row-lock execution evidence.
const transport = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = [];
  const reads: string[] = [];
  return {
    rows,
    tail: Promise.resolve(),
    commitFails: false,
    orphanReservations: 0,
    reads,
    mutexConversationId: "",
    widgetSession: null as Record<string, unknown> | null,
    widgetConversation: null as Record<string, unknown> | null,
    widgetContactStatus: "active",
    widgetBindings: [] as Record<string, unknown>[],
    widgetInboundMessages: [] as Record<string, unknown>[],
  };
});
vi.mock("pg", async (originalImport) => {
  const original = await originalImport<typeof Pg>();
  return {
    ...original,
    Pool: class {
      on() {
        return this;
      }
      async end() {
        /* fake transport cleanup */
      }
      connect() {
        let organization: unknown = null;
        let unlock: (() => void) | undefined;
        const writes: (() => void)[] = [];
        return Promise.resolve({
          release() {
            unlock?.();
            unlock = undefined;
          },
          async query(sql: string, values: readonly unknown[] = []) {
            if (/^with inherited/iu.test(sql)) {
              organization = values[0];
              return {
                rows: [
                  {
                    database_role: "lead_agent_runtime",
                    inherited_context: null,
                    organization_id: organization,
                  },
                ],
              };
            }
            if (sql.toLowerCase() === "begin") return { rows: [] };
            if (sql.toLowerCase() === "commit") {
              if (transport.commitFails) throw new Error("synthetic commit failure");
              for (const write of writes) write();
              unlock?.();
              unlock = undefined;
              return { rows: [] };
            }
            if (sql.toLowerCase() === "rollback") {
              unlock?.();
              unlock = undefined;
              return { rows: [] };
            }
            transport.reads.push(sql);
            if (/as markers/iu.test(sql))
              return {
                rows: [
                  {
                    count: transport.rows.reduce(
                      (total, row) => total + Number(row["reservations"]),
                      transport.orphanReservations,
                    ),
                  },
                ],
              };
            if (values.includes("ai_run.widget_journey_bound") && /^\s*select/iu.test(sql))
              return { rows: transport.widgetBindings.map((row) => ({ ...row })) };
            if (/from widget_sessions/iu.test(sql)) {
              const widget = transport.widgetSession;
              const queryRequiresActiveConnection = /cc\.status\s*=\s*'active'/iu.test(sql);
              const queryRequiresWidget = /cc\.channel_type\s*=\s*'widget'/iu.test(sql);
              const queryRequiresActiveOrigin = /wao\.status\s*=\s*'active'/iu.test(sql);
              const at = values[2];
              const idleBoundary = values[3];
              return {
                rows:
                  widget !== null &&
                  widget["organization_id"] === organization &&
                  widget["id"] === values[1] &&
                  (!/ws\.status\s*=\s*'active'/iu.test(sql) || widget["status"] === "active") &&
                  (!/ws\.revoked_at\s+is\s+null/iu.test(sql) || widget["revoked_at"] === null) &&
                  (!(at instanceof Date) ||
                    (widget["expires_at"] instanceof Date && widget["expires_at"] > at)) &&
                  (!(idleBoundary instanceof Date) ||
                    (widget["last_seen_at"] instanceof Date &&
                      widget["last_seen_at"] > idleBoundary)) &&
                  (!queryRequiresActiveConnection || widget["channel_status"] === "active") &&
                  (!queryRequiresWidget || widget["channel_type"] === "widget") &&
                  (!queryRequiresActiveOrigin || widget["origin_status"] === "active")
                    ? [{ ...widget }]
                    : [],
              };
            }
            if (/from conversations/iu.test(sql)) {
              if (values[1] === transport.mutexConversationId) {
                const previous = transport.tail;
                transport.tail = new Promise<void>((resolve) => {
                  unlock = resolve;
                });
                await previous;
              }
              if (/contact_id\s*=\s*\$3/iu.test(sql)) {
                const conversation = transport.widgetConversation;
                const requiresActiveContact =
                  /exists\s*\(\s*select\s+1\s+from\s+contacts\b[\s\S]*status\s*=\s*'active'/iu.test(
                    sql,
                  );
                return {
                  rows:
                    conversation !== null &&
                    conversation["organization_id"] === organization &&
                    conversation["id"] === values[1] &&
                    conversation["contact_id"] === values[2] &&
                    (!requiresActiveContact || transport.widgetContactStatus === "active")
                      ? [{ ...conversation }]
                      : [],
                };
              }
              return {
                rows: [{ id: values[1], status: "open", automation_mode: "ai", version: 1 }],
              };
            }
            if (/from messages/iu.test(sql) && /direction\s*=\s*'inbound'/iu.test(sql))
              return {
                rows: transport.widgetInboundMessages
                  .filter(
                    (row) =>
                      row["organization_id"] === organization &&
                      row["conversation_id"] === values[1] &&
                      row["direction"] === "inbound",
                  )
                  .sort((left, right) => Number(left["sequence_no"]) - Number(right["sequence_no"]))
                  .slice(0, 3)
                  .map((row) => ({ ...row })),
              };
            if (/from ai_runs r/iu.test(sql))
              return {
                rows: transport.rows
                  .filter((row) => row["organization_id"] === organization)
                  .map((row) => ({ ...row })),
              };
            if (/^insert into audit_events/iu.test(sql.trim())) {
              const action = values[2];
              const text = values[6];
              if (typeof text !== "string") throw new Error("Invalid synthetic metadata");
              const metadata: unknown = JSON.parse(text);
              if (typeof metadata !== "object" || metadata === null)
                throw new Error("Invalid synthetic metadata");
              if (action === "ai_run.widget_journey_bound") {
                const targetId = values[3];
                writes.push(() => {
                  transport.widgetBindings.push({
                    id: values[1],
                    target_id: targetId,
                    session_id: targetId,
                    widget_session_id:
                      "widget_session_id" in metadata ? metadata.widget_session_id : targetId,
                    widget_conversation_id:
                      "widget_conversation_id" in metadata
                        ? metadata.widget_conversation_id
                        : "conversation_id" in metadata
                          ? metadata.conversation_id
                          : null,
                    conversation_id:
                      "conversation_id" in metadata
                        ? metadata.conversation_id
                        : "widget_conversation_id" in metadata
                          ? metadata.widget_conversation_id
                          : null,
                    profile: "profile" in metadata ? metadata.profile : null,
                  });
                });
                return { rows: [], rowCount: 1 };
              }
              const row = transport.rows.find(
                (item) => item["id"] === values[3] && item["organization_id"] === organization,
              );
              if (row === undefined) throw new Error("Unknown synthetic audit target");
              if (!("reservation_micros" in metadata))
                throw new Error("Missing reservation metadata");
              const reservation = metadata.reservation_micros;
              writes.push(() => {
                row["reservations"] = 1;
                row["reserved_micros"] = reservation;
                row["reservation_widget_session_id"] =
                  "widget_session_id" in metadata ? metadata.widget_session_id : null;
                row["reservation_widget_conversation_id"] =
                  "widget_conversation_id" in metadata
                    ? metadata.widget_conversation_id
                    : "conversation_id" in metadata
                      ? metadata.conversation_id
                      : null;
                row["widget_session_id"] = row["reservation_widget_session_id"];
                row["widget_conversation_id"] = row["reservation_widget_conversation_id"];
              });
              return { rows: [], rowCount: 1 };
            }
            throw new Error("Unexpected synthetic SQL shape");
          },
        });
      }
    },
  };
});

const now = () => new Date("2026-10-05T20:00:00Z");
const reference = { ...AI_REFERENCE, conversationId: AI_REFERENCE.conversationId };
const config = () => ({
  ...S22_BOOKING_COHORT,
  mode: "booking" as const,
  organizationId: reference.organizationId,
  conversationId: reference.conversationId,
  historicalRunIds: [],
  historicalReserveMicros: 1_033_396n,
});
const runtime = () =>
  createTenantDatabaseRuntime(
    createTenantDatabaseRuntimeConfig({
      connectionString: "postgres://lead_agent_runtime:synthetic@localhost/s22_test",
    }),
    {
      onUnexpectedPoolError: () => {
        throw new Error("Unexpected synthetic pool error");
      },
    },
  );
const message = (index: number) => {
  const id = fixtureId(index);
  if (!isSchemaValue(MessageIdSchema, id)) throw new Error("Invalid synthetic message");
  return id;
};
const otherConversation = fixtureId(19201);
if (!isSchemaValue(ConversationIdSchema, otherConversation))
  throw new Error("Invalid synthetic conversation");
const widgetSessionId = fixtureId(19202);
const widgetContactId = fixtureId(19203);
const historicalRunIds = [fixtureId(19301), fixtureId(19302)] as const;
const row = (
  id = fixtureId(19001),
  message: string = reference.messageId,
  attempt = 1,
  conversationId: string = reference.conversationId,
): Record<string, unknown> => ({
  organization_id: reference.organizationId,
  id,
  conversation_id: conversationId,
  trigger_message_id: message,
  attempt_no: attempt,
  expected_conversation_version: 1,
  provider_id: "gemini",
  requested_model_id: "gemini-3.8-flash",
  provider_resolved_model_id: null,
  status: "started",
  estimated_cost_micros: null,
  finished_at: null,
  input_units: null,
  output_units: null,
  reservations: 0,
  reserved_micros: null,
  reservation_widget_session_id: null,
  reservation_widget_conversation_id: null,
  journey_starts: 1,
  dispatch_authorized: null,
});
const call = (runId = fixtureId(19001), messageId = reference.messageId, attemptNo = 1) => ({
  reference: { ...reference, messageId },
  reservation: { runId, attemptNo },
});
const settled = (value: Record<string, unknown>, cost: string | null = "1000") =>
  Object.assign(value, {
    reservations: 1,
    reserved_micros: "801432",
    status: "succeeded",
    finished_at: now(),
    estimated_cost_micros: cost,
    provider_resolved_model_id: "gemini-3.8-flash",
    input_units: "520",
    output_units: "217",
    dispatch_authorized: "true",
  });
const activeWidgetSession = (): Record<string, unknown> => ({
  id: widgetSessionId,
  organization_id: reference.organizationId,
  conversation_id: otherConversation,
  contact_id: widgetContactId,
  status: "active",
  revoked_at: null,
  last_seen_at: new Date("2026-10-05T19:59:00Z"),
  expires_at: new Date("2026-10-05T22:00:00Z"),
  channel_type: "widget",
  channel_status: "active",
  connection_status: "active",
  allowed_origin_status: "active",
  origin_status: "active",
});
const activeWidgetConversation = (): Record<string, unknown> => ({
  id: otherConversation,
  organization_id: reference.organizationId,
  contact_id: widgetContactId,
  status: "open",
  automation_mode: "ai",
  version: 1,
});
const widgetConfig = () => ({
  ...config(),
  mode: "widget_booking" as const,
  widgetSessionId,
  historicalRunIds: [...historicalRunIds],
});
const widgetReference = { ...reference, conversationId: otherConversation };
const widgetCall = (runId = fixtureId(19401), messageId = message(19501), attemptNo = 1) => ({
  reference: { ...widgetReference, messageId },
  reservation: { runId, attemptNo },
});
const setWidgetInboundMessages = (...messageIds: readonly string[]): void => {
  transport.widgetInboundMessages = messageIds.map((id, index) => ({
    organization_id: reference.organizationId,
    conversation_id: otherConversation,
    id,
    direction: "inbound",
    sequence_no: String(index + 1),
  }));
};
const originalLedger = (): Record<string, unknown>[] => [
  row(historicalRunIds[0]),
  row(historicalRunIds[1]),
  settled(row(fixtureId(19001), message(19101)), "1950"),
  settled(row(fixtureId(19002), message(19102)), "1792"),
  settled(row(fixtureId(19003), message(19103)), "2465"),
  settled(row(fixtureId(19004), message(19104)), "2507"),
];
const widgetRow = (
  id = fixtureId(19401),
  messageId = message(19501),
  attemptNo = 1,
): Record<string, unknown> => row(id, messageId, attemptNo, otherConversation);
const markWidgetReservation = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.assign(value, {
    reservation_widget_session_id: widgetSessionId,
    reservation_widget_conversation_id: otherConversation,
    widget_session_id: widgetSessionId,
    widget_conversation_id: otherConversation,
  });
const bindWidget = (): void => {
  transport.widgetBindings = [
    {
      id: fixtureId(19601),
      target_id: widgetSessionId,
      session_id: widgetSessionId,
      widget_session_id: widgetSessionId,
      widget_conversation_id: otherConversation,
      conversation_id: otherConversation,
      profile: S22_BOOKING_COHORT.profile,
    },
  ];
};
beforeEach(() => {
  transport.rows = [];
  transport.tail = Promise.resolve();
  transport.commitFails = false;
  transport.orphanReservations = 0;
  transport.reads = [];
  transport.mutexConversationId = reference.conversationId;
  transport.widgetSession = null;
  transport.widgetConversation = activeWidgetConversation();
  transport.widgetContactStatus = "active";
  transport.widgetBindings = [];
  transport.widgetInboundMessages = [];
});

describe("S22 durable budget ledger — modelled pg transport", () => {
  it("does not free a durable reservation if its run disappears", async () => {
    transport.rows = [row()];
    transport.orphanReservations = 1;
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(db, config(), now);
    expect(await guard.authorizeDispatch(call())).toBe(false);
    expect((await guard.read(reference.organizationId)).reason).toBe("dispatch_marker_integrity");
    expect(await guard.read(reference.organizationId)).toMatchObject({
      physicalCalls: 1,
      unresolvedReserveMicros: "801432",
    });
    await db.close();
  });
  it("reserves before return and a new guard instance observes the same unresolved slot", async () => {
    transport.rows = [row()];
    const db = runtime();
    expect(await createAIJourneyBudgetGuard(db, config(), now).authorizeDispatch(call())).toBe(
      true,
    );
    expect(
      await createAIJourneyBudgetGuard(db, config(), now).read(reference.organizationId),
    ).toMatchObject({
      physicalCalls: 1,
      unresolvedReserveMicros: "801432",
      combinedExposureMicros: "1834828",
      blocked: true,
    });
    await db.close();
  });
  it("two independent guard/worker instances cannot both authorize concurrently", async () => {
    transport.rows = [row(), row(fixtureId(19002), reference.messageId, 2)];
    const db = runtime();
    const result = await Promise.all([
      createAIJourneyBudgetGuard(db, config(), now).authorizeDispatch(call()),
      createAIJourneyBudgetGuard(db, config(), now).authorizeDispatch(
        call(fixtureId(19002), reference.messageId, 2),
      ),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(transport.rows.filter((item) => item["reservations"] === 1)).toHaveLength(1);
    expect(transport.reads.filter((sql) => /for update/iu.test(sql))).toHaveLength(2);
    await db.close();
  });
  it("commit uncertainty never returns authorization", async () => {
    transport.rows = [row()];
    transport.commitFails = true;
    const db = runtime();
    await expect(
      createAIJourneyBudgetGuard(db, config(), now).authorizeDispatch(call()),
    ).rejects.toThrow();
    expect(transport.rows[0]?.["reservations"]).toBe(0);
    await db.close();
  });
  it.each(["pending", "timeout", "missing_usage"])(
    "retains the full reserve and denies continuation for %s",
    async (kind) => {
      const first = row();
      if (kind === "pending") Object.assign(first, { reservations: 1, reserved_micros: "801432" });
      else settled(first, null);
      transport.rows = [first, row(fixtureId(19002), reference.messageId, 2)];
      const db = runtime(),
        guard = createAIJourneyBudgetGuard(db, config(), now);
      expect(await guard.authorizeDispatch(call(fixtureId(19002), reference.messageId, 2))).toBe(
        false,
      );
      expect((await guard.read(reference.organizationId)).unresolvedReserveMicros).toBe("801432");
      await db.close();
    },
  );
  it("a known successful first attempt permits a separately reserved second, never a third", async () => {
    transport.rows = [settled(row()), row(fixtureId(19002), reference.messageId, 2)];
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(db, config(), now);
    expect(await guard.authorizeDispatch(call(fixtureId(19002), reference.messageId, 2))).toBe(
      true,
    );
    settled(transport.rows[1] ?? {});
    transport.rows.push(row(fixtureId(19003), reference.messageId, 3));
    expect(await guard.authorizeDispatch(call(fixtureId(19003), reference.messageId, 3))).toBe(
      false,
    );
    await db.close();
  });
  it("reports four-message exhaustion even when cheaper calls leave money and one attempt", async () => {
    transport.rows = [
      settled(row(fixtureId(19001), message(19101))),
      settled(row(fixtureId(19002), message(19102))),
      settled(row(fixtureId(19003), message(19103))),
      settled(row(fixtureId(19004), message(19104))),
      row(fixtureId(19005), message(19105)),
    ];
    const db = runtime();
    const guard = createAIJourneyBudgetGuard(db, config(), now);
    expect(await guard.authorizeDispatch(call(fixtureId(19005), message(19105)))).toBe(false);
    expect(await guard.read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "message_limit",
      logicalMessages: 4,
      physicalCalls: 4,
      knownCostMicros: "4000",
      unresolvedReserveMicros: "0",
    });
    await db.close();
  });
  it("five physical attempts remain a hard counter across worker instances", async () => {
    transport.rows = Array.from({ length: 5 }, (_, i) =>
      settled(row(fixtureId(19001 + i), message(19101 + Math.floor(i / 2)), (i % 2) + 1)),
    );
    transport.rows.push(row(fixtureId(19007), message(19104)));
    const db = runtime();
    const guard = createAIJourneyBudgetGuard(db, config(), now);
    expect(await guard.authorizeDispatch(call(fixtureId(19007), message(19104)))).toBe(false);
    expect(await guard.read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "attempt_limit",
    });
    await db.close();
  });
  it("extends the existing ledger by one message/two slots without resetting history or blocking its repair", async () => {
    const historical = [row(fixtureId(19301)), row(fixtureId(19302))];
    const past = [
      settled(row(fixtureId(19001), message(19101)), "1950"),
      settled(row(fixtureId(19002), message(19102)), "1792"),
      settled(row(fixtureId(19003), message(19103)), "2465"),
    ];
    const before = structuredClone([...historical, ...past]);
    const fourth = row(fixtureId(19004), message(19104));
    transport.rows = [...historical, ...past, fourth];
    const db = runtime();
    const settings = { ...config(), historicalRunIds: [fixtureId(19301), fixtureId(19302)] };
    const guard = () => createAIJourneyBudgetGuard(db, settings, now);
    expect(await guard().read(reference.organizationId)).toMatchObject({
      blocked: false,
      logicalMessages: 3,
      physicalCalls: 3,
      knownCostMicros: "6207",
      combinedExposureMicros: "1039603",
      historicalReserveMicros: "1033396",
      accountingComplete: false,
    });
    expect(await guard().authorizeDispatch(call(fixtureId(19004), message(19104)))).toBe(true);
    expect(await guard().read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "dispatch_in_flight",
      physicalCalls: 4,
      unresolvedReserveMicros: "801432",
      combinedExposureMicros: "1841035",
    });
    settled(fourth, "801432");
    Object.assign(fourth, { input_units: "1048576", output_units: "4000" });
    expect(await guard().read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "message_limit",
      logicalMessages: 4,
      physicalCalls: 4,
    });
    transport.rows.push(row(fixtureId(19005), message(19105)));
    expect(await guard().authorizeDispatch(call(fixtureId(19005), message(19105)))).toBe(false);
    const repair = row(fixtureId(19006), message(19104), 2);
    transport.rows.push(repair);
    expect(await guard().authorizeDispatch(call(fixtureId(19006), message(19104), 2))).toBe(true);
    expect(await guard().read(reference.organizationId)).toMatchObject({
      physicalCalls: 5,
      logicalMessages: 4,
      combinedExposureMicros: "2642467",
      unresolvedReserveMicros: "801432",
      accountingComplete: false,
    });
    settled(repair, "801432");
    Object.assign(repair, { input_units: "1048576", output_units: "4000" });
    expect(await guard().read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "attempt_limit",
      physicalCalls: 5,
      logicalMessages: 4,
      combinedExposureMicros: "2642467",
      unresolvedReserveMicros: "0",
    });
    transport.rows.push(row(fixtureId(19007), message(19104), 3));
    expect(await guard().authorizeDispatch(call(fixtureId(19007), message(19104), 3))).toBe(false);
    expect([...historical, ...past]).toEqual(before);
    expect(historical.every((item) => item["estimated_cost_micros"] === null)).toBe(true);
    await db.close();
  });
  it.each([{ maximumCalls: 6 }, { maximumMessages: 5 }, { maximumCallsPerMessage: 3 }])(
    "rejects widening the approved extension: %o",
    (widening) => {
      expect(() =>
        createAIJourneyBudgetGuard(runtime(), { ...config(), ...widening }, now),
      ).toThrow("Invalid internal AI journey profile");
    },
  );
  it("checks current exposure + next reservation strictly below the hard ceiling", async () => {
    transport.rows = [row()];
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(db, { ...config(), hardCeilingMicros: 1_834_828n }, now);
    expect(await guard.authorizeDispatch(call())).toBe(false);
    await db.close();
  });
  it("paused, wrong conversation/tenant, missing history and expired pricing all deny", async () => {
    transport.rows = [row()];
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(db, { ...config(), mode: "paused" }, now).authorizeDispatch(
        call(),
      ),
    ).toBe(false);
    expect(
      await createAIJourneyBudgetGuard(db, config(), now).authorizeDispatch({
        ...call(),
        reference: { ...reference, conversationId: otherConversation },
      }),
    ).toBe(false);
    expect(
      await createAIJourneyBudgetGuard(
        db,
        { ...config(), historicalRunIds: [fixtureId(19301)] },
        now,
      ).authorizeDispatch(call()),
    ).toBe(false);
    expect(
      await createAIJourneyBudgetGuard(
        db,
        config(),
        () => new Date("2027-01-01T00:00:00Z"),
      ).authorizeDispatch(call()),
    ).toBe(false);
    const otherTenant = fixtureId(19401);
    if (!isSchemaValue(OrganizationIdSchema, otherTenant))
      throw new Error("Invalid synthetic tenant");
    await expect(createAIJourneyBudgetGuard(db, config(), now).read(otherTenant)).rejects.toThrow();
    await db.close();
  });
  it("historical NULLs stay NULL and lost/duplicate dispatch metadata fails closed", async () => {
    const original = row(fixtureId(19009));
    transport.rows = [original, row()];
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(
        db,
        { ...config(), historicalRunIds: [fixtureId(19009)] },
        now,
      );
    expect(await guard.authorizeDispatch(call())).toBe(true);
    expect(original["estimated_cost_micros"]).toBeNull();
    Object.assign(transport.rows[1] ?? {}, { reservations: 0, dispatch_authorized: "true" });
    expect((await guard.read(reference.organizationId)).reason).toBe("missing_dispatch_marker");
    await db.close();
  });
  it("unknown reservations remain retained when the dated price gate expires", async () => {
    transport.rows = [settled(row(), null)];
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(db, config(), () => new Date("2027-01-01T00:00:00Z")).read(
        reference.organizationId,
      ),
    ).toMatchObject({
      blocked: true,
      perCallReserveMicros: null,
      unresolvedReserveMicros: "801432",
    });
    await db.close();
  });
});

describe("S22 bounded Widget journey ledger — modelled pg transport", () => {
  const prepare = (candidate: Record<string, unknown> = widgetRow()) => {
    const previous = originalLedger();
    const candidateMessageId = candidate["trigger_message_id"];
    if (typeof candidateMessageId !== "string") throw new Error("Invalid Widget fixture message");
    transport.rows = [...previous, candidate];
    transport.widgetSession = activeWidgetSession();
    transport.widgetConversation = activeWidgetConversation();
    setWidgetInboundMessages(candidateMessageId);
    return { candidate, previous, previousCopy: structuredClone(previous) };
  };

  it("atomically latches the exact session conversation with the first reservation", async () => {
    const { candidate, previous, previousCopy } = prepare();
    const db = runtime();
    const guard = createAIJourneyBudgetGuard(db, widgetConfig(), now);
    expect(await guard.authorizeDispatch(widgetCall())).toBe(true);
    expect(transport.widgetBindings).toHaveLength(1);
    expect(transport.widgetBindings[0]).toMatchObject({
      target_id: widgetSessionId,
      widget_session_id: widgetSessionId,
      conversation_id: otherConversation,
      profile: S22_BOOKING_COHORT.profile,
    });
    expect(candidate).toMatchObject({
      reservations: 1,
      reserved_micros: "801432",
      reservation_widget_session_id: widgetSessionId,
      reservation_widget_conversation_id: otherConversation,
    });
    expect(await guard.read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "dispatch_in_flight",
      historicalReserveMicros: "1033396",
      combinedExposureMicros: "1843542",
      widget: {
        sessionId: widgetSessionId,
        conversationId: otherConversation,
        customerMessages: 1,
        physicalCalls: 1,
        logicalMessages: 1,
        knownCostMicros: "0",
        unresolvedReserveMicros: "801432",
      },
    });
    expect(previous).toEqual(previousCopy);
    expect(previous.slice(0, 2).every((value) => value["estimated_cost_micros"] === null)).toBe(
      true,
    );
    await db.close();
  });

  it("rolls back both first latch and reservation when commit is uncertain", async () => {
    const { candidate } = prepare();
    transport.commitFails = true;
    const db = runtime();
    await expect(
      createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
    ).rejects.toThrow();
    expect(transport.widgetBindings).toEqual([]);
    expect(candidate).toMatchObject({ reservations: 0, reserved_micros: null });
    await db.close();
  });

  it("serializes concurrent first authorizations across guard instances", async () => {
    const first = widgetRow();
    const second = widgetRow(fixtureId(19402), message(19502));
    prepare(first);
    transport.rows.push(second);
    setWidgetInboundMessages(message(19501), message(19502));
    const db = runtime();
    const results = await Promise.all([
      createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
      createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(
        widgetCall(fixtureId(19402), message(19502)),
      ),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(transport.widgetBindings).toHaveLength(1);
    expect([first, second].filter((value) => value["reservations"] === 1)).toHaveLength(1);
    const locks = transport.reads.filter((sql) =>
      /from conversations[\s\S]*for update/iu.test(sql),
    );
    expect(locks.length).toBeGreaterThanOrEqual(2);
    await db.close();
  });

  it("does not let a changed configuration reset an existing global profile latch", async () => {
    const candidate = widgetRow();
    prepare(candidate);
    bindWidget();
    const replacementSessionId = fixtureId(19204);
    transport.widgetSession = { ...activeWidgetSession(), id: replacementSessionId };
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(
        db,
        { ...widgetConfig(), widgetSessionId: replacementSessionId },
        now,
      ).authorizeDispatch(widgetCall()),
    ).toBe(false);
    expect(transport.widgetBindings).toHaveLength(1);
    expect(candidate["reservations"]).toBe(0);
    expect(
      transport.reads.some(
        (sql) => /target_type='widget_session'/iu.test(sql) && /limit\s+2/iu.test(sql),
      ),
    ).toBe(true);
    await db.close();
  });

  it("fails closed for duplicate or conversation-mismatched immutable latches", async () => {
    const candidate = widgetRow();
    prepare(candidate);
    bindWidget();
    transport.widgetBindings.push({ ...transport.widgetBindings[0], id: fixtureId(19602) });
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
    ).toBe(false);
    expect(candidate["reservations"]).toBe(0);
    transport.widgetBindings = [
      { ...transport.widgetBindings[0], conversation_id: reference.conversationId },
    ];
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
    ).toBe(false);
    expect(candidate["reservations"]).toBe(0);
    await db.close();
  });

  it.each([
    ["missing", null],
    ["wrong exact session", { ...activeWidgetSession(), id: fixtureId(19204) }],
    ["unbound", { ...activeWidgetSession(), conversation_id: null }],
    ["contactless", { ...activeWidgetSession(), contact_id: null }],
    ["expired state", { ...activeWidgetSession(), status: "expired" }],
    ["revoked", { ...activeWidgetSession(), status: "revoked", revoked_at: now() }],
    ["absolute expiry", { ...activeWidgetSession(), expires_at: now() }],
    ["idle expiry", { ...activeWidgetSession(), last_seen_at: new Date("2026-10-05T19:29:59Z") }],
    ["wrong channel", { ...activeWidgetSession(), channel_type: "instagram" }],
    ["disabled connection", { ...activeWidgetSession(), channel_status: "disabled" }],
    ["absent origin", { ...activeWidgetSession(), origin_status: null }],
    ["disabled origin", { ...activeWidgetSession(), origin_status: "disabled" }],
  ] as const)("denies an ineligible bound Widget session: %s", async (_kind, session) => {
    const { candidate } = prepare();
    transport.widgetSession = session;
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
    ).toBe(false);
    expect(candidate["reservations"]).toBe(0);
    expect(transport.widgetBindings).toEqual([]);
    await db.close();
  });

  it("denies when the session contact does not own the bound conversation", async () => {
    const { candidate } = prepare();
    transport.widgetSession = { ...activeWidgetSession(), contact_id: fixtureId(19205) };
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
    ).toBe(false);
    expect(candidate["reservations"]).toBe(0);
    expect(transport.widgetBindings).toEqual([]);
    await db.close();
  });

  it.each(["blocked", "anonymized"] as const)(
    "denies an inactive Widget contact before latch or reservation: %s",
    async (status) => {
      const { candidate } = prepare();
      transport.widgetContactStatus = status;
      const db = runtime();
      expect(
        await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
      ).toBe(false);
      expect(candidate["reservations"]).toBe(0);
      expect(transport.widgetBindings).toEqual([]);
      await db.close();
    },
  );

  it.each(["absent", "foreign tenant", "foreign conversation"] as const)(
    "denies a Widget candidate missing from scoped inbound metadata: %s",
    async (scope) => {
      const { candidate } = prepare();
      if (scope === "absent") transport.widgetInboundMessages = [];
      else if (scope === "foreign tenant")
        transport.widgetInboundMessages[0]!["organization_id"] = fixtureId(19206);
      else transport.widgetInboundMessages[0]!["conversation_id"] = reference.conversationId;
      const db = runtime();
      expect(
        await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
      ).toBe(false);
      expect(candidate["reservations"]).toBe(0);
      expect(transport.widgetBindings).toEqual([]);
      await db.close();
    },
  );

  it("counts a free confirmation as the second customer message and rejects a third inbound", async () => {
    const firstMessage = message(19501);
    const confirmation = message(19502);
    const thirdMessage = message(19503);
    const first = widgetRow(fixtureId(19401), firstMessage);
    prepare(first);
    const db = runtime();
    const guard = createAIJourneyBudgetGuard(db, widgetConfig(), now);
    expect(await guard.authorizeDispatch(widgetCall(fixtureId(19401), firstMessage))).toBe(true);
    markWidgetReservation(settled(first, "1"));

    setWidgetInboundMessages(firstMessage, confirmation);
    expect(await guard.read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "message_limit",
      widget: {
        customerMessages: 2,
        logicalMessages: 1,
      },
    });
    const inboundRead = transport.reads.find((sql) => /from messages/iu.test(sql));
    expect(inboundRead).toMatch(/organization_id\s*=\s*\$1/iu);
    expect(inboundRead).toMatch(/conversation_id\s*=\s*\$2/iu);
    expect(inboundRead).toMatch(/direction\s*=\s*'inbound'/iu);
    expect(inboundRead).toMatch(/order by\s+sequence_no/iu);
    expect(inboundRead).toMatch(/limit\s+3/iu);
    expect(inboundRead).not.toMatch(/body|ciphertext|content/iu);

    const latchesBeforeThird = transport.widgetBindings.length;
    const reservationsBeforeThird = transport.rows.filter(
      (item) => item["reservations"] === 1,
    ).length;
    expect(latchesBeforeThird).toBe(1);
    expect(reservationsBeforeThird).toBe(5);
    const third = widgetRow(fixtureId(19402), thirdMessage);
    transport.rows.push(third);
    setWidgetInboundMessages(firstMessage, confirmation, thirdMessage);
    expect(await guard.authorizeDispatch(widgetCall(fixtureId(19402), thirdMessage))).toBe(false);
    expect(third["reservations"]).toBe(0);
    expect(transport.widgetBindings).toHaveLength(latchesBeforeThird);
    expect(transport.rows.filter((item) => item["reservations"] === 1)).toHaveLength(
      reservationsBeforeThird,
    );
    expect(await guard.read(reference.organizationId)).toMatchObject({
      blocked: true,
      reason: "message_limit",
      widget: { customerMessages: 3, logicalMessages: 1 },
    });
    await db.close();
  });

  it("does not revive the original lane after downgrading from a committed Widget slot", async () => {
    const { candidate } = prepare();
    const retry = row(fixtureId(19007), message(19104), 2);
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(widgetCall()),
    ).toBe(true);
    transport.rows.push(retry);
    const originalConfiguration = {
      ...config(),
      historicalRunIds: [...historicalRunIds],
    };
    expect(
      await createAIJourneyBudgetGuard(db, originalConfiguration, now).authorizeDispatch(
        call(fixtureId(19007), message(19104), 2),
      ),
    ).toBe(false);
    expect(candidate["reservations"]).toBe(1);
    expect(retry["reservations"]).toBe(0);
    expect(transport.widgetBindings).toHaveLength(1);
    await db.close();
  });

  it("allows the fourth full reservation at the exact inclusive cap, then denies all widening", async () => {
    const firstMessage = message(19501);
    const secondMessage = message(19502);
    const previous = originalLedger();
    const widgetRuns = [
      markWidgetReservation(settled(widgetRow(fixtureId(19401), firstMessage, 1), "801432")),
      markWidgetReservation(settled(widgetRow(fixtureId(19402), firstMessage, 2), "801432")),
      markWidgetReservation(settled(widgetRow(fixtureId(19403), secondMessage, 1), "801432")),
    ];
    const fourth = widgetRow(fixtureId(19404), secondMessage, 2);
    transport.rows = [...previous, ...widgetRuns, fourth];
    transport.widgetSession = activeWidgetSession();
    setWidgetInboundMessages(firstMessage, secondMessage);
    bindWidget();
    const db = runtime();
    const guard = createAIJourneyBudgetGuard(db, widgetConfig(), now);
    expect(await guard.authorizeDispatch(widgetCall(fixtureId(19404), secondMessage, 2))).toBe(
      true,
    );
    expect(await guard.read(reference.organizationId)).toMatchObject({
      combinedExposureMicros: S22_WIDGET_ALLOWANCE.maximumCombinedExposureMicros.toString(),
      widget: {
        customerMessages: 2,
        physicalCalls: 4,
        logicalMessages: 2,
        knownCostMicros: "2404296",
        unresolvedReserveMicros: "801432",
      },
    });
    markWidgetReservation(settled(fourth, "801432"));
    const fifth = widgetRow(fixtureId(19405), message(19503));
    const thirdAttempt = widgetRow(fixtureId(19406), secondMessage, 3);
    transport.rows.push(fifth, thirdAttempt);
    expect(await guard.authorizeDispatch(widgetCall(fixtureId(19405), message(19503)))).toBe(false);
    expect(await guard.authorizeDispatch(widgetCall(fixtureId(19406), secondMessage, 3))).toBe(
      false,
    );
    expect(await guard.read(reference.organizationId)).toMatchObject({
      blocked: true,
      combinedExposureMicros: "4247838",
      widget: {
        customerMessages: 2,
        physicalCalls: 4,
        logicalMessages: 2,
        knownCostMicros: "3205728",
        unresolvedReserveMicros: "0",
      },
    });
    await db.close();
  });

  it("enforces two calls per message and two logical messages independently of money", async () => {
    const firstMessage = message(19501);
    const secondMessage = message(19502);
    transport.widgetSession = activeWidgetSession();
    bindWidget();
    const db = runtime();

    transport.rows = [
      ...originalLedger(),
      markWidgetReservation(settled(widgetRow(fixtureId(19401), firstMessage, 1), "1")),
      markWidgetReservation(settled(widgetRow(fixtureId(19402), firstMessage, 2), "1")),
      widgetRow(fixtureId(19403), firstMessage, 3),
    ];
    setWidgetInboundMessages(firstMessage);
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(
        widgetCall(fixtureId(19403), firstMessage, 3),
      ),
    ).toBe(false);

    transport.rows = [
      ...originalLedger(),
      markWidgetReservation(settled(widgetRow(fixtureId(19404), firstMessage), "1")),
      markWidgetReservation(settled(widgetRow(fixtureId(19405), secondMessage), "1")),
      widgetRow(fixtureId(19406), message(19503)),
    ];
    setWidgetInboundMessages(firstMessage, secondMessage, message(19503));
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(
        widgetCall(fixtureId(19406), message(19503)),
      ),
    ).toBe(false);
    await db.close();
  });

  it.each(["in_flight", "unknown_cost"] as const)(
    "retains the full Widget reserve across restart for %s",
    async (kind) => {
      const first = widgetRow();
      if (kind === "in_flight")
        markWidgetReservation(Object.assign(first, { reservations: 1, reserved_micros: "801432" }));
      else markWidgetReservation(settled(first, null));
      const repair = widgetRow(fixtureId(19402), message(19501), 2);
      transport.rows = [...originalLedger(), first, repair];
      transport.widgetSession = activeWidgetSession();
      setWidgetInboundMessages(message(19501));
      bindWidget();
      const db = runtime();
      expect(
        await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(
          widgetCall(fixtureId(19402), message(19501), 2),
        ),
      ).toBe(false);
      expect(
        await createAIJourneyBudgetGuard(db, widgetConfig(), now).read(reference.organizationId),
      ).toMatchObject({
        blocked: true,
        widget: { physicalCalls: 1, unresolvedReserveMicros: "801432" },
      });
      expect(repair["reservations"]).toBe(0);
      await db.close();
    },
  );

  it("freezes the old four-call/8,714-micro ledger and historical NULL reserve", async () => {
    const candidate = widgetRow();
    const { previous, previousCopy } = prepare(candidate);
    const db = runtime();
    const guard = createAIJourneyBudgetGuard(db, widgetConfig(), now);
    expect(await guard.authorizeDispatch(widgetCall())).toBe(true);
    expect(previous).toEqual(previousCopy);
    expect(
      await guard.authorizeDispatch({
        ...call(fixtureId(19007), message(19104), 2),
        reference: { ...reference, messageId: message(19104) },
      }),
    ).toBe(false);

    const resetCandidate = widgetRow(fixtureId(19402), message(19502));
    transport.rows = [...originalLedger().slice(0, -1), resetCandidate];
    setWidgetInboundMessages(message(19502));
    transport.widgetBindings = [];
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(
        widgetCall(fixtureId(19402), message(19502)),
      ),
    ).toBe(false);
    expect(resetCandidate["reservations"]).toBe(0);

    const changedHistory = originalLedger();
    changedHistory[0]!["estimated_cost_micros"] = "0";
    const historyCandidate = widgetRow(fixtureId(19403), message(19503));
    transport.rows = [...changedHistory, historyCandidate];
    setWidgetInboundMessages(message(19503));
    expect(
      await createAIJourneyBudgetGuard(db, widgetConfig(), now).authorizeDispatch(
        widgetCall(fixtureId(19403), message(19503)),
      ),
    ).toBe(false);
    expect(historyCandidate["reservations"]).toBe(0);
    await db.close();
  });
});
