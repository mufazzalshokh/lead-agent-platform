const ORGANIZATION_ID = "01a0ee39-91a9-7293-82c0-5b7046c10115";
const USER_ID = "01a0ee39-91af-7bfa-945f-b87959be6f0b";
const EXTERNAL_IDENTITY_ID = "01a0ee39-91af-7d4c-baf2-9a28dc854028";
const MEMBERSHIP_ID = "01a0ee39-91b0-72c2-a2bb-f45d5bcc3ee4";
const AUDIT_ID = "01a0ee39-91b0-7cb5-9bb6-bc34d73137f2";
const OPERATOR_PRINCIPAL_ID = "01a0ee39-91b0-75da-a654-2042586c8f56";
const ADVISORY_LOCK_ID = "721773420220030";
const APPROVAL_REFERENCE = "S22_OWNER_WORKSPACE_BOOTSTRAP_2026-09-29";

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

const scalarCount = (result) => Number(result.rows[0]?.count ?? Number.NaN);

const assertExactState = async (client, issuer, subject) => {
  const organization = await client.query(
    `select count(*)::integer as count
       from organizations
      where id=$1::uuid and slug='lead-agent-staging' and display_name='Lead Agent Staging'
        and status='active' and default_locale='uz' and default_time_zone='Asia/Tashkent'`,
    [ORGANIZATION_ID],
  );
  const user = await client.query(
    "select count(*)::integer as count from users where id=$1::uuid and status='active'",
    [USER_ID],
  );
  const identity = await client.query(
    `select count(*)::integer as count
       from external_identities
      where id=$1::uuid and user_id=$2::uuid and issuer=$3 and subject=$4 and status='active'`,
    [EXTERNAL_IDENTITY_ID, USER_ID, issuer, subject],
  );
  const membership = await client.query(
    `select count(*)::integer as count
       from memberships
      where id=$1::uuid and organization_id=$2::uuid and user_id=$3::uuid
        and role='owner' and status='active' and location_scope='all'`,
    [MEMBERSHIP_ID, ORGANIZATION_ID, USER_ID],
  );
  if (
    scalarCount(organization) !== 1 ||
    scalarCount(user) !== 1 ||
    scalarCount(identity) !== 1 ||
    scalarCount(membership) !== 1
  ) {
    throw new Error("The staging owner workspace did not reach the exact approved state");
  }
};

const bootstrap = async () => {
  const { createHash } = await import("node:crypto");
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  const connectionString = withLibpqCompatibleRequireSsl(required("MIGRATION_DATABASE_URL"));
  const issuer = required("STAGING_AUTH0_ISSUER");
  const subject = required("STAGING_OWNER_AUTH0_SUBJECT");
  assertInput(issuer, subject);

  const pool = new Pool({
    application_name: "lead-agent-staging-owner-bootstrap",
    connectionString,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("begin isolation level serializable");
    try {
      await client.query("select pg_advisory_xact_lock($1::bigint)", [ADVISORY_LOCK_ID]);
      const inventory = await client.query(
        `select
           (select count(*)::integer from organizations) as organization_count,
           (select count(*)::integer from users) as user_count,
           (select count(*)::integer from external_identities) as identity_count,
           (select count(*)::integer from memberships) as membership_count`,
      );
      const counts = inventory.rows[0];
      const empty =
        counts?.organization_count === 0 &&
        counts?.user_count === 0 &&
        counts?.identity_count === 0 &&
        counts?.membership_count === 0;

      if (empty) {
        const now = new Date();
        await client.query(
          `insert into organizations
            (id,slug,display_name,status,default_locale,default_time_zone,created_at,updated_at,version)
           values ($1::uuid,'lead-agent-staging','Lead Agent Staging','active','uz','Asia/Tashkent',$2,$2,1)`,
          [ORGANIZATION_ID, now],
        );
        await client.query(
          `insert into users
            (id,status,last_authenticated_at,created_at,updated_at,version)
           values ($1::uuid,'active',$2,$2,$2,1)`,
          [USER_ID, now],
        );
        await client.query(
          `insert into external_identities
            (id,user_id,issuer,subject,status,linked_at,last_authenticated_at,created_at,updated_at,version)
           values ($1::uuid,$2::uuid,$3,$4,'active',$5,$5,$5,$5,1)`,
          [EXTERNAL_IDENTITY_ID, USER_ID, issuer, subject, now],
        );
        await client.query(
          `insert into memberships
            (id,organization_id,user_id,role,status,location_scope,activated_at,created_at,updated_at,version)
           values ($1::uuid,$2::uuid,$3::uuid,'owner','active','all',$4,$4,$4,1)`,
          [MEMBERSHIP_ID, ORGANIZATION_ID, USER_ID, now],
        );
        await client.query(
          `insert into platform_audit_events
            (id,operator_principal_id,action,target_organization_id,target_type,target_id,
             approval_reference,reason_code,result,request_id,source_ip_hash,occurred_at,metadata_jsonb)
           values ($1::uuid,$2::uuid,'staging_owner_bootstrap',$3::uuid,'membership',$4::uuid,
             $5,'staging_owner_workspace','succeeded','request:s22-staging-owner-bootstrap',
             $6::bytea,$7,$8::jsonb)`,
          [
            AUDIT_ID,
            OPERATOR_PRINCIPAL_ID,
            ORGANIZATION_ID,
            MEMBERSHIP_ID,
            APPROVAL_REFERENCE,
            createHash("sha256").update("github-actions-wif").digest(),
            now,
            JSON.stringify({
              bootstrap_profile: "s22_staging_owner_workspace.v1",
              identity_binding: "exact_issuer_subject",
              role: "owner",
            }),
          ],
        );
      } else {
        const exactInventory = await client.query(
          `select
             (select count(*)::integer from organizations where id=$1::uuid) as organization_count,
             (select count(*)::integer from users where id=$2::uuid) as user_count,
             (select count(*)::integer from external_identities
               where id=$3::uuid and user_id=$2::uuid and issuer=$4 and subject=$5) as identity_count,
             (select count(*)::integer from memberships
               where id=$6::uuid and organization_id=$1::uuid and user_id=$2::uuid) as membership_count`,
          [ORGANIZATION_ID, USER_ID, EXTERNAL_IDENTITY_ID, issuer, subject, MEMBERSHIP_ID],
        );
        const exact = exactInventory.rows[0];
        if (
          counts?.organization_count !== 1 ||
          counts?.user_count !== 1 ||
          counts?.identity_count !== 1 ||
          counts?.membership_count !== 1 ||
          exact?.organization_count !== 1 ||
          exact?.user_count !== 1 ||
          exact?.identity_count !== 1 ||
          exact?.membership_count !== 1
        ) {
          throw new Error("Conflicting staging tenant or identity data exists");
        }
      }

      await assertExactState(client, issuer, subject);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    await assertExactState(client, issuer, subject);
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

await bootstrap();
