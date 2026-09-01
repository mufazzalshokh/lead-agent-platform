import { describe, expect, expectTypeOf, it } from "vitest";

import {
  SchemaIdSchema,
  SchemaVersionSchema,
  isSchemaValue,
  type AggregateVersion,
  type DomainEventFor,
  type ResourceVersion,
  type SchemaId,
  type SchemaVersion,
} from "../../packages/contracts/src/index.js";
import {
  advanceAggregateVersion,
  checkExpectedAggregateVersion,
  checkExpectedResourceVersion,
  failure,
  incrementAggregateVersion,
  incrementResourceVersion,
  initialAggregateVersion,
  initialResourceVersion,
  invariantViolation,
  isFailure,
  isSuccess,
  success,
  tenantScopeViolation,
  transitionFailure,
  transitionSuccess,
  type DomainEventDraft,
  type Result,
} from "../../packages/domain/src/index.js";

const requireSchemaId = (candidate: string): SchemaId => {
  if (!isSchemaValue(SchemaIdSchema, candidate)) {
    throw new TypeError("Invalid synthetic schema ID fixture");
  }

  return candidate;
};

const requireSchemaVersion = (candidate: string): SchemaVersion => {
  if (!isSchemaValue(SchemaVersionSchema, candidate)) {
    throw new TypeError("Invalid synthetic schema-version fixture");
  }

  return candidate;
};

describe("domain Result and foundational errors", () => {
  it("narrows immutable success and failure values exhaustively", () => {
    const successful: Result<number, ReturnType<typeof tenantScopeViolation>> = success(42);
    const failed: Result<number, ReturnType<typeof tenantScopeViolation>> = failure(
      tenantScopeViolation(),
    );

    const inspect = (result: Result<number, ReturnType<typeof tenantScopeViolation>>) =>
      result.ok ? `value:${result.value}` : result.error.code;

    expect(inspect(successful)).toBe("value:42");
    expect(inspect(failed)).toBe("tenant_scope_violation");
    expect(isSuccess(successful)).toBe(true);
    expect(isFailure(failed)).toBe(true);
    expect(Object.isFrozen(successful)).toBe(true);
    expect(Object.isFrozen(failed)).toBe(true);
  });

  it("uses stable, bounded, transport-neutral failure shapes", () => {
    const sensitiveInput = "+998901234567";
    const error = invariantViolation("invalid_contact");
    const serialized = JSON.stringify(error);

    expect(error).toEqual({ code: "invariant_violation", reason: "invalid_contact" });
    expect(Object.keys(error).sort()).toEqual(["code", "reason"]);
    expect(error.reason).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
    expect(error.reason.length).toBeLessThanOrEqual(100);
    expect(serialized).not.toContain(sensitiveInput);
    expect(serialized).not.toContain("status");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("provider");
  });

  it("returns expected domain failures without throwing", () => {
    expect(() => advanceAggregateVersion(4, 3)).not.toThrow();

    const result = advanceAggregateVersion(4, 3);
    expect(result).toEqual({
      error: { code: "concurrency_conflict", currentVersion: 4 },
      ok: false,
    });
  });
});

describe("aggregate and resource versions", () => {
  it("starts canonical aggregate and resource versions at one", () => {
    const aggregateVersion: AggregateVersion = initialAggregateVersion();
    const resourceVersion: ResourceVersion = initialResourceVersion();

    expect(aggregateVersion).toBe(1);
    expect(resourceVersion).toBe(1);
    expectTypeOf(aggregateVersion).toEqualTypeOf<AggregateVersion>();
    expectTypeOf(resourceVersion).toEqualTypeOf<ResourceVersion>();
  });

  it("accepts matching expected versions and rejects stale versions", () => {
    expect(checkExpectedAggregateVersion(7, 7)).toEqual({ ok: true, value: 7 });
    expect(checkExpectedResourceVersion(11, 11)).toEqual({ ok: true, value: 11 });
    expect(checkExpectedAggregateVersion(7, 6)).toEqual({
      error: { code: "concurrency_conflict", currentVersion: 7 },
      ok: false,
    });
  });

  it("increments exactly once and rejects invalid or overflowing versions", () => {
    const incremented = incrementAggregateVersion(8);

    expect(incremented).toEqual({ ok: true, value: 9 });
    if (incremented.ok) {
      expectTypeOf(incremented.value).toEqualTypeOf<AggregateVersion>();
    }
    expect(incrementResourceVersion(Number.MAX_SAFE_INTEGER - 1)).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
    expect(incrementAggregateVersion(0)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_version" },
      ok: false,
    });
    expect(incrementAggregateVersion(Number.MAX_SAFE_INTEGER)).toEqual({
      error: { code: "invariant_violation", reason: "version_overflow" },
      ok: false,
    });
  });

  it("does not expose an advanced version when the expected version mismatches", () => {
    const currentVersion: AggregateVersion = 5;
    const result = advanceAggregateVersion(currentVersion, 4);

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(currentVersion).toBe(5);
  });
});

describe("event drafts and transition results", () => {
  it("projects canonical contracts without constructing envelope metadata", () => {
    type OrganizationCreatedEvent = DomainEventFor<"organization.created">;

    const draft: DomainEventDraft<OrganizationCreatedEvent> = {
      aggregate_version: 2,
      event_type: "organization.created",
      payload: {
        default_locale: "en",
        organization_status: "active",
      },
      schema_id: requireSchemaId("OrganizationCreatedDomainEvent.v1"),
      schema_version: requireSchemaVersion("1"),
    };

    expect(Object.keys(draft).sort()).toEqual([
      "aggregate_version",
      "event_type",
      "payload",
      "schema_id",
      "schema_version",
    ]);
    expect(draft).not.toHaveProperty("event_id");
    expect(draft).not.toHaveProperty("occurred_at");
    expect(draft).not.toHaveProperty("organization_id");
    expect(draft).not.toHaveProperty("actor");
    expectTypeOf(draft.event_type).toEqualTypeOf<"organization.created">();
    expectTypeOf(draft.payload).toEqualTypeOf<Readonly<OrganizationCreatedEvent["payload"]>>();
  });

  it("copies and freezes next state, ordered drafts, and transition records", () => {
    type OrganizationCreatedEvent = DomainEventFor<"organization.created">;

    const schemaId = requireSchemaId("OrganizationCreatedDomainEvent.v1");
    const schemaVersion = requireSchemaVersion("1");
    const aggregate = { profile: { locale: "en" }, version: 3 };
    const firstPayload: {
      default_locale: "en" | "ru";
      organization_status: "active";
    } = { default_locale: "en", organization_status: "active" };
    const secondPayload = { default_locale: "ru", organization_status: "active" } as const;
    const drafts: DomainEventDraft<OrganizationCreatedEvent>[] = [
      {
        aggregate_version: 2,
        event_type: "organization.created",
        payload: firstPayload,
        schema_id: schemaId,
        schema_version: schemaVersion,
      },
      {
        aggregate_version: 3,
        event_type: "organization.created",
        payload: secondPayload,
        schema_id: schemaId,
        schema_version: schemaVersion,
      },
    ];
    const records = [{ edge: 1 }, { edge: 2 }];

    const result = transitionSuccess(aggregate, drafts, records);

    expect(result.ok).toBe(true);
    expect(result.value.events.map((event) => event.aggregate_version)).toEqual([2, 3]);
    expect(result.value.transitionRecords.map((record) => record.edge)).toEqual([1, 2]);
    expect(result.value.nextAggregate).not.toBe(aggregate);
    expect(result.value.events).not.toBe(drafts);
    expect(result.value.transitionRecords).not.toBe(records);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.nextAggregate)).toBe(true);
    expect(Object.isFrozen(result.value.nextAggregate.profile)).toBe(true);
    expect(Object.isFrozen(result.value.events)).toBe(true);
    expect(Object.isFrozen(result.value.events[0]?.payload)).toBe(true);
    expect(Object.isFrozen(result.value.transitionRecords)).toBe(true);
    expect(Object.isFrozen(aggregate)).toBe(false);
    expect(Object.isFrozen(drafts)).toBe(false);

    aggregate.profile.locale = "ru";
    firstPayload.default_locale = "ru";
    drafts.reverse();
    records.reverse();

    expect(result.value.nextAggregate.profile.locale).toBe("en");
    expect(result.value.events[0]?.payload.default_locale).toBe("en");
    expect(result.value.events.map((event) => event.aggregate_version)).toEqual([2, 3]);
    expect(result.value.transitionRecords.map((record) => record.edge)).toEqual([1, 2]);
  });

  it("keeps failures free of next state and events", () => {
    const result = transitionFailure(tenantScopeViolation());

    expect(result).toEqual({
      error: { code: "tenant_scope_violation" },
      ok: false,
    });
    expect(result).not.toHaveProperty("value");
    expect(result).not.toHaveProperty("events");
    expect(result).not.toHaveProperty("nextAggregate");
  });
});
