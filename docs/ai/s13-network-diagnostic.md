# S13.B shared network diagnostic

Date: 17-09-2026, Windows/Node environment used by the evaluation runner.

STATUS: PASS for the diagnostic work only. S13.B remains paused at 250/310
observations, with 60 decisions remaining. ROOT-CAUSE CLASSIFICATION: INCONCLUSIVE.
No paid generation, resume, retry activation, staging, commit, or push occurred.

## Preserved evidence and budget

Both model smoke sets remain 10/10. The existing quality/safety failures,
observations, reports, runner configuration and cost ledger were preserved.

- Known usage estimate: USD $0.200610.
- Unresolved reservations: USD $0.035850.
- Conservative ledger, including the existing preflight allowance: USD $0.246460.
- Diagnostic model-generation calls: 0; model-generation spend: USD $0.
- S13.B actual-spend target: <= USD $5; absolute hard ceiling: USD $10.

SHA-256 evidence baselines, outside the repository, verified unchanged:

| Artifact directory | SHA-256 of evidence.json                                         |
| ------------------ | ---------------------------------------------------------------- |
| s13-screen-HYQUBF  | 3535A9B91B4D7F7DA72CADEC3F4F6DBE131131B3DAD3062368DE5D5A17B08528 |
| s13-screen-5benR8  | 9C73B827E60AE359D751BD02EEB40F436CCDA18138EBC29E18528D48110597C3 |
| s13-screen-meWg8f  | 0D37E0B76D7B9F3BF366DC4B2CB904358E15D2E77A91D3AC781E399CFF1B7F43 |

## Historical transport errors

- Luna, interrupted `s13-prompt-injection-08-0`: `network`, HTTP status/code
  unavailable; actual thrown error class/cause and abort state were not retained.
- Gemini, interrupted `s13-prompt-injection-15-0`: `network`, HTTP diagnostic
  unavailable; actual thrown error class/cause and abort state were not retained.
- Both therefore remain `UNKNOWN_NETWORK`. No historical DNS, TCP, certificate,
  reset, client timeout, or cancellation cause can be reconstructed conclusively.
- Earlier Luna HTTP 429 is separate preserved operational evidence. It must not be
  reclassified as a transport exception or a model-quality failure.

The **observability gap is confirmed**, not the underlying network root cause.
Both adapters catch the outer exception and return timeout when their composed
signal is aborted, otherwise generic network. Other outer throws can also enter
that catch; the old evidence does not isolate the precise throw phase.

No account dashboard/provider request-log access was available for these failed
requests. Missing HTTP evidence supports a client/upstream/network hypothesis but
does not prove where the failure occurred, whether the provider received a
request, or whether an unknown-usage request was billed. Current reachability
responses are new diagnostic evidence, not records of the interrupted calls.

## Timeouts, aborts, concurrency and connection handling

- Logical decision deadline: 60,000 ms, `AbortSignal.timeout`, shared with the
  maximum one serial schema-repair call.
- Each provider combines the input signal with its own 60,000 ms timeout using
  `AbortSignal.any`; the logical deadline is not reset by repair.
- Native fetch cancellation is cooperative. No additional outer `Promise.race`
  deadline was found. The opt-in Vitest live-screen test has a 3,600,000 ms ceiling.
- The historical network result takes the adapter's non-aborted branch, but no
  actual historical signal snapshot/elapsed fetch time survives. There is no
  evidence that either known failure was caused by the client timeout or test
  ceiling. No timeout was increased.
- The paired Gemini/Luna loop awaits each decision: global concurrency **1**;
  maximum simultaneous requests **1 per provider**, never both simultaneously.
- No configured concurrency knob or explicit inter-request pacing delay. Repair
  is serial. No high-concurrency pressure was found.
- Native fetch uses Node's default Undici dispatcher. No per-call agent, explicit
  `Connection: close`, or aggressive connection churn configuration was found.
  Adapters consume successful bounded bodies and cancel error/oversize bodies.

Installed Node: **v24.14.0**, bundled Undici **7.21.0**. Node documents that fetch
uses Undici and that `AbortSignal.any` carries the first abort reason.
[Node 24.14.0 globals documentation](https://nodejs.org/download/release/v24.14.0/docs/api/globals.html).
Default fetch dispatcher/connection behavior is documented by
[Undici](https://undici.nodejs.org/).

## Free connectivity proof

Exact configured hosts: `api.openai.com` and
`generativelanguage.googleapis.com`. Probes used no credentials, generation
endpoint, request body, or evaluation text. Response bodies were not inspected.

| Probe                                        | OpenAI                                  | Gemini                                  |
| -------------------------------------------- | --------------------------------------- | --------------------------------------- |
| Windows DNS                                  | PASS; 2 A / 2 AAAA records; 1,314 ms    | PASS; 8 A / 8 AAAA records; 99 ms       |
| Windows TCP 443                              | PASS; 133 ms                            | PASS; 92 ms                             |
| Windows curl HEAD + certificate verification | HTTP 401; verification result 0; 775 ms | HTTP 404; verification result 0; 861 ms |
| Node OS DNS lookup                           | PASS; 2 IPv4 / 0 IPv6 results; 12 ms    | PASS; 8 IPv4 / 0 IPv6 results; 1 ms     |
| Node TCP 443                                 | PASS; 76 ms                             | PASS; 91 ms                             |
| Node TLS                                     | PASS; authorized; TLSv1.3; 199 ms       | PASS; authorized; TLSv1.3; 198 ms       |
| Node native fetch, authless GET              | HTTP 401; 488 ms; signal not aborted    | HTTP 403; 314 ms; signal not aborted    |

URLs: `https://api.openai.com/v1/models` and
`https://generativelanguage.googleapis.com/v1beta/models`. HEAD/GET status
differences are not generation failures. All statuses demonstrate current
DNS -> TCP -> validated TLS -> HTTP reachability. No thrown fetch error was
reproduced. Windows record lookup versus Node OS-address lookup differences do
not establish an IPv6 defect.

Windows checks: `Resolve-DnsName -DnsOnly -QuickTimeout`, bounded .NET TCP
connection, and system curl with `-q --silent --head --connect-timeout 8
--max-time 15 --output NUL`, recording only HTTP status/TLS verification/time.
Node checks: bounded `dns.lookup`, `net.connect`, certificate-validating
`tls.connect`, and native fetch with a 15-second **diagnostic-only** deadline;
response body cancelled unread. Diagnostic sockets/timers were disposed.

## Network path and clock

- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`: all absent (presence-only).
- Windows WinHTTP: `DIRECT`.
- VPN: not detected among active adapters/Windows VPN connections. This is a
  presence check, not proof that all third-party network software is absent.
- `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, Node environment-proxy opt-in: absent.
  TLS verification was not disabled.
- Validated Node TLS issuer category: `PUBLIC_CA_RECOGNIZED` for both. Certificate
  validation failure/TLS interception: **NOT OBSERVED**, not categorically excluded.
- Windows time zone: West Asia Standard Time (UTC+5). Local UTC snapshot:
  2026-09-17T10:21:04Z. Subsequent HTTPS Date comparisons showed 0-second OpenAI
  and 1-second Gemini clock skew. No clock defect or settings change required.

These small successful probes cannot exclude intermittent host/network/provider
failures. No persistent firewall, proxy, DNS, certificate, clock, or Node-only
reachability problem was demonstrated. Connection errors can arise from network,
proxy, SSL, or firewall problems, but documentation alone cannot identify this
incident's cause.
[OpenAI error-code guidance](https://developers.openai.com/api/docs/guides/error-codes).

## Minimal change implemented

Evaluation-only `transportDiagnosticFetch` records a fixed allowlist of error
name/code, bounded nested/AggregateError codes, abort state/reason name, and
bounded elapsed milliseconds. Classifications are `CLIENT_TIMEOUT`, `ABORT`,
`DNS`, `TCP_CONNECT`, `TLS`, `SOCKET_RESET`, and `UNKNOWN_NETWORK`. Generic
`ETIMEDOUT` without a known phase stays unknown; connect `ETIMEDOUT` is TCP.

The wrapper sends identical URL/options, returns the original unread response,
and rethrows the exact original error. It does not retry, inspect error messages,
print raw errors, log headers/bodies/keys, change deadlines, or change results.
The opt-in evaluation test captures this metadata in a **new future artifact**
only if a separately authorized future run encounters a thrown fetch error.
Existing artifacts remain untouched. Production S12 adapters/retry semantics,
model/prompt/schema/reasoning/scoring, and budget reservations are unchanged.

No host repair is justified by current evidence. The next useful diagnostic is
safe failure metadata from a separately authorized evaluation resume, not another
installation strategy, TLS bypass, longer timeout, or repeated paid probes.

## Proposed evaluation-only recovery policy — NOT ENABLED

Separate owner approval is required. Proposed limits:

1. At most **2 total attempts per interrupted decision**, meaning **1 retry**,
   counted across resumes. Never retry completed quality/safety observations.
2. Sequential only. Delay 1,000–2,000 ms with jitter before the one recovery
   attempt. For explicitly transient rate-limit responses, honor validated
   `Retry-After` up to 30 seconds; longer/invalid guidance means stop for review.
3. Eligible only when classified transient: `EAI_AGAIN`, known connect timeout,
   socket reset/lost connection, HTTP 408, or transient 5xx such as 502/503/504.
   Client timeout may qualify only after confirming inference-only retry safety
   and reserving unknown usage. `UNKNOWN_NETWORK` requires review first.
4. No automatic retry for authentication/permission/invalid request, permanent
   DNS/configuration/TLS faults, quota/billing/unknown 429, schema incompatibility,
   deterministic policy failure, or unsafe/low-quality model output. Explicit
   transient rate-limit 429 may qualify only with safe classification/backoff.
5. Keep existing 60-second logical and adapter timeout configuration. A recovery
   resume is a separately accounted attempt; retain original failed timings and
   report recovery delay/attempt latency separately, never as one faster success.
6. Preserve the first failure, unknown-usage reservation, and all additional
   attempt/repair cost. Recalculate remaining worst-case spend before another
   paid attempt: target <= $5, projected total strictly below the $10 ceiling.
7. Stop if that decision fails again, or if failures recur across different
   decisions/providers. No retry loop or silent masking of provider instability.

No recovery policy was implemented or activated in this diagnostic.

## Changed files and verification

This diagnostic changed exactly four files relative to its starting tree:

- `tests/ai-evals/network-diagnostic.ts` (new).
- `tests/ai-evals/network-diagnostic.test.ts` (new).
- `tests/ai-evals/live.test.ts` (safe evaluation-only metadata wiring).
- `docs/ai/s13-network-diagnostic.md` (new report).

Focused checks only:

- `node node_modules/vitest/vitest.mjs run tests/ai-evals/network-diagnostic.test.ts`
  — 18/18 PASS, offline mocked fetch only.
- `node node_modules/typescript/bin/tsc -p tests/ai-evals/tsconfig.json --noEmit`
  — PASS.
- `node node_modules/eslint/bin/eslint.js tests/ai-evals/network-diagnostic.ts
tests/ai-evals/network-diagnostic.test.ts tests/ai-evals/live.test.ts --max-warnings 0`
  — PASS, zero warnings.
- Focused Prettier check and `git diff --check` — PASS.
- Starting-file/evidence SHA-256 comparison and presence-only credential review
  — PASS; only the intended `live.test.ts` changed among the pre-existing files.

Tests cover classifications, abort versus timeout, AggregateError/cycles/bounds,
arbitrary secret-like metadata redaction, no arbitrary getter execution, unchanged
fetch arguments/body, exact rethrow/no retry, and both adapters' original mapping.
Prior accepted offline verification was not rerun. No full CI/build or paid live
screen was executed.

## Git state and stop boundary

Branch: `verify/s13-model-selection`.
HEAD and `origin/verify/s13-model-selection`:
`fbeaf4350ba5867c0525eb0cb8c063395bf0e187`.
`main` and `origin/main`: `0b901f6a902600cabe5068ba8e2b37b88aff27c8`.

The prior S13.B batch remains uncommitted together with these diagnostic changes;
nothing is staged. No commit/push/merge. No migration/security/tenant change.
No Claude, S13.C, production model pin, S14, or remaining-60 resume.

S13.B NETWORK DIAGNOSTIC — READY FOR OWNER REVIEW
