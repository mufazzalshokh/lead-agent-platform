import type { QueueDatabaseRuntimeConfig } from "@lead-agent/config";
import { PgBoss } from "pg-boss";

export const PG_BOSS_PACKAGE_VERSION = "12.31.0" as const;
export const PG_BOSS_SCHEMA = "pgboss" as const;
export const PG_BOSS_SCHEMA_VERSION = 41 as const;
export const PG_BOSS_CONSTRUCTION_PLAN_SHA256 =
  "47cb669984703400f9d39066d3c3ce649d5ffab050967125295397c29da592ef" as const;

export const QUEUE_NAMES = Object.freeze([
  "inbound",
  "ai",
  "outbound_message",
  "staff_notification",
  "analytics",
  "maintenance",
] as const);

export type QueueName = (typeof QUEUE_NAMES)[number];

export type QueueInfrastructure = Readonly<{
  start: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export const createQueueInfrastructure = (
  configuration: QueueDatabaseRuntimeConfig,
): QueueInfrastructure => {
  const boss = new PgBoss({
    application_name: "lead-agent-worker-queue",
    connectionString: configuration.connectionString,
    connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
    createSchema: false,
    max: configuration.maxConnections,
    migrate: false,
    reindex: false,
    schedule: false,
    schema: PG_BOSS_SCHEMA,
    supervise: false,
    useListenNotify: false,
  });

  return Object.freeze({
    start: async (): Promise<void> => {
      await boss.start();
    },
    stop: async (): Promise<void> => {
      await boss.stop();
    },
  });
};
