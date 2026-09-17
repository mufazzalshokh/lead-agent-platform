import { describe, expect, it } from "vitest";
import {
  buildAIProviderInput,
  evaluateAIDecision,
  validateAgentDecision,
} from "../../packages/application/src/index.js";
import {
  AppointmentRequestIdSchema,
  ResourceIdSchema,
  AggregateVersionSchema,
  isSchemaValue,
  type AgentFactualClaim,
} from "../../packages/contracts/src/index.js";
import { AI_SNAPSHOT, fixtureId, validDecision } from "./fixtures.js";

const appointmentId = fixtureId(12007),
  sourceId = fixtureId(12008),
  version = 1;
if (
  !isSchemaValue(AppointmentRequestIdSchema, appointmentId) ||
  !isSchemaValue(ResourceIdSchema, sourceId) ||
  !isSchemaValue(AggregateVersionSchema, version)
)
  throw new TypeError("Invalid policy fixture");
const reference: AgentFactualClaim = {
  claim_kind: "service",
  source_type: "service",
  source_id: sourceId,
  source_version: version,
};
describe("S12 bounded context", () => {
  it.each(["en", "ru", "uz"] as const)("preserves %s Unicode as data", (locale) => {
    const value = buildAIProviderInput(
      { ...AI_SNAPSHOT, locale, message: "Salom Привет Hello 😁" },
      new AbortController().signal,
    );
    expect(value?.message).toBe("Salom Привет Hello 😁");
  });
  it("selects newest history in explicit order without duplicating trigger", () => {
    const snapshot = {
      ...AI_SNAPSHOT,
      sourceSequence: 21,
      history: Array.from({ length: 20 }, (_, i) => ({
        role: "customer" as const,
        sequence: 20 - i,
        text: String(20 - i),
      })),
    };
    const input = buildAIProviderInput(snapshot, new AbortController().signal);
    expect(input?.history.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: 12 }, (_, i) => 9 + i),
    );
  });
  it.each([0, 4_001, 20_001])("rejects invalid trigger size %i", (length) =>
    expect(
      buildAIProviderInput(
        { ...AI_SNAPSHOT, message: "a".repeat(length) },
        new AbortController().signal,
      ),
    ).toBeNull(),
  );
  it("rejects overlarge selected history", () =>
    expect(
      buildAIProviderInput(
        { ...AI_SNAPSHOT, history: [{ role: "customer", sequence: 1, text: "a".repeat(4_001) }] },
        new AbortController().signal,
      ),
    ).toBeNull());
  it("rejects oversized facts without meaning-changing truncation", () =>
    expect(
      buildAIProviderInput(
        {
          ...AI_SNAPSHOT,
          policy: { ...AI_SNAPSHOT.policy, facts: [{ reference, text: "a".repeat(2_001) }] },
        },
        new AbortController().signal,
      ),
    ).toBeNull());
  it("rejects duplicate history sequence", () =>
    expect(
      buildAIProviderInput(
        { ...AI_SNAPSHOT, history: [AI_SNAPSHOT.history[0]!, AI_SNAPSHOT.history[0]!] },
        new AbortController().signal,
      ),
    ).toBeNull());
  it("rejects facts count and total context budget overflow", () => {
    expect(
      buildAIProviderInput(
        {
          ...AI_SNAPSHOT,
          policy: {
            ...AI_SNAPSHOT.policy,
            facts: Array.from({ length: 25 }, () => ({ reference, text: "x" })),
          },
        },
        new AbortController().signal,
      ),
    ).toBeNull();
    expect(
      buildAIProviderInput(
        {
          ...AI_SNAPSHOT,
          policy: {
            ...AI_SNAPSHOT.policy,
            facts: Array.from({ length: 12 }, () => ({ reference, text: "x".repeat(2_000) })),
          },
        },
        new AbortController().signal,
      ),
    ).toBeNull();
  });
  it("projects whitelisted fields instead of dumping context objects", () => {
    const history = [
      { role: "customer" as const, sequence: 1, text: "x", credentials: "synthetic-secret" },
    ];
    const input = buildAIProviderInput({ ...AI_SNAPSHOT, history }, new AbortController().signal);
    expect(JSON.stringify(input)).not.toContain("credentials");
  });
});
describe("S12 proposal-only policy", () => {
  it.each([
    { type: "none" },
    { type: "request_information", field: "service" },
    { type: "create_appointment_request" },
    { type: "request_handoff", reason: "customer_requested" },
  ])("allows a finite proposal %o without applying it", (action) =>
    expect(evaluateAIDecision(validDecision({ action }), AI_SNAPSHOT.policy)).toMatchObject({
      kind: "decision",
      applied: false,
    }),
  );
  it("preserves suppression without allowing a send", () =>
    expect(
      evaluateAIDecision(
        validDecision({ message: { draft_text: null, mode: "suppress" } }),
        AI_SNAPSHOT.policy,
      ),
    ).toMatchObject({ kind: "decision", disposition: "suppress", applied: false }));
  it("does not make phone mandatory for trusted bound channels", () =>
    expect(
      evaluateAIDecision(
        validDecision({ action: { type: "request_information", field: "phone" } }),
        AI_SNAPSHOT.policy,
      ),
    ).toMatchObject({ reason: "policy_denied" }));
  it("requires an actually missing field", () =>
    expect(
      evaluateAIDecision(
        validDecision({ action: { type: "request_information", field: "email" } }),
        AI_SNAPSHOT.policy,
      ),
    ).toMatchObject({ reason: "policy_denied" }));
  it.each(["paused", "staff"] as const)("cannot bypass %s automation", (automationMode) =>
    expect(
      evaluateAIDecision(validDecision(), { ...AI_SNAPSHOT.policy, automationMode }),
    ).toMatchObject({ reason: "stale_context" }),
  );
  it.each(["closed", "resolved", "awaiting_staff"] as const)(
    "cannot bypass %s state",
    (conversationStatus) =>
      expect(
        evaluateAIDecision(validDecision(), { ...AI_SNAPSHOT.policy, conversationStatus }),
      ).toMatchObject({ reason: "stale_context" }),
  );
  it("safe_to_send and confidence cannot override injection/safety policy", () =>
    expect(
      evaluateAIDecision(
        validDecision({ safety: { safe_to_send: true, risk_flags: ["prompt_injection"] } }),
        AI_SNAPSHOT.policy,
      ),
    ).toMatchObject({ reason: "policy_denied" }));
  it("rejects duplicate risk flags", () =>
    expect(
      evaluateAIDecision(
        validDecision({ safety: { safe_to_send: true, risk_flags: ["abuse", "abuse"] } }),
        AI_SNAPSHOT.policy,
      ),
    ).toMatchObject({ reason: "policy_denied" }));
  it("rejects stale or foreign citations despite safe_to_send", () =>
    expect(
      evaluateAIDecision(validDecision({ factual_claims: [reference] }), AI_SNAPSHOT.policy),
    ).toMatchObject({ reason: "stale_context" }));
  it("accepts only supplied exact fact versions as candidate citations", () =>
    expect(
      evaluateAIDecision(validDecision({ factual_claims: [reference] }), {
        ...AI_SNAPSHOT.policy,
        facts: [{ reference, text: "untrusted fact wording" }],
      }),
    ).toMatchObject({ kind: "decision", applied: false }));
  it("rejects invented extracted resource IDs", () =>
    expect(
      evaluateAIDecision(
        validDecision({
          extracted_facts: { ...validDecision().extracted_facts, service_id: sourceId },
        }),
        AI_SNAPSHOT.policy,
      ),
    ).toMatchObject({ reason: "policy_denied" }));
  it.each(["confirm_appointment", "decline_appointment"] as const)(
    "rejects %s for missing/foreign/unbound/stale-state targets",
    (type) => {
      const decision = validDecision({ action: { type, appointment_request_id: appointmentId } });
      expect(evaluateAIDecision(decision, AI_SNAPSHOT.policy)).toMatchObject({
        reason: "policy_denied",
      });
      for (const change of [
        { boundToConversation: false },
        { customerConfirmationBound: false },
        { state: "confirmed" },
        { version: 0 },
        { offerVersion: 0 },
      ])
        expect(
          evaluateAIDecision(decision, {
            ...AI_SNAPSHOT.policy,
            appointments: [
              {
                id: appointmentId,
                state: "awaiting_customer_confirmation",
                version: 1,
                offerVersion: 1,
                boundToConversation: true,
                customerConfirmationBound: true,
                ...change,
              },
            ],
          }),
        ).toMatchObject({ reason: "policy_denied" });
    },
  );
  it("confirmation remains only a proposal even with a verified binding", () =>
    expect(
      evaluateAIDecision(
        validDecision({
          action: { type: "confirm_appointment", appointment_request_id: appointmentId },
        }),
        {
          ...AI_SNAPSHOT.policy,
          appointments: [
            {
              id: appointmentId,
              state: "awaiting_customer_confirmation",
              version: 1,
              offerVersion: 1,
              boundToConversation: true,
              customerConfirmationBound: true,
            },
          ],
        },
      ),
    ).toMatchObject({ kind: "decision", applied: false }));
  it.each([
    { schema_version: "2" },
    { action: { type: "execute_sql" } },
    { tools: ["send_message"] },
    { message: { draft_text: "a".repeat(4_001), mode: "send_candidate" } },
  ])("enforces unchanged canonical schema locally %o", (override) =>
    expect(validateAgentDecision({ ...validDecision(), ...override })).toBe(false),
  );
});
