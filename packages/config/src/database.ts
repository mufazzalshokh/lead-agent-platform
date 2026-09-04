import { URL } from "node:url";

const tenantDatabaseRuntimeConfigBrand: unique symbol = Symbol("TenantDatabaseRuntimeConfig");

export type TenantDatabaseRuntimeConfigInput = Readonly<{
  connectionString: unknown;
  connectionTimeoutMilliseconds?: unknown;
  idleTimeoutMilliseconds?: unknown;
  maxConnections?: unknown;
  statementTimeoutMilliseconds?: unknown;
}>;

export type TenantDatabaseRuntimeConfig = Readonly<{
  connectionString: string;
  connectionTimeoutMilliseconds: number;
  idleTimeoutMilliseconds: number;
  maxConnections: number;
  statementTimeoutMilliseconds: number;
  [tenantDatabaseRuntimeConfigBrand]: true;
}>;

export class ConfigurationValidationError extends Error {
  readonly code = "configuration_invalid" as const;
  readonly key: string;

  constructor(key: string) {
    super(`Invalid configuration: ${key}`);
    this.name = "ConfigurationValidationError";
    this.key = key;
  }
}

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

const requirePostgreSqlConnectionString = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigurationValidationError("connectionString");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationValidationError("connectionString");
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname.length === 0 ||
    parsed.username.length === 0 ||
    databaseName.length === 0
  ) {
    throw new ConfigurationValidationError("connectionString");
  }

  return value;
};

export const createTenantDatabaseRuntimeConfig = (
  input: TenantDatabaseRuntimeConfigInput,
): TenantDatabaseRuntimeConfig =>
  Object.freeze({
    connectionString: requirePostgreSqlConnectionString(input.connectionString),
    connectionTimeoutMilliseconds: requireBoundedInteger(
      input.connectionTimeoutMilliseconds,
      "connectionTimeoutMilliseconds",
      10_000,
      120_000,
    ),
    idleTimeoutMilliseconds: requireBoundedInteger(
      input.idleTimeoutMilliseconds,
      "idleTimeoutMilliseconds",
      30_000,
      600_000,
    ),
    maxConnections: requireBoundedInteger(input.maxConnections, "maxConnections", 10, 100),
    statementTimeoutMilliseconds: requireBoundedInteger(
      input.statementTimeoutMilliseconds,
      "statementTimeoutMilliseconds",
      30_000,
      300_000,
    ),
    [tenantDatabaseRuntimeConfigBrand]: true as const,
  });
