import type { TenantDatabaseRuntimeConfig } from "@lead-agent/config";
import {
  ChannelConnectionIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
} from "@lead-agent/contracts";
import type { WidgetRouteResolver } from "@lead-agent/application";
import { Pool } from "pg";

const REQUIRED_ROLE = "lead_agent_ingress";

export class InboundRouteRuntimeError extends Error {
  readonly code = "inbound_route_unavailable" as const;
  constructor() {
    super("Inbound route resolution is unavailable");
    this.name = "InboundRouteRuntimeError";
  }
}

export type InboundRouteDatabaseRuntime = WidgetRouteResolver &
  Readonly<{
    close(): Promise<void>;
    verifyReady(): Promise<void>;
  }>;

export const createInboundRouteDatabaseRuntime = (
  configuration: TenantDatabaseRuntimeConfig,
  observability: Readonly<{ onUnexpectedPoolError(error: Error): void }>,
): InboundRouteDatabaseRuntime => {
  const pool = new Pool({
    connectionString: configuration.connectionString,
    connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
    idleTimeoutMillis: configuration.idleTimeoutMilliseconds,
    max: configuration.maxConnections,
    statement_timeout: configuration.statementTimeoutMilliseconds,
  });
  pool.on("error", observability.onUnexpectedPoolError);
  let closed = false;
  const requireRole = async (): Promise<void> => {
    if (closed) throw new InboundRouteRuntimeError();
    const result = await pool.query<{ database_role: string }>(
      "select current_user as database_role",
    );
    if (result.rows[0]?.database_role !== REQUIRED_ROLE) throw new InboundRouteRuntimeError();
  };
  return Object.freeze({
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
    resolveWidgetRoute: async (routeKeyHash: Uint8Array) => {
      try {
        await requireRole();
        if (!(routeKeyHash instanceof Uint8Array) || routeKeyHash.byteLength !== 32) return null;
        const result = await pool.query<{
          channel_connection_id: string;
          organization_id: string;
        }>(
          "select organization_id::text, channel_connection_id::text from app.resolve_inbound_route('widget_key', $1::bytea)",
          [Buffer.from(routeKeyHash)],
        );
        const row = result.rows[0];
        if (row === undefined) return null;
        if (
          !isSchemaValue(OrganizationIdSchema, row.organization_id) ||
          !isSchemaValue(ChannelConnectionIdSchema, row.channel_connection_id)
        )
          throw new InboundRouteRuntimeError();
        return Object.freeze({
          channelConnectionId: row.channel_connection_id,
          organizationId: row.organization_id,
        });
      } catch (error) {
        if (error instanceof InboundRouteRuntimeError) throw error;
        throw new InboundRouteRuntimeError();
      }
    },
    verifyReady: requireRole,
  });
};
