import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  unique,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { channelConnections } from "./channel-connections.js";
import { binary, mutableColumns } from "./common.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";

/**
 * Pre-ingress authority for mixed-use social threads. This is deliberately
 * separate from Conversation automation ownership: a control may exist before
 * any customer or business aggregate exists.
 */
export const threadAutomationControls = pgTable(
  "thread_automation_controls",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    externalThreadHash: binary("external_thread_hash").notNull(),
    eligibilityState: varchar("eligibility_state", { length: 24 }).notNull(),
    decisionSource: varchar("decision_source", { length: 32 }).notNull(),
    reasonCode: varchar("reason_code", { length: 100 }).notNull(),
    decidedByMembershipId: uuid("decided_by_membership_id"),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "thread_automation_controls_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "thread_automation_controls_thread_hash_check",
      sql`octet_length(${table.externalThreadHash}) between 16 and 128`,
    ),
    check(
      "thread_automation_controls_eligibility_state_check",
      sql`${table.eligibilityState} in ('business_eligible', 'excluded_personal', 'uncertain', 'staff_only')`,
    ),
    check(
      "thread_automation_controls_decision_source_check",
      sql`${table.decisionSource} in ('system_default', 'staff', 'owner_configuration', 'provider_rule', 'platform_policy')`,
    ),
    check(
      "thread_automation_controls_reason_code_check",
      sql`${table.reasonCode} = lower(btrim(${table.reasonCode}))
        and length(${table.reasonCode}) between 1 and 100
        and ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "thread_automation_controls_staff_provenance_check",
      sql`(${table.decisionSource} = 'staff') = (${table.decidedByMembershipId} is not null)`,
    ),
    check("thread_automation_controls_version_check", sql`${table.version} > 0`),
    check(
      "thread_automation_controls_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "thread_automation_controls_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "thread_automation_controls_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.decidedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "thread_automation_controls_decider_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("thread_automation_controls_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    unique("thread_automation_controls_thread_unique").on(
      table.organizationId,
      table.channelConnectionId,
      table.externalThreadHash,
    ),
    index("thread_automation_controls_hot_lookup_idx").on(
      table.organizationId,
      table.channelConnectionId,
      table.externalThreadHash,
    ),
    index("thread_automation_controls_organization_state_updated_idx").on(
      table.organizationId,
      table.eligibilityState,
      table.updatedAt.desc(),
    ),
  ],
);
