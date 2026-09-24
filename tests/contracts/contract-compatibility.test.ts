import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as Contracts from "../../packages/contracts/src/index.js";
import { canonicalStringify, type JsonValue } from "../../scripts/contracts/canonical.js";
import {
  getPublicContractCatalog,
  PUBLIC_STATIC_SCHEMA_NAMES,
  S17_STAFF_SCHEMA_NAMES,
  S19_STAFF_SCHEMA_NAMES,
  S19_WIDGET_SCHEMA_NAMES,
  S20_ANALYTICS_SCHEMA_NAMES,
  S20_WIDGET_SCHEMA_NAMES,
  S21_THREAD_AUTOMATION_SCHEMA_NAMES,
  type PublicContractEntry,
} from "../../scripts/contracts/catalog.js";
import {
  compareContractSnapshots,
  type ContractSnapshot,
  type SnapshotContract,
} from "../../scripts/contracts/compatibility.js";
import { buildContractSnapshot, checkContractSnapshot } from "../../scripts/contracts/snapshot.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, context: string) => {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }

  return value;
};

const requireArray = (value: unknown, context: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array`);
  }

  return value;
};

const literalUnionValues = (schema: unknown) =>
  requireArray(requireRecord(schema, "literal union")["anyOf"], "literal union anyOf")
    .map((branch) => requireRecord(branch, "literal union branch")["const"])
    .sort();

const actionDiscriminants = (schema: unknown) =>
  requireArray(requireRecord(schema, "action union")["anyOf"], "action union anyOf")
    .map((branch) => {
      const properties = requireRecord(
        requireRecord(branch, "action branch")["properties"],
        "action properties",
      );
      return requireRecord(properties["type"], "action type")["const"];
    })
    .sort();

const visitSchemas = (
  value: unknown,
  visitor: (schema: Record<string, unknown>, path: string) => void,
  path = "$",
) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSchemas(item, visitor, `${path}[${index}]`));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  visitor(value, path);
  for (const [key, child] of Object.entries(value)) {
    visitSchemas(child, visitor, `${path}.${key}`);
  }
};

const productionTypeScriptFiles = (directory: string): readonly string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".next", "dist", "node_modules"].includes(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionTypeScriptFiles(path));
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
};

const fixtureContract = (schema: JsonValue, overrides: Partial<SnapshotContract> = {}) =>
  ({
    category: "api",
    export_name: "FixtureSchema",
    schema,
    schema_id: "Fixture.v1",
    schema_version: "1",
    ...overrides,
  }) satisfies SnapshotContract;

const fixtureSnapshot = (...contracts: SnapshotContract[]): ContractSnapshot => ({
  contracts,
  snapshot_format_version: 1,
});

const baselineFixtureSchema = {
  $id: "Fixture.v1",
  additionalProperties: false,
  properties: {
    choice: { enum: ["one", "two"], type: "string" },
    kind: { const: "fixture", type: "string" },
    nullable: {
      anyOf: [{ maxLength: 20, type: "string" }, { type: "null" }],
    },
    tags: {
      items: { const: "tag", type: "string" },
      maxItems: 3,
      type: "array",
    },
    value: { maxLength: 20, minLength: 1, type: "string" },
  },
  required: ["choice", "kind", "value"],
  type: "object",
} satisfies JsonValue;

const sameVersionDrift = (mutate: (schema: Record<string, unknown>) => void) => {
  const candidateSchema = structuredClone(baselineFixtureSchema);
  mutate(candidateSchema);

  return compareContractSnapshots(
    fixtureSnapshot(fixtureContract(baselineFixtureSchema)),
    fixtureSnapshot(fixtureContract(candidateSchema)),
  );
};

describe("public contract inventory and snapshot", () => {
  it("catalogs every intentional public schema exactly once", () => {
    const snapshot = buildContractSnapshot();
    const counts = Object.fromEntries(
      ["ai", "api", "channel", "configuration", "conversation", "event", "shared", "widget"].map(
        (category) => [
          category,
          snapshot.contracts.filter((contract) => contract.category === category).length,
        ],
      ),
    );

    expect(snapshot.contracts).toHaveLength(372);
    expect(counts).toEqual({
      ai: 16,
      api: 38,
      channel: 24,
      configuration: 65,
      conversation: 37,
      event: 135,
      shared: 28,
      widget: 29,
    });
    expect(new Set(snapshot.contracts.map((contract) => contract.schema_id)).size).toBe(
      snapshot.contracts.length,
    );
  });

  it("adds exactly the S17 schemas without changing any of the 329 accepted entries", () => {
    const full = buildContractSnapshot();
    const s19 = new Set<string>([
      ...S19_STAFF_SCHEMA_NAMES,
      ...S19_WIDGET_SCHEMA_NAMES,
      ...S20_ANALYTICS_SCHEMA_NAMES,
      ...S20_WIDGET_SCHEMA_NAMES,
      ...S21_THREAD_AUTOMATION_SCHEMA_NAMES,
    ]);
    const candidate = {
      ...full,
      contracts: full.contracts.filter(
        (contract) =>
          !s19.has(contract.export_name) &&
          (!contract.export_name.startsWith("AppointmentRequestConfirmedDomainEvent") ||
            contract.schema_version !== "2"),
      ),
    };
    const additions = new Set<string>(S17_STAFF_SCHEMA_NAMES);
    const legacy = candidate.contracts.filter((contract) => !additions.has(contract.export_name));
    const baseline: ContractSnapshot = { ...candidate, contracts: legacy };
    expect(legacy).toHaveLength(329);
    expect(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")).toBe(
      "f1d4bd209f8d0f1411c5f3a704c7a298fe02cf575d9c569ce979ac8ed172159e",
    );
    const findings = compareContractSnapshots(baseline, candidate);
    expect(findings).toHaveLength(16);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
  });

  it("adds only S18 confirmed V2 while preserving all 345 accepted contracts", () => {
    const full = buildContractSnapshot();
    const s19 = new Set<string>([
      ...S19_STAFF_SCHEMA_NAMES,
      ...S19_WIDGET_SCHEMA_NAMES,
      ...S20_ANALYTICS_SCHEMA_NAMES,
      ...S20_WIDGET_SCHEMA_NAMES,
      ...S21_THREAD_AUTOMATION_SCHEMA_NAMES,
    ]);
    const candidate = {
      ...full,
      contracts: full.contracts.filter((contract) => !s19.has(contract.export_name)),
    };
    const added = new Set([
      "AppointmentRequestConfirmedDomainEventV2Schema",
      "AppointmentRequestConfirmedDomainEventPayloadV2Schema",
    ]);
    const legacy = candidate.contracts.filter((contract) => !added.has(contract.export_name));
    expect(legacy).toHaveLength(345);
    expect(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")).toBe(
      "a2c0a48259b7141287af5dd2184485345e8cc5aa3208ed529ee698fe983dd072",
    );
    const findings = compareContractSnapshots({ ...candidate, contracts: legacy }, candidate);
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
    expect(
      Object.keys(Contracts.DomainEventSchemasByVersion["appointment_request.confirmed"]),
    ).toEqual(["1", "2"]);
    expect(Contracts.DOMAIN_EVENT_NAMES).toHaveLength(63);
  });

  it.each(["customer_session", "telegram", "staff_attested_external", "instagram"])(
    "validates the exact source compatibility for %s",
    (source) => {
      const payload = {
        appointment_status: "confirmed",
        confirmation_source: source,
        customer_confirmed_at: "2026-09-18T09:00:00.000Z",
        offer_version: 1,
      };
      expect(
        Contracts.isSchemaValue(
          Contracts.DomainEventPayloadSchemas["appointment_request.confirmed"],
          payload,
        ),
      ).toBe(source !== "instagram");
      expect(
        Contracts.isSchemaValue(
          Contracts.AppointmentRequestConfirmedDomainEventPayloadV2Schema,
          payload,
        ),
      ).toBe(true);
      expect(
        Contracts.isSchemaValue(Contracts.AppointmentRequestConfirmedDomainEventPayloadV2Schema, {
          ...payload,
          confirmation_source: "invented",
        }),
      ).toBe(false);
    },
  );

  it("classifies the S10 Widget contracts as additive only", () => {
    const full = buildContractSnapshot();
    const s19Widget = new Set<string>([...S19_WIDGET_SCHEMA_NAMES, ...S20_WIDGET_SCHEMA_NAMES]);
    const candidate = {
      ...full,
      contracts: full.contracts.filter((contract) => !s19Widget.has(contract.export_name)),
    };
    const widgetContracts = candidate.contracts.filter(
      (contract) => contract.category === "widget",
    );
    const baseline: ContractSnapshot = {
      ...candidate,
      contracts: candidate.contracts.filter((contract) => contract.category !== "widget"),
    };
    const findings = compareContractSnapshots(baseline, candidate);

    expect(widgetContracts).toHaveLength(18);
    expect(findings).toHaveLength(18);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
  });

  it("adds exactly the S19 private staff and Widget embed contracts", () => {
    const full = buildContractSnapshot();
    const s20 = new Set<string>([
      ...S20_ANALYTICS_SCHEMA_NAMES,
      ...S20_WIDGET_SCHEMA_NAMES,
      ...S21_THREAD_AUTOMATION_SCHEMA_NAMES,
    ]);
    const candidate = {
      ...full,
      contracts: full.contracts.filter((contract) => !s20.has(contract.export_name)),
    };
    const additions = new Set<string>([...S19_STAFF_SCHEMA_NAMES, ...S19_WIDGET_SCHEMA_NAMES]);
    const legacy = candidate.contracts.filter((contract) => !additions.has(contract.export_name));
    expect(legacy).toHaveLength(347);
    expect(createHash("sha256").update(JSON.stringify(legacy)).digest("hex")).toBe(
      "fa2ce8008912fbde8f4da9e6c2f8b8c8e64d19769c6fcc14a592809b4194ed24",
    );
    const findings = compareContractSnapshots({ ...candidate, contracts: legacy }, candidate);
    expect(findings).toHaveLength(10);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
  });

  it("adds exactly the S20 private analytics and bounded Widget telemetry contracts", () => {
    const full = buildContractSnapshot();
    const candidate = {
      ...full,
      contracts: full.contracts.filter(
        (contract) =>
          !S21_THREAD_AUTOMATION_SCHEMA_NAMES.includes(
            contract.export_name as (typeof S21_THREAD_AUTOMATION_SCHEMA_NAMES)[number],
          ),
      ),
    };
    const additions = new Set<string>([...S20_ANALYTICS_SCHEMA_NAMES, ...S20_WIDGET_SCHEMA_NAMES]);
    const legacy = candidate.contracts.filter((contract) => !additions.has(contract.export_name));
    expect(legacy).toHaveLength(357);
    const findings = compareContractSnapshots({ ...candidate, contracts: legacy }, candidate);
    expect(findings).toHaveLength(9);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
  });

  it("adds exactly the S21 private thread-automation contracts", () => {
    const candidate = buildContractSnapshot();
    const additions = new Set<string>(S21_THREAD_AUTOMATION_SCHEMA_NAMES);
    const legacy = candidate.contracts.filter((contract) => !additions.has(contract.export_name));
    expect(legacy).toHaveLength(366);
    const findings = compareContractSnapshots({ ...candidate, contracts: legacy }, candidate);
    expect(findings).toHaveLength(6);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
  });

  it("keeps the runtime export surface explicit", () => {
    const staticSchemaExports = Object.values(PUBLIC_STATIC_SCHEMA_NAMES).flat();
    const nonSchemaExports = [
      "DOMAIN_EVENT_NAMES",
      "DomainEventPayloadSchemas",
      "DomainEventPayloadSchemasByVersion",
      "DomainEventSchemas",
      "DomainEventSchemasByVersion",
      "createCollectionEnvelopeSchema",
      "createSuccessEnvelopeSchema",
      "isSchemaValue",
    ];

    expect(Object.keys(Contracts).sort()).toEqual(
      [...staticSchemaExports, ...nonSchemaExports].sort(),
    );
  });

  it("matches the reviewed canonical snapshot byte-for-byte", async () => {
    await expect(checkContractSnapshot()).resolves.toEqual(buildContractSnapshot());
  });

  it("classifies all S7.1 configuration contracts as additive only", () => {
    const candidate = buildContractSnapshot();
    const configurationContracts = candidate.contracts.filter(
      (contract) => contract.category === "configuration",
    );
    const baseline: ContractSnapshot = {
      ...candidate,
      contracts: candidate.contracts.filter((contract) => contract.category !== "configuration"),
    };
    const findings = compareContractSnapshots(baseline, candidate);

    expect(configurationContracts).toHaveLength(65);
    expect(findings).toHaveLength(65);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
  });

  it("classifies the approved S9 staff read contracts as additive only", () => {
    const candidate = buildContractSnapshot();
    const conversationContracts = candidate.contracts.filter(
      (contract) => contract.category === "conversation" && contract.schema_id.endsWith(".v1"),
    );
    const baseline: ContractSnapshot = {
      ...candidate,
      contracts: candidate.contracts.filter(
        (contract) => contract.category !== "conversation" || !contract.schema_id.endsWith(".v1"),
      ),
    };
    const findings = compareContractSnapshots(baseline, candidate);

    expect(conversationContracts).toHaveLength(29);
    expect(findings).toHaveLength(29);
    expect(findings.every((finding) => finding.classification === "additive")).toBe(true);
  });

  it("classifies the approved lead.reopened V2 schemas as additive only", () => {
    const candidate = buildContractSnapshot();
    const addedExportNames = new Set([
      "LeadReopenedDomainEventPayloadV2Schema",
      "LeadReopenedDomainEventV2Schema",
    ]);
    const baseline: ContractSnapshot = {
      ...candidate,
      contracts: candidate.contracts.filter(
        (contract) => !addedExportNames.has(contract.export_name),
      ),
    };

    expect(compareContractSnapshots(baseline, candidate)).toEqual([
      {
        classification: "additive",
        contract: "LeadReopenedDomainEventPayloadV2Schema",
        detail: "new independently identified public contract was added",
      },
      {
        classification: "additive",
        contract: "LeadReopenedDomainEventV2Schema",
        detail: "new independently identified public contract was added",
      },
    ]);
    expect(
      candidate.contracts.find(
        (contract) => contract.export_name === 'DomainEventSchemas["lead.reopened"]',
      ),
    ).toMatchObject({
      schema_id: "LeadReopenedDomainEvent.v1",
      schema_version: "1",
    });
  });

  it("classifies the approved Conversation automation-mode schemas as additive only", () => {
    const candidate = buildContractSnapshot();
    const addedExportNames = new Set([
      'DomainEventPayloadSchemas["conversation.automation_mode_changed"]',
      'DomainEventSchemas["conversation.automation_mode_changed"]',
    ]);
    const baseline: ContractSnapshot = {
      ...candidate,
      contracts: candidate.contracts.filter(
        (contract) => !addedExportNames.has(contract.export_name),
      ),
    };

    expect(compareContractSnapshots(baseline, candidate)).toEqual([
      {
        classification: "additive",
        contract: 'DomainEventPayloadSchemas["conversation.automation_mode_changed"]',
        detail: "new independently identified public contract was added",
      },
      {
        classification: "additive",
        contract: 'DomainEventSchemas["conversation.automation_mode_changed"]',
        detail: "new independently identified public contract was added",
      },
    ]);
    expect(
      candidate.contracts.find(
        (contract) => contract.export_name === 'DomainEventSchemas["conversation.status_changed"]',
      ),
    ).toMatchObject({
      schema_id: "ConversationStatusChangedDomainEvent.v1",
      schema_version: "1",
    });
  });

  it("classifies the approved Conversation active-Handoff schemas as additive only", () => {
    const candidate = buildContractSnapshot();
    const addedExportNames = new Set([
      'DomainEventPayloadSchemas["conversation.active_handoff_changed"]',
      'DomainEventSchemas["conversation.active_handoff_changed"]',
    ]);
    const baseline: ContractSnapshot = {
      ...candidate,
      contracts: candidate.contracts.filter(
        (contract) => !addedExportNames.has(contract.export_name),
      ),
    };

    expect(compareContractSnapshots(baseline, candidate)).toEqual([
      {
        classification: "additive",
        contract: 'DomainEventPayloadSchemas["conversation.active_handoff_changed"]',
        detail: "new independently identified public contract was added",
      },
      {
        classification: "additive",
        contract: 'DomainEventSchemas["conversation.active_handoff_changed"]',
        detail: "new independently identified public contract was added",
      },
    ]);
    expect(
      candidate.contracts.find(
        (contract) =>
          contract.export_name === 'DomainEventSchemas["conversation.automation_mode_changed"]',
      ),
    ).toMatchObject({
      schema_id: "ConversationAutomationModeChangedDomainEvent.v1",
      schema_version: "1",
    });
  });

  it("is deterministic regardless of input catalog order", () => {
    const catalog = [...getPublicContractCatalog()];
    const reversed = [...catalog].reverse();

    expect(canonicalStringify(buildContractSnapshot(catalog))).toBe(
      canonicalStringify(buildContractSnapshot(reversed)),
    );
  });

  it("rejects duplicate schema IDs and mismatched embedded identities", () => {
    const duplicates: readonly PublicContractEntry[] = [
      { category: "api", exportName: "FirstSchema", schema: { $id: "Duplicate.v1" } },
      { category: "api", exportName: "SecondSchema", schema: { $id: "Duplicate.v1" } },
    ];

    expect(() => buildContractSnapshot(duplicates)).toThrowError(
      "Duplicate public schema ID: Duplicate.v1",
    );
    expect(() =>
      buildContractSnapshot([
        {
          category: "event",
          exportName: "BadIdentitySchema",
          schema: {
            $id: "BadIdentity.v1",
            properties: {
              schema_id: { const: "Other.v1" },
              schema_version: { const: "1" },
            },
          },
        },
      ]),
    ).toThrowError("schema_id literal does not match");
    expect(() =>
      buildContractSnapshot([
        {
          category: "ai",
          exportName: "BadVersionSchema",
          schema: {
            $id: "BadVersion.v1",
            properties: {
              schema_id: { const: "BadVersion.v1" },
              schema_version: { const: "2" },
            },
          },
        },
      ]),
    ).toThrowError("schema_version literal does not match");
  });
});

describe("compatibility classification", () => {
  it.each([
    [
      "field addition",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        properties["extra"] = { maxLength: 20, type: "string" };
      },
    ],
    [
      "field removal",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        delete properties["value"];
      },
    ],
    [
      "field rename",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        properties["renamed"] = properties["value"];
        delete properties["value"];
      },
    ],
    [
      "type change",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        requireRecord(properties["value"], "value schema")["type"] = "number";
      },
    ],
    [
      "enum change",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        requireRecord(properties["choice"], "choice schema")["enum"] = ["one"];
      },
    ],
    [
      "discriminant change",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        requireRecord(properties["kind"], "kind schema")["const"] = "renamed";
      },
    ],
    [
      "bound change",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        requireRecord(properties["value"], "value schema")["maxLength"] = 10;
      },
    ],
    [
      "array bound change",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        requireRecord(properties["tags"], "tags schema")["maxItems"] = 2;
      },
    ],
    [
      "requiredness change",
      (schema: Record<string, unknown>) => {
        schema["required"] = ["choice", "kind"];
      },
    ],
    [
      "nullability change",
      (schema: Record<string, unknown>) => {
        const properties = requireRecord(schema["properties"], "fixture properties");
        properties["nullable"] = { maxLength: 20, type: "string" };
      },
    ],
  ])("requires a version for same-ID %s", (_name, mutate) => {
    expect(sameVersionDrift(mutate)).toEqual([
      {
        classification: "version-requiring",
        contract: "FixtureSchema",
        detail: "same-version schema content changed",
      },
    ]);
  });

  it("classifies identity/version changes, additions, and removals", () => {
    const baseline = fixtureSnapshot(fixtureContract(baselineFixtureSchema));
    const versioned = fixtureSnapshot(
      fixtureContract(
        { ...baselineFixtureSchema, $id: "Fixture.v2" },
        { schema_id: "Fixture.v2", schema_version: "2" },
      ),
    );
    const added = fixtureContract(
      { $id: "Added.v1", type: "string" },
      { export_name: "AddedSchema", schema_id: "Added.v1" },
    );

    expect(compareContractSnapshots(baseline, versioned)).toEqual([
      {
        classification: "version-requiring",
        contract: "FixtureSchema",
        detail: "schema identity or declared version changed",
      },
    ]);
    expect(
      compareContractSnapshots(baseline, fixtureSnapshot(...baseline.contracts, added)),
    ).toContainEqual({
      classification: "additive",
      contract: "AddedSchema",
      detail: "new independently identified public contract was added",
    });
    expect(compareContractSnapshots(baseline, fixtureSnapshot())).toEqual([
      {
        classification: "breaking",
        contract: "FixtureSchema",
        detail: "public contract was removed",
      },
    ]);
  });
});

describe("cross-contract security and drift audit", () => {
  it("keeps all JSON wire values bounded and all objects closed", () => {
    const failures: string[] = [];

    for (const entry of getPublicContractCatalog()) {
      visitSchemas(entry.schema, (schema, path) => {
        if (schema["type"] === "object" && schema["additionalProperties"] !== false) {
          failures.push(`${entry.exportName}${path}: open object`);
        }
        if (
          schema["type"] === "string" &&
          schema["const"] === undefined &&
          schema["maxLength"] === undefined &&
          schema["format"] !== "date" &&
          schema["pattern"] !== "^([01]\\d|2[0-3]):[0-5]\\d$"
        ) {
          failures.push(`${entry.exportName}${path}: unbounded string`);
        }
        if (
          (schema["type"] === "number" || schema["type"] === "integer") &&
          schema["const"] === undefined &&
          (schema["minimum"] === undefined || schema["maximum"] === undefined)
        ) {
          failures.push(`${entry.exportName}${path}: unbounded number`);
        }
        if (schema["type"] === "array" && schema["maxItems"] === undefined) {
          failures.push(`${entry.exportName}${path}: unbounded array`);
        }
      });
    }

    expect(failures).toEqual([]);
  });

  it("does not expose tenant authority, secrets, raw payloads, reasoning, or generic tools", () => {
    const forbiddenProperties = new Set([
      "access_token",
      "api_key",
      "authorization",
      "chain_of_thought",
      "cookie",
      "credential",
      "prompt",
      "provider_payload",
      "raw_payload",
      "reasoning",
      "refresh_token",
      "secret",
      "system_prompt",
      "tenant_id",
      "tool",
      "tool_name",
      "webhook_payload",
    ]);
    const authorizedOrganizationSelectors = new Set(["StaffMeSchema", "StaffMeResponseSchema"]);
    const failures: string[] = [];

    for (const entry of getPublicContractCatalog()) {
      visitSchemas(entry.schema, (schema, path) => {
        const properties = schema["properties"];
        if (!isRecord(properties)) {
          return;
        }

        for (const property of Object.keys(properties)) {
          if (forbiddenProperties.has(property)) {
            failures.push(`${entry.exportName}${path}.${property}`);
          }
          if (
            property === "organization_id" &&
            entry.category !== "event" &&
            entry.exportName !== "SendChannelMessageSchema" &&
            !authorizedOrganizationSelectors.has(entry.exportName)
          ) {
            failures.push(`${entry.exportName}${path}.${property}: unexpected authority field`);
          }
        }
      });
    }

    expect(failures).toEqual([]);
    expect(canonicalStringify(Contracts.CanonicalInboundEventSchema)).not.toContain(
      '"organization_id"',
    );
    expect(canonicalStringify(Contracts.AgentDecisionV1Schema)).not.toContain('"organization_id"');
  });

  it("keeps action vocabularies and discriminated consumers aligned", () => {
    const canonicalActions = literalUnionValues(Contracts.AgentActionTypeSchema);
    const completedPayload = Contracts.DomainEventPayloadSchemas["ai_run.completed"];
    const deniedPayload = Contracts.DomainEventPayloadSchemas["ai_run.policy_denied"];
    const proposedAction = (payload: unknown) => {
      const properties = requireRecord(
        requireRecord(payload, "AI event payload")["properties"],
        "AI event payload properties",
      );
      return properties["proposed_action"];
    };

    expect(actionDiscriminants(Contracts.AgentDecisionActionSchema)).toEqual(canonicalActions);
    expect(literalUnionValues(proposedAction(completedPayload))).toEqual(canonicalActions);
    expect(literalUnionValues(proposedAction(deniedPayload))).toEqual(canonicalActions);
    expect(
      requireArray(
        requireRecord(Contracts.DomainEventSchema, "event union")["anyOf"],
        "event variants",
      ),
    ).toHaveLength(Contracts.DOMAIN_EVENT_NAMES.length);
    expect(
      Object.values(Contracts.DomainEventSchemasByVersion).reduce(
        (count, versions) => count + Object.keys(versions).length,
        0,
      ),
    ).toBe(66);
  });

  it("keeps event payloads privacy-minimal and credential rotation version-only", () => {
    const forbiddenEventFields = new Set([
      "caption",
      "display_name",
      "draft_text",
      "email",
      "email_raw",
      "phone",
      "phone_raw",
      "raw_text",
      "text",
    ]);
    const failures: string[] = [];

    for (const [eventName, payload] of Object.entries(Contracts.DomainEventPayloadSchemas)) {
      visitSchemas(payload, (schema, path) => {
        const properties = schema["properties"];
        if (!isRecord(properties)) {
          return;
        }

        for (const property of Object.keys(properties)) {
          if (forbiddenEventFields.has(property)) {
            failures.push(`${eventName}${path}.${property}`);
          }
        }
      });
    }

    const credentialPayload = requireRecord(
      Contracts.DomainEventPayloadSchemas["channel_connection.credential_rotated"],
      "credential rotation payload",
    );
    expect(
      Object.keys(requireRecord(credentialPayload["properties"], "payload properties")),
    ).toEqual(["credential_version"]);
    expect(failures).toEqual([]);
  });

  it("finds no duplicate public DTO declarations outside the contracts package", () => {
    const workspaceRoot = process.cwd();
    const contractTypeNames = new Set(
      buildContractSnapshot().contracts.map((contract) =>
        contract.schema_id.replace(/\.v[1-9][0-9]*$/, ""),
      ),
    );
    const files = [join(workspaceRoot, "apps"), join(workspaceRoot, "packages")]
      .flatMap(productionTypeScriptFiles)
      .filter((file) => !file.startsWith(join(workspaceRoot, "packages", "contracts")));
    const duplicates = files.flatMap((file) => {
      const sourceFile = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const declarations: string[] = [];

      const visit = (node: ts.Node) => {
        if (
          (ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isEnumDeclaration(node)) &&
          contractTypeNames.has(node.name.text)
        ) {
          const declarationKind = ts.isInterfaceDeclaration(node)
            ? "interface"
            : ts.isTypeAliasDeclaration(node)
              ? "type"
              : "enum";
          declarations.push(
            `${relative(workspaceRoot, file)}: ${declarationKind} ${node.name.text}`,
          );
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
      return declarations;
    });

    expect(duplicates).toEqual([]);
  }, 30_000);
});
