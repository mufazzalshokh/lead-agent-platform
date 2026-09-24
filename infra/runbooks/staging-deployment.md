# S22 staging deployment runbook

This runbook is plan-first. It never asks for a secret value in chat, a Terraform
variable, a repository file, or a GitHub log.

## 1. Owner bootstrap prerequisites

The owner creates one billing-enabled, staging-only GCP project with synthetic data
only and records its project ID. With an authorized owner workstation identity:

1. authenticate with Application Default Credentials;
2. copy `infra/deploy/gcp/bootstrap/terraform.tfvars.example` to an ignored local
   `.tfvars` file and set the project and globally unique state bucket names;
3. run `terraform init`, `terraform fmt -check`, `terraform validate`, and
   `terraform plan -out=s22-bootstrap.tfplan` in `infra/deploy/gcp/bootstrap`;
4. stop for the required owner review before the first apply;
5. after approval, apply that exact plan and migrate the bootstrap state into the new
   versioned GCS bucket.

Bootstrap creates required APIs, state storage, the deployment service account, and
GitHub OIDC trust restricted to repository `mufazzalshokh/lead-agent-platform`, ref
`refs/heads/main` or the temporary `refs/heads/verify/s22-staging-recovery-capacity`
verification branch, the two S22 staging workflows, and GitHub environment `staging`.
This permits pre-promotion staging proof without merging partial S22 work; after S22
acceptance, normal staging deployments use `main`.

## 2. GitHub staging environment

Create the protected GitHub environment `staging`, require the owner as reviewer, and
set non-secret environment variables:

- `GCP_PROJECT_ID`
- `GCP_TERRAFORM_STATE_BUCKET`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOYER_SERVICE_ACCOUNT`
- `GCP_BILLING_ACCOUNT_ID`
- `STAGING_MONITORING_NOTIFICATION_CHANNEL_IDS_JSON` (a JSON array with at least one
  existing staging notification-channel resource ID)
- later: `STAGING_API_ORIGIN`, `STAGING_WEB_ORIGIN`
- later: isolated Auth0 client ID/issuer, Telegram bot username, Instagram app ID and
  approved Graph API version

Do not store provider tokens, database URLs, encryption/signing keys, or client secrets
as GitHub variables.

## 3. Foundation plan and apply

Dispatch `Staging Terraform` on `main` with `action=plan`, `phase=foundation`, and the
exact verified commit. Review the plan, monthly estimate, IAM, network, SQL, backups,
and destructive operations. The plan must create only the approved resources and must
show no destroy/replace operation.

After the explicit owner checkpoint, dispatch `action=apply` with the same phase,
commit, the reviewed plan run ID, and approval token. The workflow downloads and
checksum-verifies that binary plan; it does not generate a replacement plan.

## 4. Load secret versions securely

Populate the provisioned Secret Manager resources through an owner-controlled terminal
or secret-management process. Use stdin/file input that does not echo values. Never use
Terraform `secret_data`, command-line literal values, shell history, workflow output,
or repository files.

The database administrator credential is used only by the migrator. Create distinct,
random passwords in the four application DSNs for roles created by migration:
`lead_agent_runtime`, `lead_agent_auth`, `lead_agent_ingress`, and
`lead_agent_queue_runtime`. All DSNs target the private database address. The migrator
sets those role passwords after migrations under its advisory lock; normal workloads
never receive the administrator DSN. Runtime DSNs must require encrypted transport
(`sslmode=require` or the library-equivalent setting) even though the address is private.

Purpose-separated 32-byte keys are required for browser envelopes, invitation target
encryption/lookup, customer data encryption/lookup, and Widget signing/exchange. Load
isolated staging Auth0, Telegram, Instagram, and Gemini credentials. The
`channel-credentials` secret itself receives no initial placeholder version; the
application creates versions through `CredentialSecretStore`.

## 5. Immutable images and URL bootstrap

After foundation succeeds, dispatch `Build staging images` for an exact commit already
preserved on the S22 verification branch (or `main` after acceptance). Record all four
digest references from the workflow summary.

Plan/review/apply the `bootstrap` phase with the API and Web digests. It creates only
health-only API/Web revisions and produces stable, distinct `run.app` URLs without
requiring application secrets. Add those exact URLs to the GitHub staging variables and
to the isolated Auth0 callback/logout/origin allowlists. Configure the Telegram webhook,
Instagram redirect, and Widget test origin only against these staging URLs.

## 6. Migration before application activation

Plan/review/apply the `migration` phase with the migrator digest. API and Web remain on
health-only revisions. The workflow executes the one-shot job once and requires exit
code zero. Its sanitized structured record must show environment `staging`, exact Git
SHA, migrator digest, migration count `30`, and head
`0029_s21_thread_automation_controls`. Confirm the database has 52 production tables
and the frozen FORCE-RLS manifest before proceeding.

Plan/review/apply the `full` phase only after migration proof. This activates the real
API/Web images and one worker-pool instance. Validate `/health` without exposing a
configuration dump; then execute the synthetic tenant and provider checklist in the S22
architecture brief.

## 7. Rollback

For an application defect, stop new promotion, identify the last known-good digest and
its database compatibility, plan the exact Cloud Run image reversion, obtain approval,
and deploy the previous digest. Do not reverse migration history. If data recovery is
required, follow `recovery-capacity.md` and restore into a separate instance.
