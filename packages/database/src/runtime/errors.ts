export class TenantContextMismatchError extends Error {
  readonly code = "tenant_context_mismatch" as const;

  constructor() {
    super("Tenant session cannot be reused for a different organization");
    this.name = "TenantContextMismatchError";
  }
}

export class TenantSessionClosedError extends Error {
  readonly code = "tenant_session_closed" as const;

  constructor() {
    super("Tenant database session is no longer active");
    this.name = "TenantSessionClosedError";
  }
}

export class TenantDatabaseRuntimeClosedError extends Error {
  readonly code = "tenant_database_runtime_closed" as const;

  constructor() {
    super("Tenant database runtime is closed");
    this.name = "TenantDatabaseRuntimeClosedError";
  }
}

export class TenantRuntimeRoleError extends Error {
  readonly code = "tenant_runtime_role_required" as const;

  constructor() {
    super("Tenant transactions require the configured application runtime role");
    this.name = "TenantRuntimeRoleError";
  }
}

export class TenantContextInitializationError extends Error {
  readonly code = "tenant_context_initialization_failed" as const;

  constructor() {
    super("Tenant transaction context could not be initialized safely");
    this.name = "TenantContextInitializationError";
  }
}

export class TenantTransactionRollbackError extends AggregateError {
  readonly code = "tenant_transaction_rollback_failed" as const;

  constructor(primaryError: unknown, rollbackError: unknown) {
    super([primaryError, rollbackError], "Tenant transaction rollback failed");
    this.name = "TenantTransactionRollbackError";
  }
}

export type PostgreSqlErrorClassification =
  | Readonly<{ code: "active_record_conflict"; resource: "conversation" | "lead" }>
  | Readonly<{ code: "database_unavailable" }>
  | Readonly<{ code: "integrity_conflict"; violation: "check" | "foreign_key" | "unique" }>
  | Readonly<{ code: "transaction_conflict"; reason: "deadlock" | "serialization_failure" }>
  | Readonly<{ code: "unclassified_database_error" }>;

const readStringProperty = (value: unknown, property: string): string | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = Reflect.get(value, property) as unknown;
  return typeof candidate === "string" ? candidate : undefined;
};

export const classifyPostgreSqlError = (error: unknown): PostgreSqlErrorClassification => {
  const sqlState = readStringProperty(error, "code");
  const constraint = readStringProperty(error, "constraint");

  if (sqlState === "23505" && constraint === "leads_one_active_per_contact_unique") {
    return Object.freeze({ code: "active_record_conflict", resource: "lead" });
  }
  if (sqlState === "23505" && constraint === "conversations_one_active_per_thread_unique") {
    return Object.freeze({ code: "active_record_conflict", resource: "conversation" });
  }
  if (sqlState === "23505") {
    return Object.freeze({ code: "integrity_conflict", violation: "unique" });
  }
  if (sqlState === "23503") {
    return Object.freeze({ code: "integrity_conflict", violation: "foreign_key" });
  }
  if (sqlState === "23514") {
    return Object.freeze({ code: "integrity_conflict", violation: "check" });
  }
  if (sqlState === "40001") {
    return Object.freeze({ code: "transaction_conflict", reason: "serialization_failure" });
  }
  if (sqlState === "40P01") {
    return Object.freeze({ code: "transaction_conflict", reason: "deadlock" });
  }
  if (sqlState?.startsWith("08") === true) {
    return Object.freeze({ code: "database_unavailable" });
  }
  return Object.freeze({ code: "unclassified_database_error" });
};
