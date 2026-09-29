const ORGANIZATION_ID = "01a0ee39-91a9-7293-82c0-5b7046c10115";
const USER_ID = "01a0ee39-91af-7bfa-945f-b87959be6f0b";
const MEMBERSHIP_ID = "01a0ee39-91b0-72c2-a2bb-f45d5bcc3ee4";
const AUDIT_ID = "01a0ee39-91b0-7cb5-9bb6-bc34d73137f2";
let failureExitCode = 70;

const required = (name) => {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${name} is unavailable`);
  }
  return value;
};

const assertInput = (issuer, subject) => {
  const parsed = new URL(issuer);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !issuer.endsWith("/")
  ) {
    throw new Error("The configured Auth0 issuer is invalid");
  }
  if (!/^google-oauth2\|[0-9]{1,128}$/u.test(subject)) {
    throw new Error("The staging owner Auth0 subject is invalid");
  }
};

const assertBootstrapResult = (result) => {
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    row?.outcome !== "created" ||
    row.organization_id !== ORGANIZATION_ID ||
    row.user_id !== USER_ID ||
    row.membership_id !== MEMBERSHIP_ID ||
    row.membership_status !== "active" ||
    row.membership_role !== "owner" ||
    row.audit_event_id !== AUDIT_ID
  ) {
    throw new Error("The first-tenant capability returned an unexpected result");
  }
};

const bootstrap = async () => {
  failureExitCode = 71;
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  failureExitCode = 72;
  const connectionString = withLibpqCompatibleRequireSsl(required("MIGRATION_DATABASE_URL"));
  const issuer = required("STAGING_AUTH0_ISSUER");
  const subject = required("STAGING_OWNER_AUTH0_SUBJECT");
  assertInput(issuer, subject);

  failureExitCode = 73;
  const pool = new Pool({
    application_name: "lead-agent-staging-owner-bootstrap",
    connectionString,
    max: 1,
  });
  const client = await pool.connect();
  try {
    failureExitCode = 74;
    await client.query("begin isolation level serializable");
    try {
      failureExitCode = 75;
      const result = await client.query(
        "select * from app.bootstrap_first_staging_owner($1::character varying, $2::character varying)",
        [issuer, subject],
      );
      assertBootstrapResult(result);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    failureExitCode = 76;
    console.info(
      JSON.stringify({
        organization_id: ORGANIZATION_ID,
        operation: "staging_owner_workspace_bootstrap",
        outcome: "PASS",
        role: "owner",
        tenant_isolation: "exact_issuer_subject_and_membership",
      }),
    );
  } finally {
    client.release();
    await pool.end();
  }
};

bootstrap().catch((error) => {
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[0-9A-Z_]{2,32}$/u.test(error.code)
      ? error.code
      : "UNAVAILABLE";
  const errorType =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(error.name)
      ? error.name
      : "Error";
  console.error(
    JSON.stringify({
      error_code: errorCode,
      error_type: errorType,
      operation: "staging_owner_workspace_bootstrap",
      outcome: "FAIL",
    }),
  );
  process.exitCode = failureExitCode;
});
