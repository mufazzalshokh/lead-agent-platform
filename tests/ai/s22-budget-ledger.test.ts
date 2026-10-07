import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Pg from "pg";
import {
  S22_BOOKING_COHORT,
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
            if (/from conversations/iu.test(sql)) {
              const previous = transport.tail;
              transport.tail = new Promise<void>((resolve) => {
                unlock = resolve;
              });
              await previous;
              return {
                rows: [{ id: values[1], status: "open", automation_mode: "ai", version: 1 }],
              };
            }
            if (/from ai_runs r/iu.test(sql))
              return {
                rows: transport.rows
                  .filter((row) => row["organization_id"] === organization)
                  .map((row) => ({ ...row })),
              };
            if (/^insert into audit_events/iu.test(sql.trim())) {
              const row = transport.rows.find(
                (item) => item["id"] === values[3] && item["organization_id"] === organization,
              );
              if (row === undefined) throw new Error("Unknown synthetic audit target");
              const text = values[6];
              if (typeof text !== "string") throw new Error("Invalid synthetic metadata");
              const metadata: unknown = JSON.parse(text);
              if (
                typeof metadata !== "object" ||
                metadata === null ||
                !("reservation_micros" in metadata)
              )
                throw new Error("Missing reservation metadata");
              const reservation = metadata.reservation_micros;
              writes.push(() => {
                row["reservations"] = 1;
                row["reserved_micros"] = reservation;
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
const row = (
  id = fixtureId(19001),
  message: string = reference.messageId,
  attempt = 1,
): Record<string, unknown> => ({
  organization_id: reference.organizationId,
  id,
  conversation_id: reference.conversationId,
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
beforeEach(() => {
  transport.rows = [];
  transport.tail = Promise.resolve();
  transport.commitFails = false;
  transport.orphanReservations = 0;
  transport.reads = [];
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
