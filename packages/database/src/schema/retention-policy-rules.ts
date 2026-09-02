import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { immutableCreatedAt } from "./common.js";
import { organizations } from "./organizations.js";
import { retentionPolicies } from "./retention-policies.js";

export const retentionPolicyRules = pgTable(
  "retention_policy_rules",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    retentionPolicyId: uuid("retention_policy_id").notNull(),
    dataClass: varchar("data_class", { length: 128 }).notNull(),
    purpose: varchar("purpose", { length: 128 }).notNull(),
    triggerEvent: varchar("trigger_event", { length: 128 }).notNull(),
    durationDays: integer("duration_days").notNull(),
    expiryAction: varchar("expiry_action", { length: 16 }).notNull(),
    jurisdictionReference: varchar("jurisdiction_reference", { length: 255 }).notNull(),
    legalBasisReference: varchar("legal_basis_reference", { length: 255 }).notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table) => [
    check(
      "retention_policy_rules_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "retention_policy_rules_identifiers_check",
      sql`${table.dataClass} = lower(btrim(${table.dataClass}))
        and ${table.dataClass} ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
        and ${table.purpose} = lower(btrim(${table.purpose}))
        and ${table.purpose} ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
        and ${table.triggerEvent} = lower(btrim(${table.triggerEvent}))
        and ${table.triggerEvent} ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'`,
    ),
    check("retention_policy_rules_duration_days_check", sql`${table.durationDays} >= 0`),
    check(
      "retention_policy_rules_expiry_action_check",
      sql`${table.expiryAction} in ('purge', 'anonymize', 'aggregate')`,
    ),
    check(
      "retention_policy_rules_references_check",
      sql`length(btrim(${table.jurisdictionReference})) between 1 and 255
        and length(btrim(${table.legalBasisReference})) between 1 and 255`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "retention_policy_rules_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.retentionPolicyId],
      foreignColumns: [retentionPolicies.organizationId, retentionPolicies.id],
      name: "retention_policy_rules_retention_policy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("retention_policy_rules_organization_id_policy_rule_unique").on(
      table.organizationId,
      table.retentionPolicyId,
      table.dataClass,
      table.purpose,
      table.triggerEvent,
    ),
    unique("retention_policy_rules_organization_id_id_unique").on(table.organizationId, table.id),
    index("retention_policy_rules_organization_policy_idx").on(
      table.organizationId,
      table.retentionPolicyId,
    ),
    index("retention_policy_rules_organization_class_trigger_idx").on(
      table.organizationId,
      table.dataClass,
      table.triggerEvent,
    ),
  ],
);
