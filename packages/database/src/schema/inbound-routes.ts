import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { binary, immutableCreatedAt } from "./common.js";
import { channelConnections } from "./channels.js";
import { organizations } from "./organizations.js";

export const inboundRoutes = pgTable(
  "inbound_routes",
  {
    id: uuid("id").primaryKey(),
    routeType: varchar("route_type", { length: 32 }).notNull(),
    routeKeyHash: binary("route_key_hash").notNull(),
    organizationId: uuid("organization_id").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    rotatedAt: timestamp("rotated_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: immutableCreatedAt(),
  },
  (table) => [
    check(
      "inbound_routes_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "inbound_routes_channel_connection_uuid_v7_check",
      sql`${table.channelConnectionId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "inbound_routes_route_type_check",
      sql`${table.routeType} in ('widget_key', 'telegram_webhook')`,
    ),
    check("inbound_routes_route_key_hash_check", sql`octet_length(${table.routeKeyHash}) > 0`),
    check("inbound_routes_status_check", sql`${table.status} in ('active', 'disabled')`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "inbound_routes_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "inbound_routes_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("inbound_routes_organization_id_id_unique").on(table.organizationId, table.id),
    unique("inbound_routes_route_type_route_key_hash_unique").on(
      table.routeType,
      table.routeKeyHash,
    ),
    uniqueIndex("inbound_routes_one_active_per_connection_type_unique")
      .on(table.organizationId, table.channelConnectionId, table.routeType)
      .where(sql`${table.status} = 'active'`),
  ],
);
