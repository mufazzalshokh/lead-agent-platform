import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildContractSnapshot } from "../../scripts/contracts/snapshot.js";
import {
  S17_STAFF_SCHEMA_NAMES,
  S19_STAFF_SCHEMA_NAMES,
  S19_WIDGET_SCHEMA_NAMES,
  S20_ANALYTICS_SCHEMA_NAMES,
  S20_WIDGET_SCHEMA_NAMES,
  S21_THREAD_AUTOMATION_SCHEMA_NAMES,
} from "../../scripts/contracts/catalog.js";
import {
  DOMAIN_EVENT_NAMES,
  DomainEventSchemas,
  DomainEventSchemasByVersion,
  DomainEventPayloadSchemasByVersion,
  ContactIdentityAddedDomainEventV2Schema,
  StaffContactIdentityTypeSchema,
  StaffContactIdentityTypeV2Schema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import {
  isKnownEventVersion,
  createActiveEventRoutes,
} from "../../apps/worker/src/event-routing.js";
import { IDS, NOW } from "./fixtures.js";

const additions = new Set([
  "ContactIdentityAddedDomainEventPayloadV2Schema",
  "ContactIdentityAddedDomainEventV2Schema",
  "StaffContactIdentityTypeV2Schema",
  "StaffContactIdentityV2Schema",
  "StaffContactV2Schema",
  "StaffContactResponseV2Schema",
  "StaffConversationParticipantV2Schema",
  "StaffConversationV2Schema",
  "StaffConversationResponseV2Schema",
  "StaffConversationCollectionResponseV2Schema",
]);
const event = (identityType: string, version: "1" | "2" = "2") => ({
  actor: { actor_id: null, actor_type: "system" },
  aggregate_id: IDS.contact,
  aggregate_type: "contact",
  aggregate_version: 1,
  causation_id: null,
  correlation_id: IDS.message,
  event_id: IDS.message,
  event_type: "contact.identity_added",
  occurred_at: NOW.toISOString(),
  organization_id: IDS.organization,
  payload: { contact_identity_id: IDS.message, identity_type: identityType },
  request_id: "instagram:test:event",
  schema_id: `ContactIdentityAddedDomainEvent.v${version}`,
  schema_version: version,
});
describe("Instagram additive identity/event version compatibility", () => {
  it("preserves all 319 accepted contract entries including every V1 schema byte-for-byte", () => {
    const laterAdditions = new Set<string>([
      ...S17_STAFF_SCHEMA_NAMES,
      ...S19_STAFF_SCHEMA_NAMES,
      ...S19_WIDGET_SCHEMA_NAMES,
      ...S20_ANALYTICS_SCHEMA_NAMES,
      ...S20_WIDGET_SCHEMA_NAMES,
      ...S21_THREAD_AUTOMATION_SCHEMA_NAMES,
      "AppointmentRequestConfirmedDomainEventV2Schema",
      "AppointmentRequestConfirmedDomainEventPayloadV2Schema",
    ]);
    const legacy = buildContractSnapshot().contracts.filter(
      (contract) =>
        !additions.has(contract.export_name) && !laterAdditions.has(contract.export_name),
    );
    expect(legacy).toHaveLength(319);
    expect(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")).toBe(
      "6629a12317c510cba9435e1b31cc404fe75ac5306817da52c9322c59f89b343d",
    );
  });
  it("keeps 63 semantic events and registers exactly 66 versioned variants", () => {
    expect(DOMAIN_EVENT_NAMES).toHaveLength(63);
    expect(
      Object.values(DomainEventSchemasByVersion).reduce(
        (count, versions) => count + Object.keys(versions).length,
        0,
      ),
    ).toBe(66);
    expect(Object.keys(DomainEventSchemasByVersion["contact.identity_added"])).toEqual(["1", "2"]);
    expect(Object.keys(DomainEventPayloadSchemasByVersion["contact.identity_added"])).toEqual([
      "1",
      "2",
    ]);
    expect(DomainEventSchemasByVersion["contact.identity_added"]["1"]).toBe(
      DomainEventSchemas["contact.identity_added"],
    );
  });
  it.each(["phone", "email", "widget_participant", "telegram_user"])(
    "accepts historical %s in both versions",
    (type) => {
      expect(
        isSchemaValue(DomainEventSchemasByVersion["contact.identity_added"]["1"], event(type, "1")),
      ).toBe(true);
      expect(isSchemaValue(ContactIdentityAddedDomainEventV2Schema, event(type))).toBe(true);
    },
  );
  it("accepts Instagram only through the exact V2 schema identity/version", () => {
    expect(isSchemaValue(ContactIdentityAddedDomainEventV2Schema, event("instagram_user"))).toBe(
      true,
    );
    expect(
      isSchemaValue(DomainEventSchemas["contact.identity_added"], event("instagram_user", "1")),
    ).toBe(false);
    for (const invalid of [
      { ...event("instagram_user"), schema_id: "ContactIdentityAddedDomainEvent.v1" },
      { ...event("instagram_user"), schema_version: "1" },
      {
        ...event("instagram_user"),
        payload: { ...event("instagram_user").payload, unapproved: true },
      },
      event("username"),
    ])
      expect(isSchemaValue(ContactIdentityAddedDomainEventV2Schema, invalid)).toBe(false);
  });
  it("retains V1 identity vocabulary and adds Instagram only to V2", () => {
    expect(isSchemaValue(StaffContactIdentityTypeSchema, "instagram_user")).toBe(false);
    expect(isSchemaValue(StaffContactIdentityTypeV2Schema, "instagram_user")).toBe(true);
  });
  it("validates Contact V2 routing without changing finite queue ownership", () => {
    expect(isKnownEventVersion("contact.identity_added", "2")).toBe(true);
    expect(isKnownEventVersion("contact.identity_added", "3")).toBe(false);
    expect(isKnownEventVersion("contact.created", "2")).toBe(false);
    expect(
      createActiveEventRoutes([{ eventType: "contact.identity_added", schemaVersion: "2" }]),
    ).toEqual([{ eventType: "contact.identity_added", schemaVersion: "2" }]);
  });
});
