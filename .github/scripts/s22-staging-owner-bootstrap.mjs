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

const assertReplayFailsClosed = async (client, issuer, subject) => {
  await client.query("begin isolation level serializable read only");
  let replayError;
  try {
    await client.query(
      "select * from app.bootstrap_first_staging_owner($1::character varying, $2::character varying)",
      [issuer, subject],
    );
  } catch (error) {
    replayError = error;
  } finally {
    await client.query("rollback");
  }
  const replayCode =
    typeof replayError === "object" &&
    replayError !== null &&
    "code" in replayError &&
    typeof replayError.code === "string"
      ? replayError.code
      : "";
  const replayDetail =
    typeof replayError === "object" &&
    replayError !== null &&
    "detail" in replayError &&
    typeof replayError.detail === "string"
      ? replayError.detail
      : "";
  if (replayCode !== "P0001" || replayDetail !== "S22_BOOTSTRAP_NOT_EMPTY") {
    throw new Error("The first-tenant bootstrap replay did not fail closed");
  }
};

const assertStoredWorkspace = async (client, issuer, subject) => {
  await client.query("begin isolation level serializable read only");
  try {
    await client.query("select set_config('app.organization_id', $1, true)", [ORGANIZATION_ID]);
    const result = await client.query(
      `select
         (select count(*)::integer from public.external_identities) as identity_count,
         (select count(*)::integer from public.external_identities where issuer = $1::character varying) as issuer_match_count,
         (select count(*)::integer from public.external_identities where subject = $2::character varying) as subject_match_count,
         (select count(*)::integer
            from public.external_identities
           where user_id = $3::uuid
             and issuer = $1::character varying
             and subject = $2::character varying
             and status = 'active') as exact_identity_count,
         (select count(*)::integer
            from public.memberships
           where id = $4::uuid
             and organization_id = $5::uuid
             and user_id = $3::uuid
             and status = 'active'
             and role = 'owner'
             and location_scope = 'all') as active_owner_membership_count,
         (select count(*)::integer
            from public.platform_audit_events
           where id = $6::uuid
             and target_organization_id = $5::uuid
             and target_id = $4::uuid
             and action = 'staging_owner_bootstrap'
             and result = 'succeeded') as bootstrap_audit_count`,
      [issuer, subject, USER_ID, MEMBERSHIP_ID, ORGANIZATION_ID, AUDIT_ID],
    );
    const row = result.rows[0];
    const checks = {
      active_owner_membership: row?.active_owner_membership_count === 1,
      bootstrap_audit: row?.bootstrap_audit_count === 1,
      exact_identity: row?.exact_identity_count === 1,
      identity_row_count: row?.identity_count ?? -1,
      issuer_match: row?.issuer_match_count === 1,
      subject_match: row?.subject_match_count === 1,
    };
    console.info(
      JSON.stringify({
        checks,
        operation: "staging_owner_workspace_identity_verify",
        outcome:
          checks.identity_row_count === 1 &&
          checks.issuer_match &&
          checks.subject_match &&
          checks.exact_identity &&
          checks.active_owner_membership &&
          checks.bootstrap_audit
            ? "PASS"
            : "FAIL",
      }),
    );
    if (
      checks.identity_row_count !== 1 ||
      !checks.issuer_match ||
      !checks.subject_match ||
      !checks.exact_identity ||
      !checks.active_owner_membership ||
      !checks.bootstrap_audit
    ) {
      const mismatchCode =
        checks.identity_row_count !== 1
          ? "S22_IDENTITY_COUNT"
          : !checks.issuer_match && !checks.subject_match
            ? "S22_ISSUER_SUBJECT_MISMATCH"
            : !checks.issuer_match
              ? "S22_ISSUER_MISMATCH"
              : !checks.subject_match
                ? "S22_SUBJECT_MISMATCH"
                : !checks.exact_identity
                  ? "S22_IDENTITY_SHAPE"
                  : !checks.active_owner_membership
                    ? "S22_OWNER_MEMBERSHIP"
                    : "S22_BOOTSTRAP_AUDIT";
      const mismatch = new Error(
        "The stored first-owner workspace does not match the configured identity",
      );
      mismatch.code = mismatchCode;
      mismatch.exitCode =
        mismatchCode === "S22_IDENTITY_COUNT"
          ? 80
          : mismatchCode === "S22_ISSUER_MISMATCH"
            ? 81
            : mismatchCode === "S22_SUBJECT_MISMATCH"
              ? 82
              : mismatchCode === "S22_ISSUER_SUBJECT_MISMATCH"
                ? 83
                : mismatchCode === "S22_IDENTITY_SHAPE"
                  ? 84
                  : mismatchCode === "S22_OWNER_MEMBERSHIP"
                    ? 85
                    : 86;
      throw mismatch;
    }
  } finally {
    await client.query("rollback");
  }
};

const assertAuthRoleResolution = async (Pool, connectionString, issuer, subject) => {
  const pool = new Pool({
    application_name: "lead-agent-staging-owner-auth-verify",
    connectionString,
    connectionTimeoutMillis: 15_000,
    max: 1,
    query_timeout: 15_000,
  });
  try {
    const connection = await pool.query(
      "select current_user as role_name, current_database() as database_name",
    );
    const roleName = connection.rows[0]?.role_name;
    const databaseName = connection.rows[0]?.database_name;
    if (roleName !== "lead_agent_auth" || databaseName !== "lead_agent_staging") {
      const error = new Error("The authentication database connection shape is invalid");
      error.code = "S22_AUTH_CONNECTION_SHAPE";
      error.exitCode = 87;
      throw error;
    }

    const resolution = await pool.query(
      "select resolution_state, user_id::text as user_id from app.resolve_external_identity($1::character varying, $2::character varying)",
      [issuer, subject],
    );
    if (resolution.rowCount !== 1) {
      const error = new Error("The authentication role cannot resolve the configured identity");
      error.code = "S22_AUTH_IDENTITY_UNMAPPED";
      error.exitCode = 88;
      throw error;
    }
    const row = resolution.rows[0];
    if (row?.resolution_state !== "authenticated" || row.user_id !== USER_ID) {
      const error = new Error("The authentication role returned an invalid identity result");
      error.code = "S22_AUTH_IDENTITY_INVALID";
      error.exitCode = 89;
      throw error;
    }
    console.info(
      JSON.stringify({
        database: "lead_agent_staging",
        operation: "staging_owner_auth_role_identity_verify",
        outcome: "PASS",
        resolution_state: "authenticated",
        role: "lead_agent_auth",
      }),
    );
  } finally {
    await pool.end().catch(() => {});
  }
};

const bootstrap = async () => {
  failureExitCode = 71;
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  failureExitCode = 72;
  const connectionString = withLibpqCompatibleRequireSsl(required("MIGRATION_DATABASE_URL"));
  const authConnectionString = withLibpqCompatibleRequireSsl(required("AUTH_DATABASE_URL"));
  const issuer = required("STAGING_AUTH0_ISSUER");
  const subject = required("STAGING_OWNER_AUTH0_SUBJECT");
  const mode = process.env.S22_OWNER_BOOTSTRAP_MODE ?? "apply";
  assertInput(issuer, subject);
  if (mode !== "apply" && mode !== "verify") {
    throw new Error("The staging owner bootstrap mode is invalid");
  }

  failureExitCode = 73;
  const pool = new Pool({
    application_name: "lead-agent-staging-owner-bootstrap",
    connectionString,
    max: 1,
  });
  const client = await pool.connect();
  try {
    failureExitCode = 74;
    if (mode === "apply") {
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
    }

    failureExitCode = 76;
    await assertStoredWorkspace(client, issuer, subject);

    failureExitCode = 79;
    await assertAuthRoleResolution(Pool, authConnectionString, issuer, subject);

    failureExitCode = 77;
    await assertReplayFailsClosed(client, issuer, subject);

    failureExitCode = 78;
    console.info(
      JSON.stringify({
        audit_event_id: AUDIT_ID,
        organization_id: ORGANIZATION_ID,
        operation:
          mode === "apply" ? "staging_owner_workspace_bootstrap" : "staging_owner_workspace_verify",
        outcome: "PASS",
        replay_protection: "S22_BOOTSTRAP_NOT_EMPTY",
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
  const classifiedExitCode =
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    Number.isInteger(error.exitCode) &&
    error.exitCode >= 80 &&
    error.exitCode <= 89
      ? error.exitCode
      : failureExitCode;
  process.exitCode = classifiedExitCode;
});
