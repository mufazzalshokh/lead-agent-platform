# S22 bounded database-failure and notification exercise

Status: **PREPARED PROPOSAL — NOT LIVE-AUTHORIZED OR EXECUTION-READY**.
This packet selects a real dependency probe and defines one failure/recovery
window. No outage, traffic, notification, IAM change or database job has run as
part of preparation. S22 remains unaccepted. Do not reapply consumed plans
`39650372329` or `38172305694`.

## Established facts and probe selection

The [monitoring correction](s22-monitoring-rollout-plan.md) is deployed and
converged. Read-only run `39657347257` verified its configuration and one enabled
email channel, but observed no request series. That is neither zero-percent
error evidence nor delivery proof. The owner controls the recipient account;
that does not authorize a notification.

Use the existing API route `GET /v1/staff/auth/session` through the existing
same-origin Web `/v1/` gateway, from an owner-controlled staff browser with its
normal HttpOnly cookie. The gateway forwards the API status without retries;
a gateway-generated 502/504 is not proof of the intended database response.
Discard response bodies. Do not extract cookies, bearers, signing keys,
personal identifiers or HAR files. A fresh, valid session resolves through PostgreSQL. An unavailable
session database produces a sanitized **500 `internal_error`**, not a promised
503; the same credential can resolve again after recovery. Anonymous/invalid
credentials produce 401 before the database, so they are not a failure probe.
`/health` is static liveness and is also unsuitable.

**This GET is not SQL-write-free.** The deployed VOLATILE security-definer
resolver updates the operator's `auth_sessions.last_seen_at` and
`idle_expires_at`; invalid/expired sessions can be marked accordingly. A due
session can rotate credentials and set cookies. Live authority must explicitly
include ordinary security metadata for this one operator session. It must not
include business mutations, customer messages, AI calls or session replacement.
If strictly zero database writes are required, this method is NO-GO; do not
reinterpret SELECT as proof of purity or add a public fault endpoint.

The five offline regressions in `tests/security/s22-failure-probe.test.ts` cover
200 → sanitized 500 → 200, static health/anonymous negative controls, rotation,
invalid credentials, and the resolver's metadata writes. The relevant route,
Web gateway, runtime, migration, session policy and database timeout configuration have no
diff from preserved deployed source `abc3071fb81777068f5adfb98f6144d9081077eb`.
These are mocked HTTP/source tests, not a live PostgreSQL interruption test.
The default database connect/statement timeouts are 10 seconds; a shorter HTTP
deadline could conceal the intended response behind a client timeout.

## Exact proposed scope

| Item | Bound |
| --- | --- |
| Project / region | `lead-agent-stg-739284` / `me-central1` only |
| SQL target | `lead-agent-staging-postgres17` only; baseline activation `ALWAYS` |
| Probe service | `lead-agent-staging-api`; exact existing session GET only |
| Proposed reversible fault | One activation transition `ALWAYS → NEVER → ALWAYS` |
| Intended fault observation | 6 minutes after a confirmed stop; never extend for an email |
| Recovery initiation deadline | No later than 8 minutes from accepted stop request, earlier on any abort |
| Probe ceiling | 44 GETs total; one in flight; 15-second request deadline; no retries |
| Cloud/AI spend | Bounded requests/time, no new resources/scale-up; **zero AI attempts** |
| Unchanged | Images, migration, identities, VPC, secrets, RLS, policy threshold/recipients, worker mode, budget and cost ledgers |

This is a **whole-staging database outage**, not an isolated request failure:
staff, Widget, ingress and the worker lose their database dependency. Stopping
the SQL instance is a temporary configuration change that must be restored and
checked for convergence, not an authorized Terraform deployment or permanent
drift. Google documents activation policy as the start/stop control; data is
retained, but storage/IP charges can continue. See the [Cloud SQL procedure](https://docs.cloud.google.com/sql/docs/postgres/start-stop-restart-instance).
No fixed cloud-dollar cap is claimed: billing alerts are not spend enforcement.
No restore, deletion, credential/role/firewall change or public access is allowed.

## Mandatory live readiness gates — not yet established

1. Implement and offline-test a guarded controller/probe before proposing a live
   invocation. It must bind the exact project/instance/service, require explicit
   outage and notification authority, use monotonic deadlines, single-flight
   requests and finite receipts, and recover on abort. It must reject foreign
   targets, redirects, uncertain control-operation results and expired authority.
   There is **no live controller or armed watchdog in this milestone**.
2. Independently verify the current instance identity/configuration, no pending
   SQL operation, existing least-privilege stop/start/operation-read access,
   reviewed app provenance, unchanged alert/recipient and no already-open
   incident for the same policy/series. Denial is NO-GO, not
   permission to expand IAM. Preserve the complete baseline privately and a
   sanitized fingerprint in evidence; never read secret payloads.
3. Establish an exclusive synthetic maintenance window. Verify no in-flight paid
   reservations, due/running eligible provider/delivery work or other exercise.
   Historical inert pending Outbox topics are not automatically runnable work;
   do not reset them or cost ledgers to manufacture a quiet baseline. This
   preparation has not run a database diagnostic or proved live quiescence.
4. Verify an **independent recovery operator/control path** outside the fault
   controller's runner/browser. That operator must hold existing access, know
   the exact target and deadline, and be present to restore `ALWAYS` on loss of
   contact. A same-process `finally` block alone is insufficient. A deadline
   bounds the restore request, not Google's operation completion or measured
   service RTO. If this recovery path cannot be demonstrated, do not stop SQL.
5. Establish a fresh normal operator login and cookie-backed same-origin probe
   without sharing credentials. Pause background polling and normal staff use;
   the probe must not compete with an active workspace. Verify all four baseline
   GETs return 200 and that the session is not due for rotation. No copied privileged credential in
   a workflow. If a safe browser execution path is unavailable, NO-GO.
6. Obtain explicit authority for **this one staging outage, the authentication
   metadata exception and an actual alert to the existing recipient**. Prior
   deployment, read-only or inbox-ownership approvals do not cover these effects.
   This proposal does not itself grant that authority.

## One-shot execution sequence, only after those gates

1. Record UTC start, approved scope, source/images/migration, baseline settings,
   policy fingerprint, independent recovery contact and receipt location. Start
   monotonic clocks; baseline is four session GETs on 15-second slots. Never
   collect response bodies or headers. Record only phase, UTC, duration, status
   and a sanitized request/correlation ID when available.
2. Submit the stop once, preserve its operation ID, and observe that operation.
   Never replay a timed-out patch blindly. If stop is not confirmed within two
   minutes, abort the proof and initiate recovery at the first safe opportunity;
   the independent operator handles a pending/conflicting control operation.
3. After confirmed stop, issue at most 24 session GETs on 15-second slots over
   six minutes. A late/in-flight slot is skipped, not queued or retried. Expect
   sanitized 500s; 401/403, redirects, 429, transport timeouts or unexpected
   responses invalidate the intended probe and trigger early recovery. Do not
   increase load or alter the alert to make it fire. A missed slot can leave the
   sustained metric proof inconclusive even if all received responses are 500.
4. Restore `ALWAYS` once after the observation window, on abort, or by the
   eight-minute deadline, whichever comes first. This is independent of email
   arrival. Track the restore operation instead of blindly reissuing it. On
   lost runner/control access or a pending-operation conflict, the independent
   operator takes over; report an incident, not a successful bounded recovery.
5. Issue at most 16 recovery session GETs on 30-second slots, still with a
   15-second deadline and no overlap/retries. Stop after two consecutive 200s.
   Recovery observation ends within ten minutes of restore initiation. Verify
   `ALWAYS`, successful SQL operation and original configuration/provenance; a
   resumed API alone does not prove configuration convergence. Failure to
   recover is an incident, never authority for destructive repair.
6. Collect only read-only, allowlisted Monitoring/incident observations and
   recipient acknowledgement, bounded to twenty minutes after restoration.
   Use at most two existing monitoring-evidence executions (11 GETs/5 minutes
   each), plus one operator inspection of the matching incident and inbox.
   Do not repeatedly poll/run jobs or send a separate test-channel notification.
   Preserve the measured ratio window and matching incident reference/times.
   Record actual receipt time and owner acknowledgement without address/body.
   If no incident or notification arrives in the window, record **INCONCLUSIVE**
   and investigate metadata; no second outage or request replay is authorized.

The 44-request ceiling includes all baseline/fault/recovery session probes
(4 + 24 + 16); normal interactive use must be paused. Any unexpected customer
traffic, security concern, provider dispatch or target/configuration change
triggers early recovery. SQL control polls also need a controller-enforced
finite request/time budget before live readiness; they are not implemented here.

## Evidence and acceptance boundaries

Require all of the following for this **sub-exercise**, otherwise keep the
individual gate failed/inconclusive:

- Observed database failure/recovery at the exact target; sanitized API errors,
  no credential disclosure, and successful same-session recovery.
- Nonzero observed denominator and a measured ratio strictly above 1% sustained
  for the configured 300 seconds, with matching policy/incident. Client status
  counts alone are not Monitoring evaluation proof.
- Actual alert received by the controlled existing destination, correlated to
  that incident; channel configuration alone is not delivery evidence.
- Restored SQL baseline, no unintended configuration/business effect, and
  documented observed timings. Record queue/worker health after recovery without
  inventing drain/idempotence evidence from this non-business probe.

Cloud Run request metrics are sampled/visible asynchronously, and Monitoring
adds evaluation latency. Restoration does not promise immediate alert closure;
missing 5xx series must not be fabricated as zeros, and configured auto-close is
not a guaranteed recovery-email time. See [metric visibility](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#run)
and [condition, missing-data and notification behavior](https://docs.cloud.google.com/monitoring/alerts/concepts-indepth).

This exercise does **not** close the below-threshold 0.2% negative case,
multi-revision weighting, transactional rollback under business mutations,
worker drain/duplicate-effect proof, isolated restore RPO/RTO, capacity, real
Telegram or Widget booking/recovery gates. Those remain in the
[S22 evidence register](s22-acceptance-evidence.md). No expired customer session
is renewed and no additional message/provider allowance is activated.

Next safe task: implement and offline-verify the bounded controller and its
independent-recovery preflight. Only after readiness is demonstrated should the
exact live outage/notification scope be presented for approval.
