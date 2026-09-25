# S22 staging infrastructure

This directory defines the owner-approved S22 staging target on Google Cloud in
`me-central1` (Doha). It is staging-only; S23 must reconsider production region,
residency, availability, latency, and cost from measured evidence.

## Layout

- `deploy/gcp/bootstrap`: one-time secured GCS state bucket, required APIs, the
  keyless GitHub Workload Identity Federation trust, and the deployment identity.
  It starts with local Terraform state because the remote backend does not yet exist.
- `deploy/gcp/staging`: isolated VPC, private Cloud SQL PostgreSQL 17, Artifact
  Registry, Secret Manager resources, least-privilege runtime identities, bounded
  Cloud Run API/Web/worker/migrator workloads, monitoring, and the staging budget.
- `runbooks/staging-deployment.md`: exact plan-first deployment and secret-loading
  sequence.
- `runbooks/recovery-capacity.md`: isolated restore, outage, queue-recovery, and
  bounded capacity evidence procedure.

No `terraform apply` is authorized by files in this directory. The first apply
requires the explicit `S22 INFRASTRUCTURE APPLY APPROVAL REQUIRED` checkpoint.
Terraform creates Secret Manager resources but never stores secret values. Local
`*.tfvars`, plans, state, environment files, credentials, and logs are ignored.

## Deployment phases

1. `foundation`: network, private database, registry, secret resources, identities,
   alerts, and budget. No application process is started.
2. `bootstrap`: API and Web run health-only revisions from immutable images. Their
   stable `run.app` origins are captured without requiring application secrets.
3. `migration`: the health-only revisions remain; the one-shot migrator is created
   and executed after all secret versions exist.
4. `full`: API/Web use the captured distinct origins, the worker pool runs exactly
   one instance, and the already-proven database serves the application.

Each phase is planned in one GitHub run and uploads a checksum-protected binary
Terraform plan. A later apply run must name that exact plan run and provide the
owner approval token; it cannot silently re-plan.

Container deployment accepts only Artifact Registry `@sha256:` references. Git SHA,
image digest, migration head, timestamp, and environment are recorded in the image,
Cloud Run revision/job, and workflow summary.
