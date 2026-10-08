# S22 synthetic Website Chat embedding proof

Status: **owner-observed live launcher UX PASS** after exact approved apply
**37735083627**. Read-only verification **37735337876**, whole-runtime convergence
exit **0** and corrected public loader byte-match proof remain valid. The owner
now confirms the refreshed chat closes/reopens and its closed button reads
`Chat with us`, not `Opening…`. Session/security and customer E2E proof remain
separate and pending. No Widget message, provider call or S22 acceptance is
authorized by this check.

Latest owner-supplied browser evidence: the restored synthetic Cloud Shell page
shows the genuine cross-origin frame with an empty composer; the owner explicitly
confirms successful close/reopen and the corrected launcher label. This closes
only the launcher UX regression. The earlier stale-label observation is retained
below as history. No independent redemption/server trace, host-token isolation
or independently captured cookie-policy proof was collected. The subsequent
owner reports a successful fresh opening with **Block third-party cookies**
selected and no covering site exception. Restoration of the original setting
remains unconfirmed.

## Observed starting point — 2026-10-07

The owner's current organization-bound Integrations screenshot shows **Website
Chat: Not connected**. `https://clinic.example` is the empty input's placeholder,
not an active website configuration or a real business. Disabled **Set up** while
the input is empty matches the existing UI. This observation is not a setup/load
regression. The adjacent recorded analytics show one lead, request and confirmed
appointment; the screenshot alone is not a new analytics reconciliation.

The repository has no deployed external synthetic website. Hosting a fixture on
the platform Web origin itself would not demonstrate the required cross-origin
iframe isolation. The existing [S19 Widget boundary](23-s19-product-ux.md#widget-iframe-isolation)
and [S22 topology](26-s22-staging-recovery-capacity.md#staging-topology) stay unchanged.

## Temporary host without infrastructure deployment

[Google Cloud Shell Web Preview](https://docs.cloud.google.com/shell/docs/using-web-preview)
provides a user-account-restricted HTTPS proxy for an HTTP server on port 8080.
Use `.github/scripts/s22-widget-host.mjs` through the reviewed commit's
checksum-verified startup command supplied in the milestone handoff. It requires
only existing Node, curl and sha256sum; no dependency installation, domain,
Terraform, IAM, container image or service change. Expected reviewed SHA256:
`59e972fed6b237baf7e6f27041b8a251462b2609896726bfb6e7002d64f04a09`.

The server exposes one synthetic HTML page, not files, an API proxy or credentials.
Only GET/HEAD `/` are supported; writes and other paths fail closed. It uses
fresh CSP nonces, exact staging script/connect/frame/form destinations, no-store
responses and request timeouts. It stops after one hour or Ctrl+C. Preview
addresses are ephemeral; obtain the actual HTTPS origin from the opened page,
never invent it from an example or reuse a previous preview address.

## Owner flow and evidence boundaries

1. Start the reviewed server in the existing Cloud Shell. Keep that terminal
   running; use **Web Preview → Preview on port 8080**.
2. The synthetic page displays its actual HTTPS website origin. Use **Copy
   website address**, then the existing authenticated workspace → **Integrations
   → Website Chat → Business website → Set up**. Current owner screenshot proves
   this is initial setup, not replacement of an unrelated installation. Check
   **Active for** reports that exact origin.
3. Use **Copy installation code** in the staff UI. Paste only that public snippet
   into the synthetic page and click **Install Widget**. Do not paste any secret,
   cookie or bearer. The host validates the exact existing canonical staging
   snippet and creates its approved script; it never executes pasted HTML or
   stores the snippet.
4. Open **Chat with us**, inspect the frame, close/reopen it. **Do not send a
   message.** Opening/redeeming creates a WidgetSession, not a conversation/model
   call. The genuine isolated frame still has Send; the host cannot reach into it
   to enforce the no-Send instruction. No new paid dispatch is authorized.
5. Record actual approved-origin open/close/reopen, frame/CSP/origin binding,
   third-party-cookie-independent session behavior and disallowed-origin denial
   separately. Do not claim these live assertions from local mocks. Any missing
   evidence remains pending, and Widget customer/booking E2E remains separate.

Stop the temporary server with Ctrl+C when the window ends. The application
currently exposes setup/replacement, not a dedicated disable button. Do not
invent a removal endpoint: a later **Replace setup** for the next approved host
rotates the installation key. Track the temporary origin until replacement;
Cloud Shell's owner-only proxy and stopped server are not a claim that the
persisted allowlist entry was deleted.

## Verification already performed

- Public live staging `/embed/widget.js`: HTTP 200, 5,039 bytes,
  `API_ORIGIN=https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app`, SHA256
  `abda0e39938bcd9ab55b938fbc53e712e120b662beea18448d324e9d234d1fd9`.
  Only safe static metadata was reported. This verifies loader configuration,
  not a completed session or deployment provenance for all services.
- `node --test .github/scripts/s22-widget-host.test.mjs`: **12/12 PASS**.
  Real local HTTP/CSP and controlled exact HTML bootstrap tests cover canonical
  snippet validation, nonce/closing-tag injection, HTTPS/distinct-origin guards,
  public-code-only installation, no fixture API dispatch/cookie reads, safe
  feedback and manual-only load retry. A generated bootstrap truncation defect
  was reproduced before correction (5 PASS/6 FAIL) and fixed by escaping script
  closing tags without changing the public installation contract.
- Scoped ESLint zero warnings, Prettier and diff checks PASS; independent source
  security review PASS. No production application code, migration, runtime
  configuration or paid call changed. Cloud Shell execution and live browser
  session proof are still pending.

## 2026-10-07 — live frame rejection and bounded correction

### Observations

The owner started the checksum-verified Cloud Shell host and opened its distinct
HTTPS Web Preview. The authenticated Website Chat setup subsequently succeeded:
the card reported configured/active for the exact preview origin. The owner
installed the normal public snippet and opened the real iframe; it displayed
`Chat is temporarily unavailable.` No Send or paid test was performed.

The owner supplied these narrowly scoped Cloud Logging request records, with
`LOG_READ_EXIT=0`:

| Request | UTC timestamp | Status | Latency |
| --- | --- | --- | --- |
| Web gateway `/v1/widget/embed-policy` | `2026-10-07T17:41:07.108243Z` | 200 | 0.017547776s |
| Web `/widget/frame` | `2026-10-07T17:41:06.872729Z` | 400 | 0.256173704s |

These are owner-supplied live request metadata, not a newly performed agent DB
read. Request timestamps describe request start; the frame issues the nested
policy request before returning. They establish successful policy lookup followed
by frame rejection, not session redemption or customer-message processing.

### Confirmed mechanism

The original frame route compared the inspected signed grant's public
`iframe_origin` with `new URL(request.url).origin`. The installed Next 16.3.3
standalone server, bound to `0.0.0.0:8080` behind Cloud Run TLS termination,
constructs the adapted request as `https://0.0.0.0:8080/widget/frame` despite
public Host/forwarded headers. The actual installed `attachRequestMeta` and
`NextRequestAdapter.fromNodeNextRequest` reproduction returned **400** with a
valid mocked policy where the required result was **200**. No network connections,
provider calls or live grants were used. This is a framework-level local reproduction,
not a manually substituted URL assertion or a complete real-browser proof.

The policy endpoint's actual contract is synchronous signed-grant/configuration
inspection: it needs no staff session, Origin header, DB/RLS permission or
redemption. Its successful envelope and unchanged gateway forwarding reject an
earlier policy/network/tenant-lookup failure as the observed boundary. Signed
grant expiry/origin mismatches still fail closed. No provider configuration or
installation-key rotation is implicated by this frame failure.

### Smallest coherent correction

- Require independent trusted Web `WIDGET_PLATFORM_ORIGIN`, populated by tracked
  Terraform from the existing canonical `web_public_origin`. Match the inspected
  policy exactly against it, never against request URLs or forwarding headers.
- Keep grant validation, nonce CSP, exact `frame-ancestors`/`connect-src`, no-store,
  iframe sandbox, single-use redemption and memory-only bearer behavior unchanged.
- Bound the policy request/body read to 15 seconds, prohibit redirects and retries,
  and emit only finite outcome/stage tags, statuses and safe correlation IDs. No
  grants, origins, credentials, message content or raw upstream errors are logged.
- Retain generic owner-facing failure responses while exposing a safe request ID.

The same owner setup window exposed a separate staff UI recovery defect: missing
CSRF stopped setup before its POST, while failed authorized status reads left
cached ready UI visible. Reload/sign-in restored normal setup. The shared staff
request helper now routes actual **401** to the existing organization-bound
reauthentication UI, as do missing-CSRF initiation branches; **403** is not
misclassified. No mutation is retried, and late initialization/analytics results
cannot restore signed-in state after failure. Backend Auth0, MFA, membership,
rotation and cookie policies are unchanged. A source-supported concurrent-cookie
rotation hypothesis is not proven by this window and is not patched.

### Verification and remaining unknowns

The original actual-framework route reproduction failed before correction and
passes after correction. Focused local/mock tests cover configured-vs-proxy origin,
foreign/spoofed origins, invalid input/configuration, policy failures and fetch/body
timeouts, safe correlated telemetry, staff 401 recovery and preservation of
organization/CSRF/request semantics. Existing staff workflow and integration
navigation regressions are retained. Final check results and rollout provenance
are recorded in the acceptance register.

At the investigation checkpoint, live deployment remained unchanged until an
exact new saved plan was reviewed and approved. Approved-origin frame/session open/close/reopen,
third-party-cookie-independent behavior and disallowed-origin live rejection
remain unproven. Same-origin embedding is a separately identified unchanged
isolation risk, not the cause of this distinct-origin test failure. The temporary
host may expire; do not request another owner retry before the corrected rollout.

## 2026-10-08 — rollout verified; live session still pending

The exact saved plan **37669343531** was owner-approved and applied once in
**37672530149**: **0 added / 4 changed / 0 destroyed**, no replacements or
migration execution. The four fresh images belong to source
`65b6c906f3a3433a1093abcf1aada4b0f2f00423`, deployment timestamp
`2026-10-07T18:45:42Z`, unchanged migration head
`0031_s22_widget_inbound_route_management`. Detailed provenance is in the
[acceptance register](s22-acceptance-evidence.md).

Existing read-only verification **37672800406** passed API source/image/time/head,
identity/private networking/secret-reference/readiness checks and Web
image/readiness. Ready revisions: `lead-agent-staging-api-00023-w68` and
`lead-agent-staging-web-00019-hjs`. Refreshed whole-runtime Terraform convergence
**exit 0** covers the new Web `WIDGET_PLATFORM_ORIGIN` configured from the same
canonical Web origin as the API's signed policy; no independent direct REST
environment assertion is claimed. No paid call or repeated migration/test suite.

Bounded post-apply public probes passed API health, organization-bound staff HTML
and `/embed/widget.js` reachability (all **HTTP 200**). The loader remains 5,039
bytes, SHA256 `abda0e39938bcd9ab55b938fbc53e712e120b662beea18448d324e9d234d1fd9`,
with the canonical Web gateway API origin. No cookies, grant, customer message or
provider call were used; these are not authenticated owner/session proof.

The live browser must still open the actual approved-origin frame, redeem a
session, and close/reopen it without **Send**. The old host stops after one hour:
restart the same checksum-verified script in existing Cloud Shell and obtain the
actual origin from **Web Preview**. Do not request a setup replacement or key
rotation unless that actual origin differs from the configured synthetic host.
The public installation snippet may need remounting on the refreshed temporary
page; that is not a new provider/tenant setup. No credential or grant value should
be copied into chat. Deployment/HTTP readiness alone is not Widget acceptance.

## 2026-10-08 — owner open/reopen and launcher lifecycle regression

### Observations and confirmed mechanism

After the approved origin rollout, the owner installed the normal public snippet
on the same synthetic Cloud Shell preview origin. Screenshots show the genuine
frame greeting and composer, and the owner reports successful close/reopen with
no Send. The closed launcher still reads `Opening…`. These are owner-supplied
live browser observations, not an agent-collected redemption/database trace.

The generated loader changes its label to `Opening…` while requesting a grant.
An authenticated-by-origin/source/instance `READY` message clears its busy state
and enables the button, but never restores the configured label. `CLOSE` simply
shows that unchanged button; reopening reuses the same frame. This directly
explains an enabled, working launcher with a stale loading label. A lost READY
signal is not needed to produce the symptom; welcome HTML by itself would not
prove that signal was received.

The same lifecycle implementation has two directly related local failure paths:
`EXPIRED` before `READY` removes the frame but leaves the busy latch set, so the
manual next attempt is ignored; a form-submit exception leaves a partially
created frame/form, so retry can reopen that invalid frame. Both require
behavioral regression coverage. No provider/configuration/tenant change or
automatic retry is justified. Exact source/origin/version/instance/payload
checks, sandbox, form-only grant transfer and memory-only bearer remain required.

### Focused correction and local proof

The loader captures the configured/default label and restores it only after a
validated `READY`. Valid `CLOSE` permits reopening the cached frame even while
redemption is pending; a later `READY` leaves a closed frame closed. `EXPIRED`
and startup failures clear the busy latch and discard the old/partial frame.
The temporary grant-transfer form is removed in `finally`, including a submission
exception. Retries remain explicitly user-triggered; normal reopen requests no
new grant or session. No frame/API/public-message contract changes.

An exact generated-loader + generated-frame controlled VM reproduction first
observed genuine scripted `READY` followed by an enabled `Opening…` launcher and
the blocked manual retry after failed redemption. After correction, all 12
reproduction assertions pass. This uses synthetic redemption responses/minimal
DOM, not live grants, a database or a paid provider. The new repository lifecycle
suite has **17/17 PASS**, covering default/custom labels, cached reopen,
duplicate mounts/clicks/READY, foreign/malformed/retired-frame messages, failure
cleanup, manual retry and close-before-READY. Existing product UX **16/16** and
frame route **26/26** checks pass unchanged. Visible HTML is not substituted for
the authenticated-by-origin/source/instance readiness handshake.

Final combined run on the committed runtime source:
`node node_modules/vitest/vitest.mjs run apps/web/src/lib/widget-embed.test.ts apps/web/src/lib/product-ux.test.ts apps/web/src/lib/widget-frame.test.ts`:
**59/59 PASS**, three files, no paid/network/database dispatch.

The additional isolated native Edge attempt validated real browser `READY`,
exact iframe sandbox, cross-origin host-DOM denial and form cleanup with synthetic
HTTPS responses, then stopped at a harness assumption that the iframe must have
a separate DevTools target. A bounded tooling-only fallback timed out waiting for
READY before close/reopen assertions. Neither attempt establishes a completed
native before/after case or live Cloud Run session proof. Both fresh temporary
profiles were removed and their absence verified; no owner profile, live API,
message/provider route or credential was used. No further identical retry.

### Evidence boundaries

Owner-observed open/close/reopen is recorded and the launcher correction is locally
verified; it still requires fresh immutable provenance and exact-plan approval
before staging apply. Corrected live-label behavior, redemption/session metadata,
blocked-third-party-cookie operation and disallowed-origin denial remain pending.
No message, model call, configuration replacement, migration or IAM change is
authorized by this non-paid check. S22 remains unaccepted.

## Launcher correction — exact saved-plan approval packet

Status: **local correction verified; one fresh plan reviewed; NOT applied**.
The owner approval for the preceding origin rollout does not authorize this plan.

- Runtime source: `6a31cd8e3a37f31a7bb85329eab0aa9c4de53926`.
- Branch: `verify/s22-staging-recovery-capacity`.
- Focused source/test/evidence commit: `6a31cd8`, pushed and remote verified.
- Immutable build: [37680689682](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37680689682), PASS;
  checked-out source and all four manifest images match that exact commit,
  architecture `linux/amd64`. No duplicate build.
- Plan: [37681742450](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37681742450), PASS;
  exactly one `plan/full` dispatch, never apply.
- Preserved UTC deployment timestamp: `2026-10-07T20:22:40Z`.
- Unchanged authoritative migration head:
  `0031_s22_widget_inbound_route_management` (32 migrations; no migration rerun).
- Independently calculated saved-plan SHA256 matches its downloaded sidecar:
  `a228a8c3ce86c59c886e9c6884226d7969a8c51e03200b5c5c294d0abd9da485`.

Immutable manifest references:

| Workload | Exact image reference |
| --- | --- |
| API | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:fc59c182cc701e3e85d2ec2ee4efb42559f11ba30d07a6120bb166a7b0ada6ff` |
| Web | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:4e5f2c4bebfae5a994c07699ccc9b0bb0509d032a1dbb88cafabf5f697089e57` |
| Worker | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:23308eb3c06874b1c582d56f6a4fdfbe5124e795e77fa0f8d2371505c36f0dcf` |
| Migrator | `me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:d60994941524aa00ecdd6859c3361f99e213cd0d113ea1753efd03c6caa0fa6f` |

Sanitized actions: **0 creates / 4 in-place updates / 0 destroys / 0 replacements**:

- `update:google_cloud_run_v2_service.api[0]`
- `update:google_cloud_run_v2_service.web[0]`
- `update:google_cloud_run_v2_worker_pool.worker[0]`
- `update:google_cloud_run_v2_job.migrator[0]`

Independent locked-provider field review (Terraform **1.14.7**, Google **7.46.1**)
passed. Only images, exact git labels and deployment provenance change. All **84**
unchanged managed resources were checked too; no configuration unknowns or other
computed-unknown differences remain. All predecessors match the verified prior
runtime `65b6c906f3a3433a1093abcf1aada4b0f2f00423` /
`2026-10-07T18:45:42Z` / unchanged migration head. Canonical Web
`WIDGET_PLATFORM_ORIGIN`, private networking/egress, identities, secret references,
commands, SQL, IAM, scaling, model/cohort/budget controls are unchanged.
The temporary readonly reviewer passed **32/32** controlled cases, checking
configuration differences and configuration-unknown masks explicitly.
No secret-bearing Terraform JSON or environment values were
printed or committed.

Workflow full-runtime safety passed; apply and one-shot migrator steps are
**SKIPPED**, migration execution disabled. No later apply appeared in authenticated
workflow records at packet review. No separate fresh Cloud Shell state-serial
comparison is claimed: Terraform must still reject this exact saved plan if state
has changed by apply time. Such rejection requires stopping, not replacing the
plan under this approval.

Prepared exact subsequent apply inputs, deliberately **without** an approval token:

```json
{
  "action": "apply",
  "phase": "full",
  "commit_sha": "6a31cd8e3a37f31a7bb85329eab0aa9c4de53926",
  "deployment_timestamp": "2026-10-07T20:22:40Z",
  "api_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/api@sha256:fc59c182cc701e3e85d2ec2ee4efb42559f11ba30d07a6120bb166a7b0ada6ff",
  "web_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/web@sha256:4e5f2c4bebfae5a994c07699ccc9b0bb0509d032a1dbb88cafabf5f697089e57",
  "worker_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:23308eb3c06874b1c582d56f6a4fdfbe5124e795e77fa0f8d2371505c36f0dcf",
  "migrator_image": "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:d60994941524aa00ecdd6859c3361f99e213cd0d113ea1753efd03c6caa0fa6f",
  "ai_journey_mode": "preserve",
  "api_migration_head": "0031_s22_widget_inbound_route_management",
  "runtime_migration_head": "0031_s22_widget_inbound_route_management",
  "plan_run_id": "37681742450",
  "approved_plan_sha256": "a228a8c3ce86c59c886e9c6884226d7969a8c51e03200b5c5c294d0abd9da485"
}
```

Only after owner approval of this exact run/hash may the existing workflow receive
`owner_approval_token=S22-APPLY-APPROVED`. No rebuild or replan is needed for later
documentation-only evidence. After apply, use the existing read-only API-image
verification with these fresh references/provenance to check API/Web readiness
and whole-runtime convergence, then verify the real host label with no Send.
Local tests/plan review do not establish corrected live behavior or S22 acceptance.
Historical NULL costs remain preserved and the exhausted cohort blocks paid calls.

## 2026-10-08 — exact approved launcher rollout verified

The owner explicitly authorized **Apply plan 37681742450 only**. The existing
binary and sidecar were checked again against approved SHA256
`a228a8c3ce86c59c886e9c6884226d7969a8c51e03200b5c5c294d0abd9da485`.
Prepared inputs/manifest/source/time/head matched the packet; independent
read-only comparison passed 52 assertions. The later `1f45516` commit changes
only evidence documentation, not runtime/workflow/Terraform code. No build,
replacement plan or previously passed test was repeated.

[Apply **37735083627**](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37735083627)
**PASS**: exact saved artifact download, integrity and full-runtime approval
checks passed, then Terraform reported **0 added / 4 changed / 0 destroyed**.
No replacements. Apply used reviewed runtime source
`6a31cd8e3a37f31a7bb85329eab0aa9c4de53926`, all four immutable references above,
unchanged head `0031_s22_widget_inbound_route_management`, and the exact declared
deployment timestamp `2026-10-07T20:22:40Z`. This historical provenance timestamp
was preserved, not replaced with the approval/execution date. GitHub dispatch
HEAD was the documentation descendant `1f45516`; runtime checkout and deployment
provenance remain `6a31cd8`. Migrator execution/database validation steps were
**SKIPPED**. No unrelated configuration, IAM, network, SQL, scaling or paid-budget
changes.

[Read-only verification **37735337876**](https://github.com/mufazzalshokh/lead-agent-platform/actions/runs/37735337876)
**PASS**, artifact `s22-api-image-live-evidence-37735337876`: all **16** assertions
pass, **0 failures**. Twelve direct API checks cover image/source/time/head,
identity/private VPC/subnet/egress, 15 secret references by count and readiness.
Three direct Web checks cover exact image/readiness/revision. Ready revisions:

- API: `lead-agent-staging-api-00024-hx6`.
- Web: `lead-agent-staging-web-00020-hz9`.

The remaining assertion is refreshed **whole-runtime convergence exit 0**,
covering Worker/Migrator bindings and canonical Web origin configuration, not
independent direct REST descriptors for those resources. Migration head is
configured provenance; no new DB-journal diagnostic is claimed. The verifier's
replacement-plan creation, apply, migrator execution and DB-validation steps
were **SKIPPED**. Its unsaved convergence read is not a replacement deployment
plan or infrastructure apply.

Bounded credential/cookie-free post-apply public reads passed before
`2026-10-08T06:02:02Z`: API `/health` **HTTP 200**, `service=api`, `status=ok`;
exact organization-bound staff shell **HTTP 200** HTML; `/embed/widget.js` **HTTP
200**, **5,286 bytes**, exact byte match to the loader generated from committed
`6a31cd8` with the canonical Web gateway origin. Expected and live SHA256:
`9174e16a48d3bb1620d20e8854a774f78daac22d5d917b8ea7744cc2f7eaea0a`.
Each request/body read was bounded to 15 seconds/100 KB, redirects prohibited.
An initial restricted-network failure was a local transport limitation; the
permitted read succeeded. No HTML/script, cookies, grants or credentials were
dumped. These GETs prove serving/reachability, not owner authentication, grant
redemption or browser close/reopen. No paid/provider/message route was called.

The existing open page can still hold the old launcher in memory or its cached
script (public cache lifetime 300 seconds). A fresh page/remount must fetch the
new loader before claiming the label fixed in the owner's browser. Reloading the
synthetic host clears its intentionally non-persisted installation; remount only
the public snippet, never replace setup or rotate the key merely to update JS.
The temporary host may have expired: first confirm that the actual test page is
still available; do not assume an unavailable server is an application failure.
No Send or new paid-call authorization. Historical NULL costs and the exhausted
cohort remain untouched; S22 remains unaccepted.

## 2026-10-08 — owner verifies corrected live launcher

Evidence type: **owner-supplied live browser observation**. Attribution uses the
already verified `6a31cd8e3a37f31a7bb85329eab0aa9c4de53926` rollout / Web revision
`lead-agent-staging-web-00020-hz9` and served-loader byte match above; no new
revision read or exact UTC browser-test timestamp was collected.

The owner showed HTTP **404** at the temporary preview root after hard refresh,
then confirmed page availability after the supplied checksum-pinned existing-host
startup instruction. The fixture accepts `/?authuser=0` and stops after one hour,
but the screenshot alone does not prove expiry or a particular proxy/server
cause. No production defect was inferred from the 404.

After remounting the normal public snippet under instructions not to replace
setup or Send, the owner supplied a screenshot on the same distinct preview
origin showing the genuine frame, greeting and empty composer. The owner then
explicitly confirmed the chat reopens and the closed button reads exactly
**Chat with us**. Owner-observed open/close/reopen and corrected label: **PASS**.
This is consistent with the corrected validated `READY` lifecycle, but no message
event, redemption response, session ID or server trace was independently captured.
No Send was reported; this update makes no new ledger/provider-call-count claim.

Blocked-third-party-cookie fresh-session behavior, disallowed-origin denial,
host access denial to iframe/token and actual Widget customer/booking E2E remain
pending. The next non-paid preparation is to inspect the existing browser cookie
setting without changing it or deleting cookies, before selecting a bounded
fresh-session check. Only this document and the acceptance register change;
scoped Markdown format/diff checks suffice. Existing runtime tests, build,
deployment and read-only verification are not repeated. Historical NULL costs
and paid-dispatch limits remain unchanged; S22 remains unaccepted.

## 2026-10-08 — fresh opening with cookie-block setting selected

The owner's initial Chrome-settings screenshot showed **Allow third-party
cookies** selected. The proposed temporary DevTools control was unavailable under
the `privacy` command in the observed UI; no browser-version-wide removal claim
is made. The fallback's global scope and planned restoration were disclosed.
The owner explicitly confirmed selecting **Block third-party cookies**.

The owner was then instructed to hard-refresh only the synthetic website,
remount the same public installation snippet and open a new frame, not reuse the
cached iframe. Asked whether the greeting and composer appear, the owner confirmed
that it works. **Owner-reported fresh opening with Block selected: PASS**.
No Send was reported; no new runtime/log/DB/provider accounting read was made.

An allowed-site exception can override the global setting. Asked whether an
exception covers the preview or platform origin (including wildcards), the owner
answered **no** and reiterated that **Block** was selected. **Owner-reported fresh
bootstrap under cookie blocking without a covering exception: PASS**. This is
owner-supplied policy/behavior evidence, not an independent cookie/request trace.
No exception list, cookie value, token or credential was requested.

Cleanup is still pending: the reply did not confirm restoring the original
**Allow** setting, so restoration was requested again without deleting cookies.
Direct session traces, live origin/token isolation and customer E2E remain
separate. Only documentation changes; no runtime tests, deployment or paid calls
are repeated. Historical NULL costs remain unchanged; S22 is not accepted.
