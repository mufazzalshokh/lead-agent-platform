import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Pg from "pg";
import {
  S22_BOOKING_COHORT,
  S22_WIDGET_ALLOWANCE,
  S22_WIDGET_SELECTION_ENVELOPE,
  createTenantDatabaseRuntimeConfig,
} from "../../packages/config/src/index.js";
import { AI_REFERENCE, fixtureId } from "./fixtures.js";
import {
  createAIJourneyBudgetGuard,
  createS22WidgetCohortStore,
  createTenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  isSchemaValue,
  OrganizationIdSchema,
  MessageIdSchema,
  ConversationIdSchema,
  MembershipIdSchema,
  UserIdSchema,
  ResourceIdSchema,
} from "../../packages/contracts/src/index.js";
import {
  resolveAuthorizationContext,
  type MembershipRole,
} from "../../packages/security/src/index.js";

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
    ownerSelections: [] as Record<string, unknown>[],
    widgetSessions: [] as Record<string, unknown>[],
    anchorSession: null as Record<string, unknown> | null,
    memberships: [] as Record<string, unknown>[],
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
            if (/from memberships/iu.test(sql))
              return {
                rows: transport.memberships
                  .filter(
                    (row) => row["organization_id"] === organization && row["id"] === values[1],
                  )
                  .map((row) => ({ ...row })),
              };
            if (/from audit_events/iu.test(sql) && values.includes("ai_run.widget_cohort_selected"))
              return {
                rows: transport.ownerSelections
                  .filter(
                    (row) =>
                      row["organization_id"] === organization &&
                      row["target_id"] === values[2] &&
                      row["profile"] === values[3],
                  )
                  .map((row) => ({ ...row })),
              };
            if (/from widget_sessions/iu.test(sql) && /as session_version/iu.test(sql)) {
              const freshBoundary = values[3],
                at = values[4],
                idleBoundary = values[5];
              if (
                !(freshBoundary instanceof Date) ||
                !(at instanceof Date) ||
                !(idleBoundary instanceof Date)
              )
                throw new Error("Missing bounded Widget selection time");
              return {
                rows: transport.widgetSessions
                  .filter(
                    (row) =>
                      row["organization_id"] === organization &&
                      row["channel_connection_id"] === values[1] &&
                      row["widget_allowed_origin_id"] === values[2] &&
                      (values[6] === undefined || row["id"] === values[6]) &&
                      row["status"] === "active" &&
                      row["revoked_at"] === null &&
                      (row["version"] === 2 || row["version"] === "2" || row["version"] === 2n) &&
                      row["conversation_id"] === null &&
                      row["contact_id"] === null &&
                      row["issued_at"] instanceof Date &&
                      row["issued_at"] > freshBoundary &&
                      row["issued_at"] <= at &&
                      row["expires_at"] instanceof Date &&
                      row["expires_at"] > at &&
                      row["last_seen_at"] instanceof Date &&
                      row["last_seen_at"] > idleBoundary &&
                      row["channel_status"] === "active" &&
                      row["channel_type"] === "widget" &&
                      row["origin_status"] === "active",
                  )
                  .slice(0, 5)
                  .map((row) => ({
                    session_id: row["id"],
                    session_version: row["version"],
                    issued_at: row["issued_at"],
                    idle_deadline: new Date(
                      row["last_seen_at"] instanceof Date
                        ? row["last_seen_at"].getTime() + 1_800_000
                        : 0,
                    ),
                    expires_at: row["expires_at"],
                  })),
              };
            }
            if (/from widget_sessions/iu.test(sql) && !/join channel_connections/iu.test(sql))
              return {
                rows: [
                  ...transport.widgetSessions,
                  ...(transport.anchorSession === null ? [] : [transport.anchorSession]),
                ]
                  .filter(
                    (row) =>
                      row["organization_id"] === organization &&
                      row["id"] === values[1] &&
                      row["channel_connection_id"] === values[2] &&
                      row["widget_allowed_origin_id"] === values[3],
                  )
                  .slice(0, 1)
                  .map((row) => ({ ...row })),
              };
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
              const widget =
                transport.widgetSessions.find((row) => row["id"] === values[1]) ??
                transport.widgetSession;
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
                  (values[4] === undefined || widget["channel_connection_id"] === values[4]) &&
                  (values[5] === undefined || widget["widget_allowed_origin_id"] === values[5]) &&
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
              if (action === "ai_run.widget_cohort_selected") {
                const encoded = values[8];
                if (typeof encoded !== "string") throw new Error("Invalid selection metadata");
                const metadata: unknown = JSON.parse(encoded);
                if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))
                  throw new Error("Invalid selection metadata");
                const selection = Object.fromEntries(
                  Object.entries(metadata).map(([key, value]) => [
                    key,
                    typeof value === "number" ? String(value) : value,
                  ]),
                );
                writes.push(() => {
                  transport.ownerSelections.push({
                    ...selection,
                    organization_id: organization,
                    target_id: values[5],
                    actor_type: "member",
                    actor_id: values[3],
                    actor_membership_id: values[4],
                    request_id: values[6],
                    correlation_id: values[7],
                  });
                });
                return { rows: [], rowCount: 1 };
              }
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
  transport.ownerSelections = [];
  transport.widgetSessions = [];
  transport.anchorSession = null;
  transport.memberships = [];
});

const selectionClock = () => new Date("2026-10-08T17:50:00Z");
const selectedConfig = () => ({
  ...S22_BOOKING_COHORT,
  mode: "widget_booking" as const,
  widgetSessionId: S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId,
});
const owner = async (index = 19701, role: MembershipRole = "owner") => {
  const organizationId = S22_BOOKING_COHORT.organizationId,
    userId = fixtureId(index),
    membershipId = fixtureId(index + 100);
  if (
    !isSchemaValue(OrganizationIdSchema, organizationId) ||
    !isSchemaValue(UserIdSchema, userId) ||
    !isSchemaValue(MembershipIdSchema, membershipId)
  )
    throw new Error("Invalid owner fixture");
  transport.memberships.push({
    organization_id: organizationId,
    id: membershipId,
    user_id: userId,
    role,
    status: "active",
    location_scope: "all",
  });
  const at = selectionClock();
  return resolveAuthorizationContext(
    {
      absoluteExpiresAt: new Date(at.getTime() + 3_600_000),
      authenticationLevel: "mfa",
      authenticationTime: at,
      createdAt: at,
      idleExpiresAt: new Date(at.getTime() + 3_600_000),
      lastSeenAt: at,
      rotatedAt: at,
      rotationDue: false,
      sessionId: fixtureId(index + 200),
      userId,
    },
    organizationId,
    {
      resolveCurrentMembership: () =>
        Promise.resolve({
          organizationId,
          userId,
          membershipId,
          role,
          status: "active",
          locationScope: "all",
          allowedLocationIds: [],
        }),
    },
  );
};
const initializeSelectionLedger = () => {
  transport.anchorSession = {
    ...freshSelectionSession(S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId),
    issued_at: new Date("2026-10-08T16:11:39Z"),
    last_seen_at: new Date("2026-10-08T16:11:40Z"),
    expires_at: new Date("2026-10-08T18:11:39Z"),
  };
  transport.mutexConversationId = S22_BOOKING_COHORT.conversationId;
  transport.rows = originalLedger().map((value, index) => ({
    ...value,
    id: index < 2 ? S22_BOOKING_COHORT.historicalRunIds[index] : value["id"],
    organization_id: S22_BOOKING_COHORT.organizationId,
    conversation_id: S22_BOOKING_COHORT.conversationId,
  }));
  transport.widgetConversation = {
    ...activeWidgetConversation(),
    organization_id: S22_BOOKING_COHORT.organizationId,
  };
};
const freshSelectionSession = (id: string = widgetSessionId): Record<string, unknown> => ({
  ...activeWidgetSession(),
  id,
  organization_id: S22_BOOKING_COHORT.organizationId,
  channel_connection_id: S22_WIDGET_SELECTION_ENVELOPE.channelConnectionId,
  widget_allowed_origin_id: S22_WIDGET_SELECTION_ENVELOPE.allowedOriginId,
  conversation_id: null,
  contact_id: null,
  version: 2,
  issued_at: new Date("2026-10-08T17:49:00Z"),
  last_seen_at: new Date("2026-10-08T17:49:01Z"),
  expires_at: new Date("2026-10-08T19:49:00Z"),
});
const selectionBody = (sessionId: unknown = widgetSessionId, version = 0) => {
  if (!isSchemaValue(ResourceIdSchema, sessionId)) throw new Error("Invalid selection fixture");
  return {
    session_id: sessionId,
    expected_session_version: 2 as const,
    expected_selection_version: version,
  };
};
const selectCommand = async (sessionId: string = widgetSessionId, version = 0) => ({
  actor: await owner(),
  body: selectionBody(sessionId, version),
  requestId: "test:selection",
  correlationId: fixtureId(19981),
});
const selectedCall = () => {
  const organizationId = S22_BOOKING_COHORT.organizationId;
  if (!isSchemaValue(OrganizationIdSchema, organizationId))
    throw new Error("Invalid organization fixture");
  return { ...widgetCall(), reference: { ...widgetCall().reference, organizationId } };
};
const bindSelectedSession = () => {
  const selected = transport.widgetSessions[0];
  if (selected === undefined) throw new Error("Missing selected session");
  Object.assign(selected, {
    conversation_id: otherConversation,
    contact_id: widgetContactId,
    version: 3,
  });
  setWidgetInboundMessages(message(19501));
  transport.widgetInboundMessages = transport.widgetInboundMessages.map((value) => ({
    ...value,
    organization_id: S22_BOOKING_COHORT.organizationId,
  }));
  transport.rows.push({ ...widgetRow(), organization_id: S22_BOOKING_COHORT.organizationId });
};

describe("S22 audited owner selection — modelled pg transport, no live/provider calls", () => {
  it("blocks before selection; a fresh session created after Worker startup can be selected without redeployment", async () => {
    initializeSelectionLedger();
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(db, selectedConfig(), selectionClock, {
        ownerSelection: true,
      });
    expect(await guard.read((await owner()).organizationId)).toMatchObject({
      blocked: true,
      reason: "widget_selection_required",
    });
    transport.widgetSessions = [freshSelectionSession()];
    const before = structuredClone(transport.rows),
      sessionBefore = structuredClone(transport.widgetSessions);
    const command = await selectCommand();
    expect(await guard.widgetCohortStore.select(command)).toEqual({
      selection_version: 1,
      selected_session_id: widgetSessionId,
    });
    expect(transport.rows).toEqual(before);
    expect(transport.widgetSessions).toEqual(sessionBefore);
    expect(transport.ownerSelections[0]).toMatchObject({
      actor_type: "member",
      actor_id: command.actor.userId,
      actor_membership_id: command.actor.membershipId,
      request_id: "test:selection",
      correlation_id: fixtureId(19981),
    });
    expect(await guard.widgetCohortStore.get({ actor: command.actor })).toMatchObject({
      blocked: false,
      can_select: true,
      selected_session_id: widgetSessionId,
      known_cost_micros: "8714",
      combined_exposure_micros: "1042110",
      unresolved_reserve_micros: "0",
    });
    bindSelectedSession();
    // Old unchanged static binding cannot spend on the later, explicitly selected SID.
    expect(
      await createAIJourneyBudgetGuard(db, selectedConfig(), selectionClock).authorizeDispatch(
        selectedCall(),
      ),
    ).toBe(false);
    expect(await guard.authorizeDispatch(selectedCall())).toBe(true);
    expect(transport.widgetBindings).toHaveLength(1);
    expect(await guard.widgetCohortStore.get({ actor: command.actor })).toMatchObject({
      can_select: false,
      blocked: true,
      reason: "dispatch_in_flight",
    });
    expect(
      transport.rows.slice(0, 2).every((value) => value["estimated_cost_micros"] === null),
    ).toBe(true);
    await db.close();
  });
  it.each(["2", 2n])(
    "normalizes PostgreSQL candidate version %s without changing the session",
    async (version) => {
      initializeSelectionLedger();
      transport.widgetSessions = [{ ...freshSelectionSession(), version }];
      const db = runtime(),
        store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock),
        command = await selectCommand(),
        before = structuredClone(transport.widgetSessions);
      const status = await store.get({ actor: command.actor });
      expect(status.candidates).toEqual([
        {
          session_id: widgetSessionId,
          session_version: 2,
          issued_at: "2026-10-08T17:49:00.000Z",
          idle_deadline: "2026-10-08T18:19:01.000Z",
          expires_at: "2026-10-08T19:49:00.000Z",
        },
      ]);
      expect(await store.select(command)).toEqual({
        selection_version: 1,
        selected_session_id: widgetSessionId,
      });
      expect(transport.widgetSessions).toEqual(before);
      expect(transport.ownerSelections).toHaveLength(1);
      await db.close();
    },
  );
  it("same-actor duplicate acknowledges exactly one audit, without renewing or reselecting", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession()];
    const db = runtime(),
      store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock),
      command = await selectCommand();
    const receipt = await store.select(command);
    const before = structuredClone(transport.widgetSessions);
    expect(await store.select({ ...command, requestId: "test:retry" })).toEqual(receipt);
    expect(transport.ownerSelections).toHaveLength(1);
    expect(transport.widgetSessions).toEqual(before);
    await expect(
      store.select({ ...command, body: selectionBody(widgetSessionId, 1) }),
    ).rejects.toMatchObject({ code: "selection_conflict" });
    await db.close();
  });
  it("concurrent owners with the same predecessor cannot both select", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession(), freshSelectionSession(fixtureId(19801))];
    const db = runtime(),
      store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock);
    const first = await selectCommand(),
      second = { ...(await selectCommand(fixtureId(19801))), actor: await owner(19901) };
    const result = await Promise.allSettled([store.select(first), store.select(second)]);
    expect(result.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(transport.ownerSelections).toHaveLength(1);
    await db.close();
  });
  it("allows explicit unused expired selection replacement, but never revival or automatic newest selection", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession()];
    const db = runtime(),
      store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock),
      command = await selectCommand();
    await store.select(command);
    const old = transport.widgetSessions[0];
    if (old === undefined) throw new Error("Missing fixture");
    old["last_seen_at"] = new Date("2026-10-08T17:19:00Z");
    transport.widgetSessions.push(freshSelectionSession(fixtureId(19801)));
    expect(await store.get({ actor: command.actor })).toMatchObject({
      blocked: true,
      reason: "widget_session_unavailable",
      can_select: true,
      selected_session_id: widgetSessionId,
    });
    const oldBefore = structuredClone(old);
    await store.select({ ...command, body: selectionBody(fixtureId(19801), 1) });
    expect(old).toEqual(oldBefore);
    expect(transport.ownerSelections).toHaveLength(2);
    await db.close();
  });
  it.each([
    ["foreign tenant", { organization_id: fixtureId(19801) }],
    ["foreign channel", { channel_connection_id: fixtureId(19801) }],
    ["foreign origin", { widget_allowed_origin_id: fixtureId(19801) }],
    ["expired", { expires_at: new Date("2026-10-08T17:50:00Z") }],
    ["idle boundary", { last_seen_at: new Date("2026-10-08T17:20:00Z") }],
    ["stale creation", { issued_at: new Date("2026-10-08T17:45:00Z") }],
    ["future creation", { issued_at: new Date("2026-10-08T17:51:00Z") }],
    ["bound", { conversation_id: otherConversation, contact_id: widgetContactId }],
    ["unredeemed", { version: 1 }],
    ["revoked", { revoked_at: selectionClock() }],
    ["inactive channel", { channel_status: "disconnected" }],
    ["inactive origin", { origin_status: "revoked" }],
  ])("rejects %s without selection or ledger writes", async (_label, override) => {
    initializeSelectionLedger();
    transport.widgetSessions = [{ ...freshSelectionSession(), ...override }];
    const db = runtime(),
      store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock),
      before = structuredClone(transport.rows);
    await expect(store.select(await selectCommand())).rejects.toMatchObject({
      code: "selection_conflict",
    });
    expect(transport.ownerSelections).toHaveLength(0);
    expect(transport.rows).toEqual(before);
    await db.close();
  });
  it("blocks replacement once intake bound a conversation, even before a paid reservation", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession(), freshSelectionSession(fixtureId(19801))];
    const db = runtime(),
      store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock),
      command = await selectCommand();
    await store.select(command);
    bindSelectedSession();
    await expect(
      store.select({ ...command, body: selectionBody(fixtureId(19801), 1) }),
    ).rejects.toMatchObject({ code: "cohort_blocked" });
    expect(transport.ownerSelections).toHaveLength(1);
    await db.close();
  });
  it("does not select on unknown original cost, mutated historical cost, pending reserve or missing baseline", async () => {
    const db = runtime();
    for (const fault of ["unknown", "historical", "pending", "missing"]) {
      initializeSelectionLedger();
      transport.widgetSessions = [freshSelectionSession()];
      const target = transport.rows[fault === "historical" ? 0 : 2];
      if (target === undefined) throw new Error("Missing fixture");
      if (fault === "unknown") target["estimated_cost_micros"] = null;
      if (fault === "historical") target["estimated_cost_micros"] = "0";
      if (fault === "pending") target["finished_at"] = null;
      if (fault === "missing") transport.rows.shift();
      await expect(
        createS22WidgetCohortStore(db, selectedConfig(), selectionClock).select(
          await selectCommand(),
        ),
      ).rejects.toMatchObject({ code: "cohort_blocked" });
      expect(transport.ownerSelections).toHaveLength(0);
    }
    await db.close();
  });
  it("rechecks live owner membership and rejects admin, revoked owner and forged actor", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession()];
    const db = runtime(),
      store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock);
    await expect(
      store.select({ ...(await selectCommand()), actor: await owner(19901, "admin") }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const command = await selectCommand();
    transport.memberships = transport.memberships.map((value) => ({ ...value, status: "revoked" }));
    await expect(store.select(command)).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      store.get({ actor: { ...command.actor, organizationId: AI_REFERENCE.organizationId } }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(transport.ownerSelections).toHaveLength(0);
    await db.close();
  });
  it("selection commit uncertainty never returns success or changes authority", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession()];
    transport.commitFails = true;
    const db = runtime();
    await expect(
      createS22WidgetCohortStore(db, selectedConfig(), selectionClock).select(
        await selectCommand(),
      ),
    ).rejects.toThrow();
    expect(transport.ownerSelections).toHaveLength(0);
    await db.close();
  });
});

describe("S22 selected dispatch contention — modelled transport, not PostgreSQL locks", () => {
  it("does not abandon an already-bound anchor before its first provider reservation", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession()];
    const anchor = transport.anchorSession;
    if (anchor === null) throw new Error("Missing anchor fixture");
    Object.assign(anchor, {
      conversation_id: otherConversation,
      contact_id: widgetContactId,
      version: 3,
    });
    const before = structuredClone(transport.rows),
      db = runtime(),
      store = createS22WidgetCohortStore(db, selectedConfig(), selectionClock);
    const command = await selectCommand();
    await expect(store.select(command)).rejects.toMatchObject({ code: "cohort_blocked" });
    expect(await store.get({ actor: command.actor })).toMatchObject({
      can_select: false,
      blocked: true,
      reason: "widget_already_bound",
    });
    expect(transport.ownerSelections).toHaveLength(0);
    expect(transport.rows).toEqual(before);
    await db.close();
  });
  it("missing owner audit never falls back to a live configured anchor", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [
      freshSelectionSession(S22_WIDGET_SELECTION_ENVELOPE.anchorSessionId),
    ];
    bindSelectedSession();
    const db = runtime();
    expect(
      await createAIJourneyBudgetGuard(db, selectedConfig(), selectionClock, {
        ownerSelection: true,
      }).authorizeDispatch(selectedCall()),
    ).toBe(false);
    expect(transport.rows.at(-1)?.["reservations"]).toBe(0);
    await db.close();
  });
  it("duplicate concurrent dispatch reserves one physical attempt under the same owner-selection mutex", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession()];
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(db, selectedConfig(), selectionClock, {
        ownerSelection: true,
      });
    await guard.widgetCohortStore.select(await selectCommand());
    bindSelectedSession();
    const result = await Promise.all([
      guard.authorizeDispatch(selectedCall()),
      createAIJourneyBudgetGuard(db, selectedConfig(), selectionClock, {
        ownerSelection: true,
      }).authorizeDispatch(selectedCall()),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(transport.widgetBindings).toHaveLength(1);
    expect(transport.rows.at(-1)?.["reservations"]).toBe(1);
    await db.close();
  });
  it("concurrent replacement cannot retarget a bound dispatch or reset consumed accounting", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession(), freshSelectionSession(fixtureId(19801))];
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(db, selectedConfig(), selectionClock, {
        ownerSelection: true,
      }),
      command = await selectCommand();
    await guard.widgetCohortStore.select(command);
    bindSelectedSession();
    const result = await Promise.allSettled([
      guard.widgetCohortStore.select({ ...command, body: selectionBody(fixtureId(19801), 1) }),
      guard.authorizeDispatch(selectedCall()),
    ]);
    expect(result[0]).toMatchObject({ status: "rejected", reason: { code: "cohort_blocked" } });
    expect(result[1]).toMatchObject({ status: "fulfilled", value: true });
    expect(transport.ownerSelections).toHaveLength(1);
    expect(transport.widgetBindings).toHaveLength(1);
    const paid = transport.rows.at(-1);
    if (paid === undefined) throw new Error("Missing fixture");
    settled(paid, "1000");
    expect(await guard.widgetCohortStore.get({ actor: command.actor })).toMatchObject({
      can_select: false,
      known_cost_micros: "9714",
      unresolved_reserve_micros: "0",
    });
    await expect(
      guard.widgetCohortStore.select({ ...command, body: selectionBody(fixtureId(19801), 1) }),
    ).rejects.toMatchObject({ code: "cohort_blocked" });
    await db.close();
  });
  it("corrupt or ambiguous audit version chains fail closed without provider reservation", async () => {
    initializeSelectionLedger();
    transport.widgetSessions = [freshSelectionSession()];
    const db = runtime(),
      guard = createAIJourneyBudgetGuard(db, selectedConfig(), selectionClock, {
        ownerSelection: true,
      });
    await guard.widgetCohortStore.select(await selectCommand());
    bindSelectedSession();
    const selected = transport.ownerSelections[0];
    if (selected === undefined) throw new Error("Missing fixture");
    selected["selection_version"] = "2";
    await expect(guard.authorizeDispatch(selectedCall())).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(transport.rows.at(-1)?.["reservations"]).toBe(0);
    await db.close();
  });
  it("requires the reviewed org, anchor and original historical reserve for dynamic mode", () => {
    const db = runtime();
    for (const override of [
      { widgetSessionId: widgetSessionId },
      { organizationId: reference.organizationId },
      { historicalReserveMicros: 0n },
      { historicalRunIds: [] },
    ])
      expect(() =>
        createAIJourneyBudgetGuard(db, { ...selectedConfig(), ...override }, selectionClock, {
          ownerSelection: true,
        }),
      ).toThrow("Invalid internal Widget selection envelope");
  });
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
