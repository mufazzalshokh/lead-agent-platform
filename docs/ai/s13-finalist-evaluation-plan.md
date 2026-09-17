# S13.C — Cost / final evaluation plan

STATUS: **PREPARATION ACCEPTED / EXECUTION OWNER-AUTHORIZED**. The owner approved
the incremental evaluation on 17-09-2026 with a **$2 target / $5 hard ceiling**
and dynamic sequential reservations. Preparation made **zero provider calls**.
Live completion, native review and production model approval are separate gates.

Execution update: **AUTOMATED EVALUATION COMPLETE**, 840/840 new decisions saved,
merged with 140 accepted core cases/candidate to **560 cases/model**.
See [the full evaluation report](s13-finalist-evaluation-results.md).
The owner-authorized unknown-interruption recovery and classified DNS recovery
succeeded. The owner clarified that genuine thrown `ENOTFOUND` with no HTTP
response belongs to the approved eval-only transient class; its exclusion was
corrected narrowly. Five original C interruptions remain in the 845-call ledger.
Known C usage estimate **$0.678250**, unresolved **$0.049950**, conservative
**$0.728200**; target $2 and cap $5 respected. No generation/scoring change.
Native review and final model approval remain pending; no production pin.

Prepared 17-09-2026 on `verify/s13-model-selection`, starting from accepted
S13.B checkpoint `2cd51ab65c710ba1f59444fb9776ec5a74d46faa`.
The S13.B report/artifacts, scoring, prompts, schemas, corpus and reasoning settings
remain unchanged. Main is not merged or changed.

## Exact new-case plan and evidence merge

The read-only planner verifies unique full-corpus IDs, unique accepted screen IDs,
an exact 140-row core set for **each** candidate, and membership of every screen
record in the full corpus. Duplicates/missing/foreign IDs stop preparation; no
input-text approximation or guessing is used.

| Slice                      | Full per model | Preserved per model | New per model |
| -------------------------- | -------------: | ------------------: | ------------: |
| EN_STANDARD                |             80 |                  10 |            70 |
| RU_STANDARD                |             80 |                  10 |            70 |
| UZ_LATIN_STANDARD          |             32 |                   4 |            28 |
| UZ_CYRILLIC                |             32 |                  12 |            20 |
| UZ_MIXED_SCRIPT            |             32 |                  12 |            20 |
| UZ_SLANG                   |             32 |                  12 |            20 |
| UZ_TYPOS_PHONETIC          |             32 |                   4 |            28 |
| UZ_POLITENESS              |             32 |                   4 |            28 |
| UZ_REGIONAL                |             32 |                   4 |            28 |
| UZ_RU_CODE_SWITCH          |             32 |                  12 |            20 |
| UZ_SHORT_MESSAGES          |             32 |                   4 |            28 |
| UZ_LATIN_OUTPUT_COMPLIANCE |             32 |                  12 |            20 |
| PROMPT_INJECTION           |             40 |                  20 |            20 |
| SAFETY_ACTION_AUTHORITY    |             40 |                  20 |            20 |
| Total                      |        **560** |             **140** |       **420** |

Owner-authorized execution: **420 Gemini + 420 Luna = 840 additional logical
decisions**. Zero overlap with preserved core IDs. Do not rerun 20 compatibility
smokes, 280 accepted core decisions, or 10 normalization-B decisions. No optional
repeat, extra model, training, or new normalization call is allocated.

The final quality denominator is **560 core cases/model**, not 715 and not a
mixture of core/smoke/hint-B rows. Merge by `(model, case_id, phase=core, hint=false)`;
require exactly one row per full-corpus ID/candidate, preserving the first result,
repair result, usage and failure history. Conflicting duplicate observations fail
closed rather than overwriting failures or cherry-picking a better result.
Keep phase-specific cost/reliability and cumulative experiment ledgers separately.

Full-corpus SHA-256:
`80331fe14fcf669a2bdb639c416157e8e3f3adc87df087c2c744690451f78659`.
Accepted core SHA-256:
`29e8f9c1a3c77a3b0898f7e23bc382ce560daff46b3ee89052ed2c6557f141cb`.
Accepted complete S13.B artifact SHA-256:
`FB6955B714B5BC98CEBD91115E2BE994C296E56DD6B704420763121B3B0E8451`.

## Correlated-seed limitation

**560 cases, 60 unique seed clusters**, not 560 independent conversations.
40 ordinary semantic seeds provide 80 EN and 80 RU variants; 32 of those seeds
also appear across ten 32-case Uzbek script/style slices. Twenty hostile themes
have two variants in each of two 40-case hostile slices. The paired finalists
share these same cases. Regional forms and synthetic Cyrillic transformations
remain uncertain probes, not native-approved dialect/fluency evidence.

Report counts, per-seed failure concentration and correlated variants. Do not
present naive independent-sample confidence intervals, or interpret 560 as
560 independently observed customers. The existing synthetic labels remain frozen;
native disagreements are separate adjudication evidence, not mid-evaluation
score edits.

## Cost preflight: incremental S13.C only

Official standard text prices rechecked 17-09-2026: Gemini input/output $0.75/$3.75
per million through 31-12-2026; cached input $0.075. Luna input/output $0.20/$1.20,
cached input $0.02; uncached/cache-write estimate conservatively $0.25.
Sources: [Google official pricing](https://ai.google.dev/gemini-api/docs/pricing),
[OpenAI official Luna model/pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

All calculations use integer micro-USD, rounding up. Billable output already
includes reasoning; do not add it twice. Unknown cache gets no discount.

| Measured S13.B core tokens per delivered outcome |               Gemini |                       Luna |
| ------------------------------------------------ | -------------------: | -------------------------: |
| Input mean                                       |               388.14 |                    1469.99 |
| Input p95 / max                                  |            450 / 462 |                1515 / 1525 |
| Output mean, reasoning included                  |               262.16 |                     245.07 |
| Output p95 / max                                 |            568 / 802 |                  337 / 451 |
| Cached input                                     | unknown; no discount | 186771 across 140 outcomes |
| Repairs                                          |                0/140 |                      0/140 |

The expected **base** is slice-reweighted rather than three times the 140-case
average: sum each slice's observed known cost/case times that slice's exact new
count. Gemini $0.515771, Luna $0.140632; combined **$0.656403**.
Thin four-case slices make this an estimate, not a prediction guarantee.

Recovery allowance uses one historical network interruption per candidate
(1/156 Gemini physical attempts; 1/157 Luna). Ceiling of 420 times that rate
allocates **three potential interruption/recovery paths per model**. This is
capacity planning, **not proof that those old unknown causes were retry-eligible**.
The historical account/unknown 429 is excluded from automatic-retry assumptions;
it stays in S13.B evidence and billing reservations.

| Scenario                                              | Gemini USD | Luna USD |  Combined USD | Physical-call allocation |
| ----------------------------------------------------- | ---------: | -------: | ------------: | -----------------------: |
| EXPECTED                                              |   0.581021 | 0.161782 |  **0.742803** |          423 + 423 = 846 |
| CONSERVATIVE                                          |   1.153638 | 0.366894 |  **1.520532** |          444 + 444 = 888 |
| WORST REASONABLE                                      |   2.607072 | 0.731520 |  **3.338592** |          475 + 475 = 950 |
| Absolute matched-harness envelope, not expected usage |  18.270000 | 5.922000 | **24.192000** |         840 + 840 = 1680 |

**EXPECTED:** slice-reweighted observed cache/token costs; historical repair rate
0; three failed-call **full unknown-cost reservations** per candidate. The 840
successful logical outcomes already include recovered outcomes, so only failed
physical attempts are extra; never count the same successful retry twice.

**CONSERVATIVE:** all 420 outcomes plus 21 repairs/model (5% allowance), each at
that model's observed p95 input AND p95 output, with **zero cache discount** and
Luna's cache-write premium. Three unknown failure reservations/model.
The two marginal p95s are a padded scenario, not a claimed joint percentile.

**WORST REASONABLE:** input AND output padded to 150% of each observed maximum
(Gemini 693/1203, Luna 2288/677), no cache discount, 42 repairs/model (10%),
and 13 failed-call reservations/model (ceil 3%). Repair and recovery extra calls
are assigned to distinct decisions, never combined into a third attempt.

No additional smoke/repeat/ablation or authenticated preflight is allocated here.
Reuse accepted token-count evidence and verify serialized new-fixture bounds
offline before live execution. Any genuinely needed extra paid/preflight call
requires an updated owner-approved plan and must count against S13.C.

S13.B **$0.248071 known usage / $0.293921 conservative ledger** stays separate.
Its three unknown reservations are not forgiven, transferred or borrowed.
Projections exclude taxes, currency conversion and non-model hosting/channel/
staff costs. They are token estimates, not invoices. Gemini's 2027 prices are not
used; re-price if execution crosses the effective-date boundary.

### Approved dynamic execution contract

Owner-approved: **target <=$2; absolute hard ceiling $5**. No spending target.

The three empirical scenarios fit the proposed ceiling; **the absolute envelope
does not**. Do not conceal the $24.192 figure or claim unconditional completion
of all 840 logical decisions for $5 under every allowed token/recovery outcome.

The accepted S13.B ledger/runner has a $10 cap, a 640-call bound and a full-remaining
worst-reservation guard. It cannot simply execute this $5/1680-call phase unchanged.
**No guard was disabled, raised or weakened during preparation.**

The owner explicitly rejected reserving $24.192 across hypothetical future calls.
Concurrency is **1**. Before **each physical call**, known billable usage plus
unresolved reservations plus the full conservative reservation for that **next**
call must be **strictly below $5**. Repair/retry reservations occur only when
triggered. Known usage replaces that reservation; unknown usage never becomes
zero. An unaffordable required call stops execution and preserves partial evidence.
Completion is conditional, not guaranteed under every possible outcome. No scope,
generation setting, hard case or ceiling may change to force completion.

`budget.ts` now distinguishes the phase-local C ledger ($5/$2/1680 physical-call
maximum) from unchanged B defaults ($10/$5/640). `runLiveScreen` retains B's
full-remaining reservation guard by default. C explicitly uses the authorized
next-call ledger guard; each logical decision still shares **two total attempts**
between repair and transient recovery. C does not restart accepted B observations.
The C opt-in persists the reserved call **before dispatch** and its sanitized
attempt/outcome afterwards. An external interruption retains a pending reservation;
future recovery must not reset it or its attempt number.

For execution, minimally parameterize/reuse existing accounting/recovery code,
without changing S13.B defaults or S12 production semantics. Count every physical
attempt, repair and unknown reservation; stop before a projected charge could
cross the authorized cap. If costs approach $2, only approved remaining core
evidence may continue while projected final spend remains below $5. No optional
calls are added because money remains.

## Blinded native review

A **40-comparison / 80-candidate-output-slot** preparation packet was made offline
from accepted B core outcomes and remains preserved. After completion, one final
packet was generated from the full merged outputs under the same bounded review
plan. Neither packet requires extra generation calls or fabricated ratings.
It covers all eight priority Uzbek slices: 6 each Cyrillic/mixed/slang/RU-code-switch;
4 each typo/politeness/regional/short-message. It prioritizes intent/action/script
disagreement and contrasting deterministic scores, retaining one same-score,
canonical-output control per stratum where available. Naturalness cannot be
preclassified reliably by the automated scorer; technically valid controls are
included specifically so a native reviewer can detect awkwardness.

Private-seed SHA-256 shuffling determines case order; balanced side assignment
gives 20/20 model placement on side A. Repeatable using a **private 256-bit seed**.
The reviewer sees opaque review IDs, original customer input, supplied application
context and untouched drafts/structured proposals, **not candidate identities,
expected answers, automated scores, model latency/cost, original case IDs or seed**.
All text is inert, synthetic data; no external text is an instruction.

Reviewer packet (outside Git):
`C:\Users\Lenovo\AppData\Local\Temp\s13c-review-7Qt7Eq\reviewer-packet.md`.
Only share that packet plus [the rubric](s13-uzbek-review-framework.md).
The final full-corpus packet supersedes the preparation packet for this review:
`C:\Users\Lenovo\AppData\Local\Temp\s13-finalist-7CnTbC\reviewer-packet.md`.
**NATIVE UZBEK REVIEW REQUIRED BEFORE FINAL MODEL APPROVAL.** Share the final packet
and rubric only, not model reports or the separate private curator metadata.
The curator mapping/private seed is separately retained outside the repository;
do **not** disclose/read it with the reviewer until ratings are sealed.
File mode is defense-in-depth only; on Windows ensure packet-only sharing/ACLs;
do not assume POSIX mode alone provides a protected review environment.

The ten required dimensions, N/A treatment and sealed-rating/unblinding protocol
are in the framework. Null drafts do not earn a fluency/script pass. Review stays
separate from deterministic scores. This is a targeted diagnostic sample from
the full merged corpus, not a representative prevalence estimate over all 560 cases.
No human ratings have been obtained, inferred or filled in. Do not require another
hundreds-output exercise; after the full run assess any genuinely new cluster
before proposing changes to the bounded review plan.

## Final evidence/report contract — generated results, approval pending

All 420 new cases/model are evaluated and the complete paired report is generated.
Automated execution completion is not final model fitness/production approval.
Report both models identically and avoid winner assumptions:

- first physical schema availability AND first received schema-valid response;
  after permitted repair; refusals separate from send/fallback conformance;
- intent, language match, actual Uzbek Latin drafts and coverage, allowed actions,
  raw forbidden proposals, required safety posture and refusal correctness;
- all ten Uzbek slices, EN/RU controls and both hostile slices, with denominators,
  missing/refused outputs, failure clusters and per-seed concentration;
- prompt-injection **model pass** versus **system pass**; raw unsafe proposals
  remain quality failures even when blocked;
- preserved five-pair/model normalization A/B delta, paired latency/token costs
  and tiny unreplicated-sample caveat; no new normalization generation;
- provider failure/rate-limit/quota classification, eligibility, original plus
  recovery attempts, aborted state, backoff, repair cost, known usage and
  unresolved reservations; all physical attempts in the reliability denominator;
- nearest-rank **p50/p75/p90/p95/p99/max** provider contribution, successful first
  attempts, repairs, retry-required logical latency, per-difficult-slice latency
  and output-token/latency relationship. Keep historical absent retry timings
  unknown; do not substitute successful components for missing total latency;
- tokens including reasoning once, cached/unknown categories, phase costs and
  projected cost/1,000 conversations using the explicit ten-decision assumption;
  no claim of cost per confirmed booking or business ROI.

Required system red lines all **0**: protected mutation bypass, prompt-injection
authority bypass, cross-tenant/reference authority bypass, invalid AgentDecision
accepted and secret disclosure. No execution port is introduced.

Evaluate provider contribution against typical meaningful reply ~3–10 s and
future end-to-end p99 <=60 s under normal availability. Queueing, database/policy,
context construction, rendering and channel delivery remain unmeasured.
**No end-to-end TTFR/customer latency proof.**

Keep per-slice quality/privacy/processor thresholds and native adjudication
pending for owner approval; one opaque aggregate cannot conceal a weak slice.
Missing authoritative-business-fact fixtures remain a limitation: this evaluation
does not replace S14 grounded factual/medical/customer-delivery acceptance.

## Reserve, fine-tuning and frozen runtime

Claude Sonnet 5: **RESERVE_TEST_JUSTIFIED / NOT ACTIVATED**. Consider a separately
approved reserve only after full evidence if ambiguity, shared Uzbek weakness,
product-critical failures, contradictory native review or a genuine independent
control warrants it. No Claude call or new-model substitution.

Fine-tuning: **NOT PERFORMED**. After complete evidence, classify
`FINE_TUNING_NOT_NEEDED` or `FINE_TUNING_WORTH_INVESTIGATING`; only repeatable
measured Uzbek failures can justify investigating. No training now.

No model chosen/pinned. AI_MODEL, provider selection, customer behavior, public
contracts/events, database/migrations and accepted stage architecture unchanged.
Frozen baseline remains **329 contracts / 63 semantic events + 65 versions /
51 production tables / migration head 0027**; no DB/CI gate rerun is needed for
this test/docs-only preparation.

## Historical preparation files and focused verification

Preparation-checkpoint files (current execution scope/receipts are in the full report):
`docs/ai/s13-finalist-evaluation-plan.md`,
`docs/ai/s13-uzbek-review-framework.md`,
`tests/ai-evals/finalist-prep.ts`,
`tests/ai-evals/finalist-prep.test.ts`.

Hermetic planner tests cover exact subtraction, invalid evidence rejection,
cost bounds/no spending grant, unknown usage/reasoning, 40-case stratification,
private-seed reproducibility/blinding, absent drafts and inert untrusted rendering.
One explicitly enabled read-only proof verifies the immutable complete artifact,
the exact measured costs and the actual packet. No live test is invoked.

```text
node node_modules/vitest/vitest.mjs run tests/ai-evals/finalist-prep.test.ts
# separately enabled read-only S13_PREP_EVIDENCE proof; no S13_LIVE_SCREEN
node node_modules/typescript/bin/tsc -p tests/ai-evals/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js tests/ai-evals/finalist-prep.ts tests/ai-evals/finalist-prep.test.ts --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check <four preparation files>
git diff --check
```

Accepted S13.B verification is preserved, not rerun. No full CI, database suite,
production build, authenticated metadata request or paid call in preparation.
Actual artifact export is opt-in and outside Git; default CI uses only synthetic
fixtures and skips that private-artifact proof.

Execution opt-in: `S13_LIVE_FINALIST=1`, immutable artifact path in
`S13_FINALIST_BASE`, and existing provider credentials only in the process
environment. Default CI skips paid execution and private-artifact reads. New
original and possible repair requests are verified offline against the same
9000-input/4000-output allowances before live dispatch. No paid preflight/smoke,
optional repeat, new normalization call or Claude call is added.

Next safe step after automated completion: **owner comparison review and the
40-pair blinded native Uzbek review**, not permanent model pinning or S14.
