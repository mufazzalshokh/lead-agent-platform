import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { binary, mutableColumns } from "./common.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    emailCiphertext: binary("email_ciphertext"),
    emailLookupHash: binary("email_lookup_hash"),
    displayNameCiphertext: binary("display_name_ciphertext"),
    status: varchar("status", { length: 16 }).notNull(),
    lastAuthenticatedAt: timestamp("last_authenticated_at", {
      mode: "date",
      withTimezone: true,
    }),
    ...mutableColumns(),
  },
  (table) => [
    check(
      "users_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "users_email_pair_check",
      sql`(${table.emailCiphertext} is null) = (${table.emailLookupHash} is null)`,
    ),
    check("users_status_check", sql`${table.status} in ('active', 'suspended', 'deleted')`),
    check(
      "users_deleted_pii_check",
      sql`${table.status} <> 'deleted' or (${table.emailCiphertext} is null and ${table.emailLookupHash} is null and ${table.displayNameCiphertext} is null)`,
    ),
    check("users_version_check", sql`${table.version} > 0`),
    check("users_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    index("users_status_last_authenticated_at_idx").on(table.status, table.lastAuthenticatedAt),
  ],
);
