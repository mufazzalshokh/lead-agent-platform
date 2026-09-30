const ORGANIZATION_ID = "01a0ee39-91a9-7293-82c0-5b7046c10115";
const USER_ID = "01a0ee39-91af-7bfa-945f-b87959be6f0b";
const EXTERNAL_IDENTITY_ID = "01a0ee39-91af-7d4c-baf2-9a28dc854028";
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

const assertExistingWorkspace = (result) => {
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    row?.organization_count !== 1 ||
    row.user_count !== 1 ||
    row.external_identity_count !== 1 ||
    row.membership_count !== 1 ||
    row.exact_organization_count !== 1 ||
    row.exact_identity_count !== 1 ||
    row.exact_membership_count !== 1 ||
    row.exact_audit_count !== 1
  ) {
    throw new Error("The existing staging owner workspace failed its exact-state check");
  }
};

const verifyExistingWorkspace = async (client, issuer, subject) => {
  const result = await client.query(
    `select
      (select count(*)::integer from public.organizations) as organization_count,
      (select count(*)::integer from public.users) as user_count,
      (select count(*)::integer from public.external_identities) as external_identity_count,
      (select count(*)::integer from public.memberships) as membership_count,
      (select count(*)::integer
       from public.organizations
       where id = $1::uuid
         and slug = 'lead-agent-staging'
         and display_name = 'Lead Agent Staging'
         and status = 'active') as exact_organization_count,
      (select count(*)::integer
       from public.external_identities
       where id = $3::uuid
         and user_id = $2::uuid
         and issuer = $6::character varying
         and subject = $7::character varying
         and status = 'active') as exact_identity_count,
      (select count(*)::integer
       from public.memberships
       where id = $4::uuid
         and organization_id = $1::uuid
         and user_id = $2::uuid
         and role = 'owner'
         and status = 'active'
         and location_scope = 'all') as exact_membership_count,
      (select count(*)::integer
       from public.platform_audit_events
       where id = $5::uuid
         and target_organization_id = $1::uuid
         and target_id = $4::uuid
         and action = 'staging_owner_bootstrap'
         and result = 'succeeded'
         and metadata_jsonb ->> 'bootstrap_profile' = 's22_staging_owner_workspace.v1'
         and metadata_jsonb ->> 'identity_binding' = 'exact_issuer_subject'
         and metadata_jsonb ->> 'role' = 'owner') as exact_audit_count`,
    [ORGANIZATION_ID, USER_ID, EXTERNAL_IDENTITY_ID, MEMBERSHIP_ID, AUDIT_ID, issuer, subject],
  );
  assertExistingWorkspace(result);
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

const bootstrap = async () => {
  failureExitCode = 71;
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  failureExitCode = 72;
  const connectionString = withLibpqCompatibleRequireSsl(required("MIGRATION_DATABASE_URL"));
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
    } else {
      await client.query("begin isolation level serializable read only");
      try {
        failureExitCode = 75;
        await verifyExistingWorkspace(client, issuer, subject);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    failureExitCode = 76;
    await assertReplayFailsClosed(client, issuer, subject);

    failureExitCode = 77;
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
  process.exitCode = failureExitCode;
});
