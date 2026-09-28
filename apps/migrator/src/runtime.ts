export type StagingMigrationResult = Readonly<{
  migrationCount: number;
  migrationHead: string;
}>;

export type StagingMigration = (environment: NodeJS.ProcessEnv) => Promise<StagingMigrationResult>;

type FailureStage = "load_migrator" | "apply_migrations";

type MigratorRuntimeDependencies = Readonly<{
  environment: NodeJS.ProcessEnv;
  loadMigration: () => Promise<StagingMigration>;
  writeError: (message: string) => void;
  writeInfo: (message: string) => void;
}>;

const DATABASE_SECRET_KEYS = Object.freeze([
  "AUTH_DATABASE_URL",
  "DATABASE_URL",
  "INGRESS_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "QUEUE_DATABASE_URL",
] as const);

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const errorChain = (error: unknown): readonly unknown[] => {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined; depth += 1) {
    chain.push(current);
    current = asRecord(current)?.["cause"];
  }
  return chain;
};

const stringProperty = (value: unknown, property: string): string | undefined => {
  const candidate = asRecord(value)?.[property];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
};

const sensitiveValues = (environment: NodeJS.ProcessEnv): readonly string[] => {
  const values = new Set<string>();
  for (const key of DATABASE_SECRET_KEYS) {
    const value = environment[key];
    if (value === undefined || value.length === 0) continue;
    values.add(value);
    try {
      const parsed = new URL(value);
      if (parsed.password.length >= 4) {
        values.add(parsed.password);
        values.add(decodeURIComponent(parsed.password));
      }
    } catch {
      // A malformed secret is still redacted in full above.
    }
  }
  return [...values]
    .filter((value) => value.length >= 4)
    .sort((left, right) => right.length - left.length);
};

const redact = (value: string, environment: NodeJS.ProcessEnv): string => {
  let redacted = value;
  for (const secret of sensitiveValues(environment))
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/giu, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[^\s"'<>]+/giu, "Bearer [REDACTED]")
    .replace(/((?:password|token|secret|authorization)\s*[:=]\s*)[^\s,;"'<>]+/giu, "$1[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1200);
};

const safeErrorType = (chain: readonly unknown[]): string => {
  const candidate = chain
    .map((entry) => (entry instanceof Error ? entry.name : stringProperty(entry, "name")))
    .find((value) => value !== undefined && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value));
  return candidate ?? "UnknownError";
};

const safeErrorCode = (chain: readonly unknown[]): string | null => {
  const candidate = chain
    .map((entry) => stringProperty(entry, "code"))
    .find((value) => value !== undefined && /^[0-9A-Z_]{2,32}$/u.test(value));
  return candidate ?? null;
};

const classifyError = (code: string | null, message: string): string => {
  if (code?.startsWith("08") === true || /(?:ECONN|ENET|EHOST|timeout)/iu.test(message)) {
    return "database_connectivity";
  }
  if (code?.startsWith("28") === true) return "database_authentication";
  if (code === "42501") return "database_permission";
  if (code?.startsWith("23") === true) return "database_constraint";
  if (code?.startsWith("42") === true) return "database_schema";
  if (/migration journal/iu.test(message)) return "migration_manifest";
  if (/(?:module|import|package|cannot find)/iu.test(message)) return "application_startup";
  return code === null ? "migration_failure" : "database_error";
};

export const sanitizedMigrationFailure = (
  error: unknown,
  environment: NodeJS.ProcessEnv,
  failureStage: FailureStage,
): Readonly<Record<string, string | null>> => {
  const chain = errorChain(error);
  const rawMessage = chain
    .map((entry) => (entry instanceof Error ? entry.message : stringProperty(entry, "message")))
    .filter((value): value is string => value !== undefined)
    .join(" | caused_by: ");
  const errorMessage = redact(
    rawMessage || "Migration failed without an Error message",
    environment,
  );
  const errorCode = safeErrorCode(chain);
  const migrationIdentifier = errorMessage.match(/\b[0-9]{4}_[a-z0-9_]+\b/u)?.[0] ?? null;
  return Object.freeze({
    error_category: classifyError(errorCode, errorMessage),
    error_code: errorCode,
    error_message: errorMessage,
    error_type: safeErrorType(chain),
    failure_stage: failureStage,
    migration_identifier: migrationIdentifier,
  });
};

const safeDeploymentValue = (environment: NodeJS.ProcessEnv, key: string): string =>
  environment[key]?.trim() || "unavailable";

export const runStagingMigrator = async (
  dependencies: MigratorRuntimeDependencies,
): Promise<0 | 1> => {
  let failureStage: FailureStage = "load_migrator";
  try {
    const migrate = await dependencies.loadMigration();
    failureStage = "apply_migrations";
    const result = await migrate(dependencies.environment);
    dependencies.writeInfo(
      JSON.stringify({
        deployment_timestamp: safeDeploymentValue(dependencies.environment, "DEPLOYMENT_TIMESTAMP"),
        environment: "staging",
        git_commit_sha: safeDeploymentValue(dependencies.environment, "DEPLOYMENT_GIT_SHA"),
        image_digest: safeDeploymentValue(dependencies.environment, "DEPLOYMENT_IMAGE_DIGEST"),
        migration_count: result.migrationCount,
        migration_head: result.migrationHead,
        operation: "database_migration",
        outcome: "succeeded",
      }),
    );
    return 0;
  } catch (error: unknown) {
    dependencies.writeError(
      JSON.stringify({
        environment: "staging",
        operation: "database_migration",
        outcome: "failed",
        ...sanitizedMigrationFailure(error, dependencies.environment, failureStage),
      }),
    );
    return 1;
  }
};
