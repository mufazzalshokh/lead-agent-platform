import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { channelConnections } from "./channel-connections.js";
import { mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { locations } from "./locations.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";
import { businessPolicies, services } from "./services.js";

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    sourceChannelConnectionId: uuid("source_channel_connection_id").notNull(),
    campaignKey: varchar("campaign_key", { length: 128 }),
    serviceId: uuid("service_id"),
    locationId: uuid("location_id"),
    assignedMembershipId: uuid("assigned_membership_id"),
    qualificationPolicyId: uuid("qualification_policy_id"),
    qualificationReasonCodes: varchar("qualification_reason_codes", { length: 100 })
      .array()
      .default(sql`array[]::varchar(100)[]`)
      .notNull(),
    engagedAt: timestamp("engaged_at", { mode: "date", withTimezone: true }),
    qualifiedAt: timestamp("qualified_at", { mode: "date", withTimezone: true }),
    bookingRequestedAt: timestamp("booking_requested_at", {
      mode: "date",
      withTimezone: true,
    }),
    convertedAt: timestamp("converted_at", { mode: "date", withTimezone: true }),
    closedAt: timestamp("closed_at", { mode: "date", withTimezone: true }),
    closedReason: varchar("closed_reason", { length: 100 }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "leads_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "leads_status_check",
      sql`${table.status} in ('new', 'engaged', 'qualified', 'booking_requested', 'converted', 'disqualified', 'closed')`,
    ),
    check(
      "leads_campaign_key_check",
      sql`${table.campaignKey} is null
        or (${table.campaignKey} = lower(btrim(${table.campaignKey}))
          and ${table.campaignKey} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$')`,
    ),
    check(
      "leads_qualification_reason_codes_check",
      sql`cardinality(${table.qualificationReasonCodes}) between 0 and 16
        and array_position(${table.qualificationReasonCodes}, null) is null
        and (cardinality(${table.qualificationReasonCodes}) = 0
          or array_to_string(${table.qualificationReasonCodes}, ',')
            ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:,[a-z][a-z0-9]*(?:_[a-z0-9]+)*)*$')`,
    ),
    check(
      "leads_closed_shape_check",
      sql`(${table.status} = 'closed') = (${table.closedAt} is not null and ${table.closedReason} is not null)`,
    ),
    check(
      "leads_closed_reason_check",
      sql`${table.closedReason} is null
        or ${table.closedReason} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check("leads_version_check", sql`${table.version} > 0`),
    check("leads_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "leads_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "leads_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.sourceChannelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "leads_source_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "leads_service_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "leads_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.assignedMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "leads_assigned_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.qualificationPolicyId],
      foreignColumns: [businessPolicies.organizationId, businessPolicies.id],
      name: "leads_qualification_policy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("leads_organization_id_id_unique").on(table.organizationId, table.id),
    unique("leads_organization_contact_id_unique").on(
      table.organizationId,
      table.contactId,
      table.id,
    ),
    index("leads_organization_status_updated_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt.desc(),
    ),
    index("leads_organization_contact_created_idx").on(
      table.organizationId,
      table.contactId,
      table.createdAt.desc(),
    ),
    index("leads_organization_assignee_status_idx").on(
      table.organizationId,
      table.assignedMembershipId,
      table.status,
    ),
  ],
);
