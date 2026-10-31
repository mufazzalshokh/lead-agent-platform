# S22 self-expiring connection-fault design

Status: **OFFLINE IMPLEMENTATION — NOT DEPLOYED OR LIVE-AUTHORIZED**.
On 30 October 2026 the owner approved preparation of this replacement design
only. On 31 October the owner instructed continuation into offline implementation
and tests. Image builds, deployment, an outage, notification, IAM changes and
spending remain unauthorized. S22 remains unaccepted.

This is a proposed replacement **test mechanism**, not a saved rollout plan or
permission to run the rejected [SQL-stop/watchdog proposal](s22-recovery-safety-review.md).
It tests one application connection path, not Cloud SQL instance failure.

## Decision and affected boundary

Use an API-process-owned TCP relay bound exclusively to `127.0.0.1` on an
OS-assigned port. It forwards bytes without inspecting or logging them to the
one upstream already selected by the trusted authentication database configuration.
For an admitted probe during the fault window, it closes the incoming socket
before forwarding any bytes or opening an upstream socket. The normal `pg`
connection error follows the existing sanitized HTTP error path; the handler
must not simply manufacture a 500 or throw a mock database error.

The only HTTP entry remains `GET /v1/staff/auth/session` through the existing
same-origin Web gateway. A request-local resolver selection in the existing
authentication helper supplies a fresh, max-one-connection session runtime for
the admitted probe. Its role check and `app.resolve_application_session` call
reuse the normal implementation. Never replace the shared session store or
redirect every staff route through the relay.

Normal staff/business routes, customer channels, worker, migrator, real database
pools and connection secrets remain unchanged. Cloud SQL stays `ALWAYS`; there
are zero SQL Admin mutations and no start/stop recovery request. No new cloud
resource, public route/port, service identity, IAM grant, WIF trust, secret or
migration is proposed. The private listener is not bound to `0.0.0.0` or exposed
as a Cloud Run container port.

```text
Normal request ------------------------------> unchanged normal session runtime
Admitted baseline probe -> fresh probe runtime -> local relay -> real PostgreSQL
Admitted fault probe ---> fresh probe runtime -> local relay closes connection
Expiry/abort/restart ----> normal session runtime; no external restore action
```

## Source anchors and transport construction

The current API factory is synchronous; preserve that contract. Initialize the
optional relay in an asynchronous Fastify readiness hook, with owned cleanup in
the close hook. Failure to prepare the fixture disables it, emits a sanitized
NOT_ADMITTED result and leaves ordinary application behavior unchanged.

Source anchors are `apps/api/src/runtime.ts`, `apps/api/src/auth/plugin.ts`,
`packages/database/src/runtime/session.ts`,
`packages/config/src/identity-database.ts` and
`tests/security/s22-failure-probe.test.ts`. Installed versions are Node 24.14.0,
`pg` 8.23.0 and `pg-connection-string` 2.14.0. No dependency changes occur here.

Use supported Node [TCP APIs](https://nodejs.org/download/release/v24.14.0/docs/api/net.html)
and public `pg` configuration/lifecycle APIs. Do not patch `pg` internals or
manually destroy a client's private connection stream. Build the probe's typed
client configuration from the existing normalized trusted DSN using the installed
parser's documented `parseIntoClientConfig` API, then change only transport host
and port to the owned listener. Remove `connectionString` from that client object
so parsing cannot silently override the relay address.

Before any implementation adds the parser as a direct database-package dependency,
justify promoting this already-installed transitive library: its typed public
parser avoids private-driver access and a second, incomplete SSL/URI parser.
The offline implementation promotes exactly 2.14.0 to a direct dependency and
updates only its existing lockfile importer; it adds no new library/version.

Preserve credentials, database, SSL negotiation, CA/client certificates,
verification behavior, options and timeouts. Keep the original TLS server-name
semantics when the TCP destination becomes loopback. The relay must not terminate
TLS, request passwords or return PostgreSQL protocol messages. Reject ambient
`PG*` configuration conflicts for the fixture rather than inheriting another
destination. No DSN, password, certificate or packet buffer enters a receipt.
The [driver documentation](https://node-postgres.com/apis/client) and installed
source show why explicit configuration and SSL preservation need regression tests.

Each probe runtime is created and closed per request, including failed connects.
Thus baseline pool clients cannot bypass the later connection cut. Use the same
role validation and SQL implementation, not duplicated lifecycle SQL. Keep real
pool limits/timeouts unchanged. There is no open transaction to interrupt in this
probe; transaction rollback needs separate evidence.

## Private profile, admission and authentication

Proposed private configuration contains a version, fresh exercise ID, exact
project/region/API service, reviewed application source, expected operator-session
digest, baseline start `B`, fault start `S` and expiry `E`. Require `S = B + 90 s`
and `E = S + 360 s`. Times are canonical absolute UTC, never “six minutes after
startup.” No URI, port, SQL body, tenant ID, delay extension or retry policy can
be supplied by a browser. Profile size is at most 2 KiB; unknown fields fail admission.

Default is absent/off. Reject admission outside the exact staging target, under
the wrong source, with invalid bounds or in production. Rejection disables the
fixture with an observable code; it must not take the ordinary API down. Both
runtime checks and a future narrow deployment guard enforce the boundary.

One setup session GET, before enabling the profile, obtains `session_id` locally
in the owner's existing browser. Compute its SHA-256 digest locally, discard the
response and raw identifier, and use only that digest in the reviewed private
profile. Never extract/export the HttpOnly cookie, bearer or complete response.
This setup request counts in the 44-request ceiling below. Future live authority
must include its ordinary session-metadata writes.

An optional bounded probe-context header carries exercise ID, sequence and an
opaque per-process nonce. It is correlation/anti-replay data, not a credential,
tenant context or permission to enable a fault. No additional HTTP route is
introduced. Preserve origin, Fetch Metadata, cookie/envelope validation and rate
limits; add header redaction and hostile-header tests. Untagged requests always
use normal authentication, even for the same operator during the test window.

A real same-origin browser GET normally omits `Origin`. Admission requires
`Sec-Fetch-Site: same-origin` and either an explicit configured staff origin or,
when Origin is absent, `Sec-Fetch-Mode: cors|same-origin` plus
`Sec-Fetch-Dest: empty`. Never derive an origin from Host/Referer. Ordinary auth
policy remains unchanged, and the cookie envelope is still validated before the
request-local resolver runs. No Web gateway change is required.

The runtime additionally requires declared `GOOGLE_CLOUD_PROJECT` and
`GOOGLE_CLOUD_REGION` matching the exact staging target, `K_SERVICE` and
`DEPLOYMENT_GIT_SHA`. Current infrastructure does not set the two new metadata
variables or the profile, so this implementation is default-off. These are
trusted deployment declarations, not Google identity attestation: the future
exact-plan guard must verify the real project/region/resource and pinned image.
`APP_ENV=production` stays unchanged for staging's normal strong auth settings;
`DEPLOYMENT_ENVIRONMENT` must be staging.

Baseline sequence 1 is resolved normally, verifies the configured session digest
and returns only the process nonce as allowlisted test metadata. Sequences 2–4
must carry that nonce and complete real PostgreSQL resolution in their scheduled
15-second slots. Any source/session/nonce change, rotation, skipped baseline,
authentication failure or unexpected traffic ends admission without retry.
The controller must observe all four responses from the same process.

Only after four successful baseline reads may that process retain an in-memory
keyed fingerprint of the admitted credential for the fault path. Do not retain
the raw bearer or expose the fingerprint. During baseline, a separate candidate
fingerprint detects credential changes; it cannot select a fault and is cleared
on retirement or transferred only after all four successful reads. During fault reads, still validate the
sealed browser envelope and exact request scope before selecting the failed
connection. The cached binding may only deny that probe: it can never return an
authenticated session, authorize a protected action, or substitute for live
authentication on another route. During an actual connection failure, a newly
revoked credential can yield a database-unavailable 500; other routes must still
enforce revocation normally. No stale identity is turned into an authorized result.

## Expiry, abort, restart and scheduling

Each process generates a new nonce and starts unadmitted. No profile alone arms
a process. A process starting at/after `S`, a new replica or a restart cannot
resume the old admission. A nonce change aborts this exercise; do not acquire a
new nonce, repeat baseline or automatically select another instance. Cloud Run
autoscaling is not assumed to provide sticky routing or a single durable process.

Derive phases from server time, not header claims. Use UTC plus injected
[monotonic elapsed time](https://nodejs.org/download/release/v24.14.0/docs/api/perf_hooks.html)
to prevent a running process's lease from extending on wall-clock rollback.
Retire on non-monotonic samples or wall/elapsed divergence over 2 seconds. Reserve
a 2-second early-expiry margin and require at least 15 seconds of window remaining
before admitting a new fault attempt. The operational assumption is trustworthy
platform UTC within that margin; arbitrary undetectable clock errors across a
fresh process are not claimed solved. Fresh processes cannot inherit admission.

Recheck expiry/retirement immediately before the client connects and when the
relay accepts a socket. After expiry/abort it must not reject a newly arriving
connection because an earlier callback captured ACTIVE. Timers only assist
cleanup; a background timeout is not the expiry authority. Request-time checks
must work with the current request-based CPU allocation and after event-loop delay.
An already-cut request may finish late; count that duration/timeout honestly,
invalidate the timing proof and do not retry it. No permanent dependency state
was changed, so a late request cannot later stop the real database.

Before admission, abort means stop the single probe stream; fewer than four
baseline reads cannot arm it. After admission, a same-origin authenticated abort
context on the existing session GET retires the matching nonce before the fault
selection and uses normal resolution. It consumes an unused phase request slot,
not a 45th request. Stop further fault requests locally even if the abort response
is lost. A lost browser cannot itself prolong the absolute window, and no other
normal request carries the admitted nonce/context.

Retirement is latched for that process. Replayed/out-of-order contexts, duplicate
sequences, concurrent probe reads or a deadline miss retire admission rather than
generating intended-fault 500s. New processes cannot replay another process's
nonce. Never auto-reschedule the absolute window or rearm the exercise ID.

On abort/expiry choose the untouched normal session runtime for further requests.
Drain/close owned probe clients and relay sockets without ending a shared pool.
The application must not depend on a successful relay-close callback, database
operation, browser heartbeat or configuration cleanup to stop selecting the fault.

## Finite traffic and observations

The 44-GET cap is retained but its allocation changes explicitly:

| Request class                 | Maximum | Bound                                                               |
| ----------------------------- | ------- | ------------------------------------------------------------------- |
| Private session-binding setup | 1       | Normal existing session GET; local digest only                      |
| Baseline                      | 4       | `B`, `B+15`, `B+30`, `B+45` seconds                                 |
| Fault                         | 23      | `S` through `S+330`, 15-second slots; no catch-up                   |
| Recovery                      | 16      | From `E`, 30-second slots; stop after two consecutive healthy reads |
| Total                         | 44      | One browser request in flight; 15-second deadline; no retries       |

An abort consumes a remaining slot. Fault observation never exceeds 360 seconds;
recovery observation never exceeds 600 seconds after `E`. Failed/ambiguous
requests consume slots. A browser timeout does not prove cancellation of an
in-flight PostgreSQL operation: stop the stream on that deadline, retire admission
and never start a replacement probe. A late baseline callback cannot arm the
fault. Require bounded disposal of owned clients in implementation tests rather
than treating browser cancellation as server cleanup. One loopback client and at most one corresponding
upstream connection are permitted per admitted process/request. No SQL control
polls or mutations, new diagnostic jobs, AI/provider attempts or business writes
are introduced. Existing normal role checks and resolver security-metadata writes
remain explicitly in scope. Per-process caps are not described as distributed
counters; the one authorized controller's global request ledger is authoritative
for this run, and unexpected traffic invalidates it.

Preserve the unchanged API alert's ratio, 1% threshold, 300-second duration and
recipient. Collect measured Monitoring evidence; 23 client failures do not
guarantee sustained evaluation or an email. Reuse at most the existing two
bounded monitoring-evidence reads plus one matching incident/inbox inspection.
No extra channel-test notification or automatic second exercise is allowed.

Receipts allow only exercise/profile/source hashes, phase, sequence, UTC/duration,
sanitized request correlation, intended-cut/transport-failure/normal-path results,
counts and conclusion. Process nonce is non-authorizing ephemeral browser data,
not a durable credential or substitute for a Google execution attestation. Do not
retain cookies, tokens, raw session IDs, headers, SQL, packets, bodies or addresses.

## Acceptance mapping — no widened claims

| Observation                                            | What may be concluded                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Real `pg` socket cut and sanitized API failure         | Failure handling for this admitted request-scoped connection path               |
| Two normal authenticated PostgreSQL reads after expiry | This probe recovered without an external restore action                         |
| Matching sustained metric/incident and actual receipt  | Only the corresponding API alert/delivery criterion                             |
| Cloud SQL stayed running                               | Whole-instance outage/restart was **not** tested                                |
| Probe had no protected business transaction            | Appointment atomic rollback/confirmation integrity remain separate              |
| Worker/channel paths were untouched                    | Backlog drain, duplicate-effect and real channel failure proofs remain separate |
| No restored target or load workload                    | PITR/RPO/RTO and capacity remain separate                                       |

This changes the whole-SQL-outage packet's mechanism and scope. Freeze this
mapping in implementation review before assigning any S22 PASS. Do not relabel
an unavailable live test as completed because the design or a local fixture passed.

## Implementation and release gates — not authorized by preparation

1. After explicit offline-implementation approval, add the default-off profile,
   request-scoped session resolver selection, relay/typed configuration and
   sanitized receipts. Keep domain/booking logic and old SQL-stop preflight intact.
   Future affected modules are API composition/auth plugin, config, database
   session transport helper, existing security/probe tests and new focused tests.
2. Require unit/HTTP/real-TCP and isolated PostgreSQL/TLS tests: off/production/
   stale/foreign profiles; hostile headers, authentication and tenant invariants;
   same-process four-read admission; restart/replica/nonce changes; real role/
   resolver behavior; original SSL/SNI/CA equivalence and certificate rejection;
   real connection cut (not a mocked throw); no leaked credential or SQL; pooled
   client bypass; abort before/during a connect; late callbacks, skew and CPU delay;
   44-request accounting; socket/timeout/shutdown cleanup and normal recovery.
3. Use existing Node/pg stack. Declare the already-installed parser directly only
   if the reviewed implementation uses it. Run focused checks and full CI, then
   prepare an immutable default-off application rollout with fresh provenance.
   Do not build a watchdog image or change its rejected infrastructure proposal.
4. Any default-off code rollout requires its own fresh saved plan/approval. Later
   exercise configuration is an API-only, exact-profile environment change with
   pinned images, an unchanged 88-resource inventory and a new narrow plan guard.
   Do not relax historical guards or reuse consumed plans. Establish quiet-window,
   normal-session, clock and no-dispatch readiness once before the scheduled run.
5. Obtain separate exact authority for the enabled profile/window, operator
   security-metadata writes, connection cuts and actual alert delivery. Inspect
   live profile/readiness before the single browser run. A late apply or missing
   baseline means NOT_ADMITTED/INCONCLUSIVE, not a shifted window or second run.
6. After expiry verify real normal-path recovery and unchanged SQL/application
   configuration, then prepare a fresh plan removing the temporary profile.
   Removal needs the applicable exact-plan approval; expiry does not depend on it.
   No new IAM/resource cleanup, budget expansion or ledger reset is introduced.

## Offline implementation and verification boundary

The configuration loader, API request-local resolver, admission state machine,
owned TCP relay and sanitized receipts are implemented, default-off. The normal
session runtime's SQL/role checks are reused. No business or booking policy is
changed. Existing SQL-stop preflight/controller/watchdog files remain unchanged.

Focused tests exercise real pg socket cuts, both TLS negotiation modes with an
ephemeral CA-trusted certificate and rejection of an untrusted certificate,
cleanup/concurrency, profile/auth/tenant/header boundaries, rotation, replay,
clock/expiry and request accounting. Real PostgreSQL role/resolver/revocation and
HTTP baseline → 23 cuts → recovery cases are registered in the existing isolated
database suite, not claimed passed from a mock. Exact local and full-CI results
are reported with the implementation checkpoint.

No deployed profile, traffic controller invocation, image build, infrastructure
definition, cloud mutation, live fault, session setup or notification has run.
Local socket/CI database evidence is not live staging recovery or S22 acceptance.

**Next safe step after all implementation gates pass: prepare the immutable,
default-off code rollout packet. No build, deployment, enabled profile, fault run
or notification is authorized by the offline implementation approval.**
