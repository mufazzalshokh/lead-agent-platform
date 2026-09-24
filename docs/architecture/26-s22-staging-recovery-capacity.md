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
  -> zero instances while dormant; exactly one during approved test windows

Cloud Run migrator job
  -> one task, zero retries, advisory-locked migrations, then exit
```

The VPC is isolated and Cloud SQL has no public IPv4 address. The dormant/functional
database profile is Enterprise, zonal, shared-core `db-f1-micro`, 10 GiB SSD with
autoresize bounded at 20 GiB, automated backups, PITR, and seven-day log/backup
retention. The instance is stopped while staging is inactive. Capacity exercises
temporarily use `db-custom-1-3840`, then return to the stopped shared-core profile.
Staging deliberately does not imitate production HA; shared-core is explicitly a
test/development profile and provides no Cloud SQL SLA.

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
hours/month, the cost model is approximately:

- stopped Cloud SQL: no instance charge; 10 GiB SSD plus backup/PITR storage is
  expected to remain about USD 3.40-5.10 depending on retained/log volume;
- running `db-f1-micro`: USD 0.0105/hour, or USD 7.67 for a continuously running
  730-hour month, plus storage/backup/PITR;
- temporary `db-custom-1-3840`: about USD 0.06755/hour for compute and memory;
- one active `1 vCPU + 512 MiB` Cloud Run worker: conservatively about USD
  0.0427/hour using the published worker-pool resource rates, before free-tier credit;
- initial secret versions and modest Artifact Registry/state storage: about USD 2.

API/Web scale to zero, default to one maximum instance each, and the migrator is
one-shot. The estimated list-price envelopes are USD 5-8/month mostly dormant, USD
12-20/month for up to 80 normal test hours, about USD 7-12 for a representative
40-hour S22 test week, and under USD 2 incremental for an eight-hour temporary load
profile. A bounded heavy month of 160 normal hours plus 16 load hours is estimated at
USD 20-25. An accidentally continuous normal worker/database month approaches USD
45 before meaningful API/Web traffic, so the OFF procedure and USD 25/USD 50 budget
alerts are mandatory. Promotional credits are not included. These are estimates, not
billing guarantees; logging, requests, backup growth, and egress remain usage-dependent.

## Explicit non-goals and pending evidence

S22 adds no Kubernetes, Redis, Kafka, vector database, microservice split, production
billing, external calendar, or migration after `0029`. Initial `run.app` origins are
acceptable and must remain distinct for Web/Widget versus API. Real Auth0, Telegram
Business, Instagram Professional, Gemini, end-to-end journey, TTFR, restore, failure,
and capacity results cannot be claimed until the approved cloud resources and synthetic
accounts exist and the runbooks are executed.
