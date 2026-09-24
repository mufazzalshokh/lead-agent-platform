# S22 staging, recovery, and capacity freeze

Status: owner-approved implementation freeze; cloud execution evidence pending.

S22 uses one isolated, billing-enabled Google Cloud staging project in
`me-central1` (Doha). This is a staging decision only. S23 must revisit the final
production placement using Uzbekistan latency, legal/data-transfer requirements,
customer requirements, availability design, provider residency, and measured cost.

## Staging topology

```text
public HTTPS
  -> Cloud Run Web service (scale 0..2)
  -> Cloud Run API service (scale 0..3, webhooks + Widget + staff API)

Cloud Run API/worker/migrator
  -> Direct VPC egress
  -> private-IP Cloud SQL PostgreSQL 17

Cloud Run worker pool
  -> exactly one continuously running instance

Cloud Run migrator job
  -> one task, zero retries, advisory-locked migrations, then exit
```

The VPC is isolated and Cloud SQL has no public IPv4 address. The initial database
is Enterprise, zonal, `db-custom-1-3840`, 20 GiB SSD with bounded autoresize,
automated backups, PITR, and seven-day log/backup retention. Staging deliberately
does not imitate production HA.

## Trust and secrets

GitHub Actions authenticates through OIDC and a repository/ref/environment-restricted
Workload Identity Federation provider. No downloadable service-account key is used.
API, Web, worker, migrator, and deployer use distinct identities. Static secret
values are loaded outside Terraform; Terraform state contains only secret resource
names.

The provider-neutral `CredentialSecretStore` is implemented by Google Secret Manager.
One pre-provisioned secret is a narrow versioned credential namespace: API and worker
may add/read/destroy versions, and PostgreSQL stores only an opaque version reference.
References outside that exact secret fail closed.

## Release and rollback

OCI images use a pinned Node base digest and run as a non-root user. GitHub builds API,
Web, worker, and migrator targets, emits SBOM/provenance attestations, and deploys only
Artifact Registry digest references. The exact Git commit, digest, migration head,
UTC timestamp, and `staging` environment are recorded for every deployment.

Cloud Run application rollback means routing/redeploying an already-known previous
digest after checking its compatibility with the current additive database head. It
does not mean reversing a historical migration. A database incident uses isolated
PITR/restore and forward repair, never an unreviewed migration rollback.

## Recovery and capacity gates

The owner-approved launch targets to measure are RPO `<= 5 minutes` and RTO
`<= 60 minutes`; they are not customer SLAs. Restore proof must create a separate
recovery instance/database, validate schema, 52-table manifest, FORCE RLS, encryption,
representative tenant aggregates, audit, Outbox, and thread automation controls, then
record recovery-point age and application-validation completion.

Capacity evidence uses synthetic data only. Normal load is 10 active tenants,
approximately 1 inbound message/second and 10 staff sessions for 15 minutes. Burst is
25 tenants, approximately 5 messages/second and 25 staff sessions for 5 minutes.
Stress grows in bounded steps and stops at meaningful-response p99 over 60 seconds,
sustained error rate over 1%, unsafe queue/DB pressure, sustained CPU/memory saturation,
or a provider limit. Infrastructure load uses deterministic fake AI; a small separate
cohort uses the approved paid `gemini-3.8-flash` profile under the USD 5 target / USD
10 hard ceiling.

## Pre-apply cost envelope

Pricing was checked on 2026-09-24 against the official
[Cloud SQL](https://cloud.google.com/sql/pricing),
[Cloud Run](https://cloud.google.com/run/pricing),
[Artifact Registry](https://cloud.google.com/artifact-registry/pricing), and
[Secret Manager](https://cloud.google.com/secret-manager/pricing) pages. Using 730
hours/month, the fixed baseline is approximately:

- Cloud SQL compute (`1 vCPU + 3.75 GiB`): USD 49.31;
- Cloud SQL 20 GiB SSD plus up to 20 GiB used backup storage: USD 5.00;
- one continuously running `1 vCPU + 1 GiB` Cloud Run worker pool: USD 32.80 before
  any applicable free-tier credit;
- initial secret versions and modest Artifact Registry/state storage: about USD 2.

API/Web scale to zero, the migrator is one-shot, and logging, requests, operations,
backup growth, and egress are usage-dependent. The planned normal monthly envelope is
therefore approximately USD 90-100 before taxes and paid Gemini calls. This is an
estimate, not a billing guarantee. Terraform creates both the USD 100 target budget
and the USD 150 hard-ceiling budget; actual billing must be watched during S22 and
nonessential staging resources stopped before the ceiling is approached.

## Explicit non-goals and pending evidence

S22 adds no Kubernetes, Redis, Kafka, vector database, microservice split, production
billing, external calendar, or migration after `0029`. Initial `run.app` origins are
acceptable and must remain distinct for Web/Widget versus API. Real Auth0, Telegram
Business, Instagram Professional, Gemini, end-to-end journey, TTFR, restore, failure,
and capacity results cannot be claimed until the approved cloud resources and synthetic
accounts exist and the runbooks are executed.
