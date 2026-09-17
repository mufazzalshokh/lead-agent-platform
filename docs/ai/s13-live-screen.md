# S13.B — Bounded two-model live screen

This is opt-in evaluation, not production provider selection. S13.A's frozen
140-case screen is unchanged. S13.C and S14 are not authorized here.

Current execution status: **310/310 observations COMPLETE**. The last resume made
exactly 60 generation calls, exit code 0, without a new failure/repair. Total known
usage estimate $0.248071; conservative ledger $0.293921. Both candidates retain
quality/safety failures; see [completed results](s13-live-screen-results.md).

## Owner-approved budget and allocation

The latest owner policy supersedes the initial $15 brief: **$10 absolute ceiling**,
**≤$5 target**, with no optional calls simply because money remains.

Per candidate: 10 representative compatibility decisions, 140 original-only core
decisions, and five bounded normalization-B decisions paired with their existing
core-A results. Total: **310 logical decisions, at most 620 generation requests**
including the shared one-repair-or-recovery allowance per decision. Five optional safety repeats per model
are reserved in the planning tests but deliberately omitted from the live run.

Prices reverified against official docs on 2026-09-17 (USD per million tokens):

| Exact candidate    | Input | Cached input | Billable output including reasoning |
| ------------------ | ----: | -----------: | ----------------------------------: |
| `gemini-3.8-flash` | $0.75 |       $0.075 |                               $3.75 |
| `gpt-5.6-luna`     | $0.20 |        $0.02 |                               $1.20 |

Luna reservation/estimates conservatively price uncached input at $0.25 to include
the documented cache-write premium. Gemini prices are those effective through
2026-12-31, not the announced 2027 prices. Sources: [Google pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Luna model/pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

Normal assumption: 3,000 input + 500 total billable output tokens per physical
request, no repairs: **$0.848625**. Input reserve 9,000; combined output/reasoning
limit 4,000. Every request at both limits and every decision repaired:
**$8.928000**. Two non-generation token-count preflights carry an additional
conservative **$0.010000 allowance**, not a claim that token counters charge that
amount. Combined planning reserve **$8.938000 < $10**.

Both transports' complete serialized fixtures plus a 512-byte structural allowance
fit below the input reserve. One token per byte is conservative planning inference,
not a formal provider guarantee. Provider token counters check the largest fixture
before generation. Every generation reserves its worst-case charge before dispatch
and then records provider-reported usage, with integer micro-dollar arithmetic.
Unknown cache usage gets no discount. Unknown billable input/output retains its
entire reservation. It halts the run except for the one explicitly approved,
classified transient recovery described below. The shared 60-second decision
deadline is not reset for schema repair.

The latest owner authorization enables **evaluation-only** transient recovery:
at most **two total physical attempts per logical decision**, including the
original, recovery and any schema repair. A successful recovery cannot trigger
a third schema-repair call. Recovery is sequential with 1–2 seconds bounded
jitter. Each recovery attempt has the existing 60-second request/decision
deadline; total recovery latency includes the failed attempt and backoff and
can exceed 60 seconds. This never changes S12 production transport semantics.

Only classified transient DNS/connect/socket failures, safe inference-only client
timeouts, HTTP 408/transient 500/502/503/504, or proven transient rate-limit 429
with valid honored backoff qualify. Quota/billing/ambiguous 429, permanent
TLS/configuration/auth/request faults, completed quality/safety outcomes and
deterministic failures never qualify. Unknown new network failures stop for
review. The owner's explicit resume authorizes exactly one second attempt for
the already-reviewed pending Gemini interruption whose historical cause is
unavailable; it is not a general unknown-error retry allowance.

All physical attempts and unknown-cost reservations survive successful recovery.
A second failed attempt stops immediately. Three distinct decisions with the same
classified transport cause trigger a conservative recurring-pattern stop, without
stopping merely because one transient failure recovered successfully. Projected
remaining worst-case cost is checked before every dispatch. At the preserved
250-observation checkpoint, the carried ledger plus at most two calls per
remaining decision was **$1.974460 < $10**;
subtracting the already-consumed pending Gemini slot tightens that bound to
**$1.952710**. No optional calls are added.

## Matched configuration and trust boundary

The accepted S12 OpenAI adapter is unchanged. An evaluation-only fetch wrapper adds
the same bounded Latin-Uzbek instruction used by Gemini and explicitly selects
`reasoning.effort=low`. Gemini uses native stateless `generateContent`,
`thinkingConfig.thinkingLevel=low`, JSON MIME type, and the identical canonical
schema projection. Both enforce canonical AgentDecision.v1 locally and evaluate
the same S12 deterministic policy. No execution port exists in the runner.

Original input, history snapshot, supplied facts, schema, safety wording and output
requirements have the same meaning. The synthetic application snapshot is data,
not an instruction or expected answer. Normalization B appends bounded untrusted
metadata; it never replaces the original. The supplied locale hint matches the
case's expected language for both candidates, so this is not a blind language-ID
test. Expected intent, action and safety labels are not sent. No provider has
tools, search, function calls, uploaded files or conversation state.

Exact model access was checked with non-generation authenticated metadata requests.
Response model identities are recorded; an unexpected candidate identity halts
evaluation rather than silently substituting a model. Sources:
[Gemini model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output),
[Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking),
[Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

## Privacy and evidence

Credentials are environment-only; no actual key, .env file, HTTP error body,
provider response envelope, response ID or hidden reasoning is emitted. The corpus
is synthetic. Temporary evidence includes canonical synthetic drafts for pending
human review, scores, token usage, integer cost estimates and monotonic timings.
Before evidence is emitted, model output is checked for actual key material.

OpenAI retains S12 `store:false`; this is **not** a zero-retention claim. Google's
stateless request has no equivalent `store:false` flag. Optional persistence/cache
is not enabled. Paid and free Gemini content-use terms differ; free-tier content
may be used to improve products. Limited abuse-monitoring retention can remain.
Synthetic evaluation does not approve either provider for production customer or
healthcare data. Google's medical-use restrictions and provider/legal/privacy
approval remain tracked launch risks, not decisions silently resolved in S13.B.
Sources: [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data),
[Google pricing/content use](https://ai.google.dev/gemini-api/docs/pricing),
[Google retention controls](https://ai.google.dev/gemini-api/docs/zdr),
[Google API terms](https://ai.google.dev/gemini-api/terms).

Reports separate first-pass and repaired schema validity, raw forbidden proposals,
local policy fallback, refusal, language, and actual Latin-script drafts. Null
fallbacks do not inflate Latin reply compliance. Exact short original quotations
and source-bound proper names are exempted, not arbitrary quoted model prose.
Every slice is visible. Subjective Uzbek fluency, clinical/admin appropriateness,
tone, factual prose and regional meaning require native/human review. Candidates
do not grade themselves. S13.A synthetic labels and correlated seed clusters are
not native-approved gold or independent statistical samples.

Physical, first-pass, repair and logical latencies include p50/p95/p99/max. These
are **provider component timings**, not channel TTFR or proof of the desired
3–10-second meaningful reply / ≤60-second end-to-end p99. Conversation-cost
projections assume ten decisions per conversation and exclude non-model costs.

## Execution

Default tests are offline. Only explicit process-local `S13_LIVE_SCREEN=1` enables
the paid test, using existing secure `OPENAI_API_KEY` and `GEMINI_API_KEY` variables:

```powershell
$env:S13_LIVE_SCREEN = '1'
try {
  node node_modules/vitest/vitest.mjs run tests/ai-evals/live.test.ts
} finally {
  Remove-Item Env:S13_LIVE_SCREEN -ErrorAction SilentlyContinue
}
```

Do not repeat this command merely to improve scores. A stopped run is partial;
remaining calls need a documented cause and reconciled spending. Production
`AI_MODEL`, public contracts, migrations, tables and all accepted architecture
remain unchanged. Claude and training calls are not authorized.

After the owner confirms account recovery, set process-local
`S13_RESUME_EVIDENCE` to the preserved outside-repository `evidence.json` and use
the same opt-in command. Clear that variable in `finally` too. Resume validates
the corpus hash, frozen-plan prefix, evidence types and integer budget balance
before dispatch. It skips completed observations, carries prior call counts and
unknown-bill reservations, and reuses token-count evidence without extra calls.
The original artifact remains untouched; the resumed artifact links to it.

## Historical execution checkpoints

The paragraphs below preserve previous stop states, not current remaining work.
The latest approved recovery/completion policy above supersedes old retry stops.

The initial partial checkpoint had one completed Gemini smoke and a $0.017784
conservative ledger. Its owner-authorized resume began with Luna's failed smoke:
309 decisions remained, worst total $8.902284. An evaluation-only diagnostic wrapper
retains HTTP status and allowlisted provider code/type, never messages, identifiers,
credentials or raw error bodies. Another 429 stops immediately without retry.
Prepaid account credit purchases are not model usage spend and are not added to
this ledger. Prior unknown generation reservations are not silently forgiven.

The first resume completed both compatibility smokes and reached 237/310 decisions
before a Luna network-category failure without an HTTP diagnostic or known usage
stopped the ledger. That checkpoint preserves all completed observations and
both unknown-bill reservations; it is linked from the results report. There were
73 decisions left at that checkpoint. The owner's next authorized resume retried
the interrupted Luna decision once successfully, then reached 250/310 before a
different Gemini decision failed with category `network`. The repeated-failures
STOP rule applies; 60 decisions remain. The conservative ledger is $0.246460,
including all three unresolved reservations and the original preflight allowance.
Do not resume a halted ledger without a documented cause, spending reconciliation
and owner direction.

The subsequently approved evaluation-only recovery completed all remaining 60
decisions, including the pending Gemini second attempt. All 250 earlier
observations and all three original artifacts remain identical. The final artifact
records 313 physical attempts, including all three unknown-bill failures and their
successful owner-authorized recoveries. No new transient fault occurred; automatic
eligibility/circuit behavior is established offline, not by invented live failures.
No more paid screen calls are authorized merely to improve these completed results.
