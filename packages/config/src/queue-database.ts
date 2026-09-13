import { URL } from "node:url";

import { ConfigurationValidationError } from "./database.js";

const queueDatabaseRuntimeConfigBrand: unique symbol = Symbol("QueueDatabaseRuntimeConfig");

export const QUEUE_DATABASE_URL_ENVIRONMENT_KEY = "QUEUE_DATABASE_URL" as const;

export type QueueDatabaseRuntimeConfigInput = Readonly<{
  connectionString: unknown;
  connectionTimeoutMilliseconds?: unknown;
  maxConnections?: unknown;
}>;

export type QueueDatabaseRuntimeConfig = Readonly<{
  connectionString: string;
  connectionTimeoutMilliseconds: number;
  maxConnections: number;
  [queueDatabaseRuntimeConfigBrand]: true;
}>;

const requireBoundedInteger = (
  value: unknown,
  key: string,
  defaultValue: number,
  maximum: number,
): number => {
  const candidate = value ?? defaultValue;
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    throw new ConfigurationValidationError(key);
  }
  return candidate;
};

const requirePostgreSqlConnectionString = (value: unknown, key: string): string => {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new ConfigurationValidationError(key);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationValidationError(key);
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname.length === 0 ||
    parsed.username.length === 0 ||
    databaseName.length === 0
  ) {
    throw new ConfigurationValidationError(key);
  }
  return value;
};

export const createQueueDatabaseRuntimeConfig = (
  input: QueueDatabaseRuntimeConfigInput,
): QueueDatabaseRuntimeConfig =>
  Object.freeze({
    connectionString: requirePostgreSqlConnectionString(input.connectionString, "connectionString"),
    connectionTimeoutMilliseconds: requireBoundedInteger(
      input.connectionTimeoutMilliseconds,
      "connectionTimeoutMilliseconds",
      10_000,
      120_000,
    ),
    maxConnections: requireBoundedInteger(input.maxConnections, "maxConnections", 4, 20),
    [queueDatabaseRuntimeConfigBrand]: true as const,
  });

export const loadQueueDatabaseRuntimeConfig = (
  environment: NodeJS.ProcessEnv,
): QueueDatabaseRuntimeConfig => {
  const connectionString = environment[QUEUE_DATABASE_URL_ENVIRONMENT_KEY];
  try {
    return createQueueDatabaseRuntimeConfig({ connectionString });
  } catch (error) {
    if (error instanceof ConfigurationValidationError && error.key === "connectionString") {
      throw new ConfigurationValidationError(QUEUE_DATABASE_URL_ENVIRONMENT_KEY);
    }
    throw error;
  }
};
