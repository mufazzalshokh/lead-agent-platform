# S22 API error-ratio monitoring-only plan

Status: **APPLIED; ZERO-CHANGE CONVERGENCE VERIFIED**. The owner-approved plan
was consumed once. No paid test, replacement session or S22 acceptance is authorized.

## Exact saved plan

| Binding | Reviewed value |
| --- | --- |
| Plan run | [39650372329](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/39650372329), successful |
| Workflow/action/phase | `staging-terraform.yml` / `plan` / `monitoring-policy` |
| Tooling source | `2601be9090411cfc24feadc4bd0e051080c4af8d` |
| Preserved branch | `verify/s22-staging-recovery-capacity` |
| Saved binary | `s22.tfplan` |
| SHA256 | `bcaf3b6d1b03e138e620858a2e542992d04a359473318aceae1655d59cd41271` |
| Artifact | `s22-terraform-plan-monitoring-policy-2601be9090411cfc24feadc4bd0e051080c4af8d` |
| Artifact expiry | `2026-10-28T18:11:42Z` (28 October, 23:11:42 Asia/Tashkent) |
| Terraform / Google provider | `1.14.7` / locked `7.46.1` |
| Managed configuration inventory | 88, complete before/after inventories |
| Changes | 1 in-place update; 0 creates, destroys or replacements |
| Sole changed address | `google_monitoring_alert_policy.api_errors` |

The successful run's provenance was independently checked against the exact
source, repository, branch and workflow. The downloaded saved binary matches
its artifact checksum. Its full JSON was independently reviewed against the
installed locked provider schema, including optional+computed configuration,
configurable unknowns and drift. The remote finite receipt and independent
review both passed. Raw plans/state stay in ignored local cache or the restricted
seven-day Actions artifact, not Git.

## Root cause and bounded correction

The old alert compared a 5xx **request rate**, without a denominator, with
`0.01`. That is not a 1% error ratio. This saved plan changes the policy to divide
summed 5xx rates by summed total request rates for the exact staging project,
region and API service. Both sides use 60-second `ALIGN_RATE`, `REDUCE_SUM` and
identical service/location grouping. Revision and response-code series are
reduced before division. It preserves strict `> 0.01`, the 300-second retest
window, enabled state, notification recipients and all other policy settings.
The CPU policy and billing budget are unchanged. This does not establish live
metric behavior or actual notification delivery; those remain acceptance proof.

## Preserved application and safety boundary

Application source remains `abc3071fb81777068f5adfb98f6144d9081077eb`, timestamp
`2026-10-11T20:27:12Z`, migration/package/API head
`0032_s22_widget_recovery` (33 migrations). The immutable image prefix is
`me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent`:

| Image | Preserved SHA256 digest |
| --- | --- |
| API | `f89024dc7406a307c597a7d90ca57c616e2730cb73699733c2f7378216c4941f` |
| Web | `4a57a0d4d80caa0eab3c0efb824aa1f97e33bb7f9d163b31fac129561e8f6dfe` |
| Worker | `b6d550af4f2c071f00b7ae8388dddd7d8ef7efc3be8923aebd5c168140f75c5a` |
| Migrator | `223f1cb22f12a082c147c001d12690c491ca01cf63aa265afeaaa62bd7b69ce5` |

The functional shared-core profile, runtime identities, networks, secret
references and complete environments are unchanged. `ai_journey_mode=preserve`
resolves from authoritative state to existing `widget_booking` with envelope
anchor `01a11c48-dbc2-76de-a873-f41664da5ccb`. This anchor is not a fresh browser
session or paid-test authorization. No selection, recovery family, cost record,
budget ceiling or reservation is reset. The old customer recovery code remains
expired; it cannot resume that chat now.

The plan's executed-step inventory contains only request/provenance validation,
OIDC authentication, Terraform initialization/state-preservation/validation,
planning, monitoring guard and artifact handling. All apply, database migration,
diagnostic and customer/provider execution steps were skipped. The separate
inventory, booking-evidence and Widget-progress jobs were also skipped. No IAM
expansion, secret payload read, restore, failure drill or capacity traffic ran.

## Verification and handoff

Full [CI 39648796883, attempt 2](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/39648796883)
passed on exact source `2601be9`: **4,228 tests**, including **546 real
PostgreSQL tests**, with seven opt-in live tests skipped. Formatting, lint,
types, contracts, boundaries and builds passed. Attempt 1 passed all 490
assertions in its first PostgreSQL suite but failed suite shutdown with
`terminating connection due to administrator command`. One unchanged-source CI
retry passed; no test was weakened and the shutdown failure is not claimed fixed.

Local checks passed:

```text
node --test .github/scripts/s22-monitoring-plan-check.test.mjs .github/scripts/s22-full-runtime-config-check.test.mjs .github/scripts/s22-recovery-rollout.test.mjs
# 52/52; 36 new monitoring tests and 16 existing rollout tests
node node_modules/vitest/vitest.mjs run tests/workspace/staging-infrastructure.test.ts tests/workspace/staging-acceptance-inventory.test.ts tests/workspace/staging-monitoring-boundary.test.ts --maxWorkers=1 --reporter=dot
# 19/19
node node_modules/eslint/bin/eslint.js .github/scripts/s22-monitoring-plan-check.mjs .github/scripts/s22-monitoring-plan-check.test.mjs .github/scripts/s22-full-runtime-config-check.mjs tests/workspace/staging-monitoring-boundary.test.ts --max-warnings=0
# exit 0
node node_modules/prettier/bin/prettier.cjs --check .github/scripts/s22-monitoring-plan-check.mjs .github/scripts/s22-monitoring-plan-check.test.mjs .github/scripts/s22-full-runtime-config-check.mjs .github/workflows/staging-terraform.yml tests/workspace/staging-monitoring-boundary.test.ts infra/runbooks/recovery-capacity.md docs/architecture/s22-acceptance-evidence.md
# PASS
bash -n .github/scripts/s22-monitoring-plan-check.sh
terraform -chdir=infra/deploy/gcp/staging validate -no-color
# PASS, existing local provider; no backend initialization
node .cache/s22-monitoring-rollout/review.mjs 39650372329
# independent exact-artifact/provenance/schema review PASS, 88 configurations / 1 update
```

The first receipt-staging attempt failed with local `ENOSPC`: `unable to write
loose object file: No space left on device`. The follow-up observed 120,455,168
bytes free and resumed the focused receipt handoff without a local build or
further deletion. Remote apply logs and the retained artifact independently
verify deployment. Disk headroom remains limited. Source, dependencies, retained
plans and owner edits are preserved; no migration, tenant authorization or
application logic changed.

Implemented files: `.github/scripts/s22-monitoring-plan-check.mjs`, its `.sh`
wrapper and `.test.mjs`; shared comparator export in
`.github/scripts/s22-full-runtime-config-check.mjs` (existing guard semantics
unchanged); `.github/workflows/staging-terraform.yml`;
`tests/workspace/staging-monitoring-boundary.test.ts`;
`infra/runbooks/recovery-capacity.md`; `docs/architecture/s22-acceptance-evidence.md`;
and this review packet. The earlier metric correction is committed in `d8c6785`.
Owner changes in `README.md`, `docs/architecture/s11-instagram-business.md` and
`s22-public-notices.patch` are unchanged and excluded.

## Consumed apply receipt and next gate

Owner-approved [apply 39653834662](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/39653834662)
finished `2026-10-21T18:34:55Z`: **0 added, 1 changed, 0 destroyed**. Eight approval,
integrity, apply and convergence steps passed. Full provider-schema convergence
verified **88 managed configurations / zero changes**. Application provenance
recording and unrelated evidence/database jobs were skipped. The apply evidence
artifact expires `2026-10-28T18:34:51Z`. Do not reapply plan **39650372329**.

The read-only [baseline 39657347257](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/39657347257)
passed at source `e50772e`: reviewed ratio confirmed, one enabled email channel,
four Monitoring GETs, no request series observed and no delivery claim. Its full
receipt and CI totals are in the [evidence register](s22-acceptance-evidence.md).
The [bounded failure/notification proposal](s22-failure-notification-plan.md)
now records the probe, security-metadata exception, outage limits and independent
recovery prerequisites. No live controller is armed or outage/notification
authorized. Next: implement and offline-verify its guarded controller/preflight;
do not inject traffic yet. See the [runbook](../../infra/runbooks/recovery-capacity.md#read-only-monitoring-baseline).
The remaining S22 acceptance matrix is unchanged.
**S22 remains unaccepted; S23 is not started.** Never reapply consumed plan `38172305694`.
