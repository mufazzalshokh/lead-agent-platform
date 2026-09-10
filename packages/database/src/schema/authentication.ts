import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { binary, immutableCreatedAt, mutableColumns } from "./common.js";
import { locations } from "./locations.js";
import { memberships, organizations } from "./tenant-control.js";
import { users } from "./users.js";

export const externalIdentities = pgTable(
  "external_identities",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    issuer: varchar("issuer", { length: 2048 }).notNull(),
    subject: varchar("subject", { length: 512 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    linkedAt: timestamp("linked_at", { mode: "date", withTimezone: true }).notNull(),
    lastAuthenticatedAt: timestamp("last_authenticated_at", {
      mode: "date",
      withTimezone: true,
    }),
    disabledAt: timestamp("disabled_at", { mode: "date", withTimezone: true }),
    unlinkedAt: timestamp("unlinked_at", { mode: "date", withTimezone: true }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "external_identities_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "external_identities_issuer_check",
      sql`${table.issuer} = btrim(${table.issuer}) and length(${table.issuer}) between 1 and 2048`,
    ),
    check("external_identities_subject_check", sql`length(${table.subject}) between 1 and 512`),
    check(
      "external_identities_status_check",
      sql`${table.status} in ('active', 'disabled', 'unlinked')`,
    ),
    check(
      "external_identities_lifecycle_check",
      sql`(${table.status} = 'active'
          and ${table.disabledAt} is null
          and ${table.unlinkedAt} is null)
        or (${table.status} = 'disabled'
          and ${table.disabledAt} is not null
          and ${table.unlinkedAt} is null)
        or (${table.status} = 'unlinked'
          and ${table.unlinkedAt} is not null)`,
    ),
    check(
      "external_identities_lifecycle_timestamps_check",
      sql`${table.lastAuthenticatedAt} is null or ${table.lastAuthenticatedAt} >= ${table.linkedAt}`,
    ),
    check(
      "external_identities_terminal_timestamps_check",
      sql`(${table.disabledAt} is null or ${table.disabledAt} >= ${table.linkedAt})
        and (${table.unlinkedAt} is null or ${table.unlinkedAt} >= ${table.linkedAt})`,
    ),
    check("external_identities_version_check", sql`${table.version} > 0`),
    check(
      "external_identities_timestamps_check",
      sql`${table.linkedAt} >= ${table.createdAt} and ${table.updatedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "external_identities_user_id_users_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("external_identities_issuer_subject_unique").on(table.issuer, table.subject),
    index("external_identities_user_status_idx").on(table.userId, table.status),
  ],
);

export const membershipInvitations = pgTable(
  "membership_invitations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    targetCiphertext: binary("target_ciphertext").notNull(),
    targetLookupHash: binary("target_lookup_hash").notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    locationScope: varchar("location_scope", { length: 16 }).notNull(),
    tokenHash: binary("token_hash").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    invitedByMembershipId: uuid("invited_by_membership_id").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "date", withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id"),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    revokedByMembershipId: uuid("revoked_by_membership_id"),
    revocationReason: varchar("revocation_reason", { length: 500 }),
    expiredAt: timestamp("expired_at", { mode: "date", withTimezone: true }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "membership_invitations_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "membership_invitations_target_ciphertext_check",
      sql`octet_length(${table.targetCiphertext}) between 1 and 8192`,
    ),
    check(
      "membership_invitations_target_lookup_hash_check",
      sql`octet_length(${table.targetLookupHash}) between 16 and 128`,
    ),
    check(
      "membership_invitations_token_hash_check",
      sql`octet_length(${table.tokenHash}) between 16 and 128`,
    ),
    check(
      "membership_invitations_role_check",
      sql`${table.role} in ('owner', 'admin', 'staff', 'analyst')`,
    ),
    check(
      "membership_invitations_location_scope_check",
      sql`${table.locationScope} in ('all', 'restricted')
        and (${table.role} not in ('owner', 'admin') or ${table.locationScope} = 'all')`,
    ),
    check(
      "membership_invitations_status_check",
      sql`${table.status} in ('active', 'accepted', 'revoked', 'expired')`,
    ),
    check(
      "membership_invitations_lifetime_check",
      sql`${table.expiresAt} = ${table.createdAt} + interval '7 days'`,
    ),
    check(
      "membership_invitations_lifecycle_check",
      sql`(${table.status} = 'active'
          and ${table.acceptedAt} is null
          and ${table.acceptedByUserId} is null
          and ${table.revokedAt} is null
          and ${table.revokedByMembershipId} is null
          and ${table.revocationReason} is null
          and ${table.expiredAt} is null)
        or (${table.status} = 'accepted'
          and ${table.acceptedAt} is not null
          and ${table.acceptedByUserId} is not null
          and ${table.revokedAt} is null
          and ${table.revokedByMembershipId} is null
          and ${table.revocationReason} is null
          and ${table.expiredAt} is null)
        or (${table.status} = 'revoked'
          and ${table.acceptedAt} is null
          and ${table.acceptedByUserId} is null
          and ${table.revokedAt} is not null
          and ${table.revokedByMembershipId} is not null
          and ${table.revocationReason} is not null
          and ${table.expiredAt} is null)
        or (${table.status} = 'expired'
          and ${table.acceptedAt} is null
          and ${table.acceptedByUserId} is null
          and ${table.revokedAt} is null
          and ${table.revokedByMembershipId} is null
          and ${table.revocationReason} is null
          and ${table.expiredAt} is not null)`,
    ),
    check(
      "membership_invitations_lifecycle_timestamps_check",
      sql`(${table.acceptedAt} is null
          or (${table.acceptedAt} >= ${table.createdAt}
            and ${table.acceptedAt} < ${table.expiresAt}))
        and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt})
        and (${table.expiredAt} is null or ${table.expiredAt} >= ${table.expiresAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "membership_invitations_revocation_reason_check",
      sql`${table.revocationReason} is null
        or (${table.revocationReason} = btrim(${table.revocationReason})
          and length(${table.revocationReason}) between 1 and 500)`,
    ),
    check("membership_invitations_version_check", sql`${table.version} > 0`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "membership_invitations_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.invitedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "membership_invitations_inviter_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.acceptedByUserId],
      foreignColumns: [users.id],
      name: "membership_invitations_accepted_by_user_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.revokedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "membership_invitations_revoker_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("membership_invitations_token_hash_unique").on(table.tokenHash),
    unique("membership_invitations_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("membership_invitations_one_active_target_unique")
      .on(table.organizationId, table.targetLookupHash)
      .where(sql`${table.status} = 'active'`),
    index("membership_invitations_organization_status_expires_at_idx").on(
      table.organizationId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    sessionTokenHash: binary("session_token_hash").notNull(),
    csrfSecretHash: binary("csrf_secret_hash").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    authenticationTime: timestamp("authentication_time", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    authenticationLevel: varchar("authentication_level", { length: 32 }).notNull(),
    createdAt: immutableCreatedAt(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }).notNull(),
    idleExpiresAt: timestamp("idle_expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    revocationReason: varchar("revocation_reason", { length: 500 }),
    sourceIpHash: binary("source_ip_hash"),
    userAgentHash: binary("user_agent_hash"),
    rotatedAt: timestamp("rotated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "auth_sessions_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "auth_sessions_session_token_hash_check",
      sql`octet_length(${table.sessionTokenHash}) between 16 and 128`,
    ),
    check(
      "auth_sessions_csrf_secret_hash_check",
      sql`octet_length(${table.csrfSecretHash}) between 16 and 128`,
    ),
    check("auth_sessions_status_check", sql`${table.status} in ('active', 'revoked', 'expired')`),
    check(
      "auth_sessions_authentication_level_check",
      sql`${table.authenticationLevel} = lower(btrim(${table.authenticationLevel}))
        and ${table.authenticationLevel} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`,
    ),
    check(
      "auth_sessions_lifetime_check",
      sql`${table.authenticationTime} <= ${table.lastSeenAt}
        and ${table.rotatedAt} >= ${table.createdAt}
        and ${table.lastSeenAt} >= ${table.createdAt}
        and ${table.idleExpiresAt} > ${table.lastSeenAt}
        and ${table.idleExpiresAt} <= ${table.absoluteExpiresAt}
        and ${table.absoluteExpiresAt} > ${table.createdAt}`,
    ),
    check(
      "auth_sessions_revocation_check",
      sql`(${table.status} = 'revoked'
          and ${table.revokedAt} is not null
          and ${table.revocationReason} is not null)
        or (${table.status} <> 'revoked'
          and ${table.revokedAt} is null
          and ${table.revocationReason} is null)`,
    ),
    check(
      "auth_sessions_revocation_timestamp_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
    check(
      "auth_sessions_revocation_reason_check",
      sql`${table.revocationReason} is null
        or (${table.revocationReason} = btrim(${table.revocationReason})
          and length(${table.revocationReason}) between 1 and 500)`,
    ),
    check(
      "auth_sessions_source_ip_hash_check",
      sql`${table.sourceIpHash} is null or octet_length(${table.sourceIpHash}) between 16 and 128`,
    ),
    check(
      "auth_sessions_user_agent_hash_check",
      sql`${table.userAgentHash} is null or octet_length(${table.userAgentHash}) between 16 and 128`,
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "auth_sessions_user_id_users_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("auth_sessions_session_token_hash_unique").on(table.sessionTokenHash),
    unique("auth_sessions_user_id_id_unique").on(table.userId, table.id),
    index("auth_sessions_user_status_last_seen_at_idx").on(
      table.userId,
      table.status,
      table.lastSeenAt.desc(),
    ),
    index("auth_sessions_status_idle_expires_at_idx").on(table.status, table.idleExpiresAt),
    index("auth_sessions_status_absolute_expires_at_idx").on(table.status, table.absoluteExpiresAt),
  ],
);

export const membershipLocationScopes = pgTable(
  "membership_location_scopes",
  {
    organizationId: uuid("organization_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdAt: immutableCreatedAt(),
    createdByUserId: uuid("created_by_user_id").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({
      columns: [table.organizationId, table.membershipId, table.locationId],
      name: "membership_location_scopes_pk",
    }),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "membership_location_scopes_membership_fk",
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "membership_location_scopes_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.createdByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "membership_location_scopes_creator_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("membership_location_scopes_organization_location_membership_idx").on(
      table.organizationId,
      table.locationId,
      table.membershipId,
    ),
  ],
);
