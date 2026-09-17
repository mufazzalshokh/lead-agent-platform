# S13 — Final model selection evidence

Historical decision-evidence report: the owner's subsequent approval and exact
Commercial V1 pin are recorded in [S13.D](s13-production-model.md). The scores,
notes and publication-time conclusions below remain unchanged.

STATUS: **READY FOR OWNER DECISION**. Native preferences imported unchanged and
unblinded only after preservation, hashing and validation. Imported 17-09-2026.

**Recommendation: Google Gemini API, paid tier, `gemini-3.8-flash`, low thinking,
stateless JSON AgentDecision.v1. NOT APPROVED / NOT PINNED.**

This is the better evidenced finalist, not proof that either candidate satisfies
all production-quality, privacy or latency requirements. No overall aggregate is
used as a substitute for slice, safety, operational and commercial evidence.
No new model calls, Claude activation, fine-tuning, production configuration
change, main merge or S14 implementation occurred.

## Evidence and submission integrity

- Automated evidence: [560 cases per model](s13-finalist-evaluation-results.md),
  [unchanged full metrics](s13-finalist-evaluation-results.json).
- Human import: [40 preferences and verbatim notes](s13-native-uzbek-review-results.json).
- Source: `C:\Users\Lenovo\AppData\Local\Temp\s13-finalist-7CnTbC\s13-native-uzbek-review.md`.
  The supplied `s13-native-uzbek-review\.md` path contained an extra separator;
  the unique matching sibling Markdown file was used unchanged.
- Preserved byte-for-byte before unblinding:
  `C:\Users\Lenovo\AppData\Local\Temp\s13-native-sealed-2038b3c15ed548e8a008fe1135e32d0f\submission.md`.
- Submitted/preserved SHA-256:
  `7084FA222179DD4B7D83E678D783BDECFA5829F1079A028808FAE20C744544F0`.
- Historical blank packet SHA-256:
  `3A7024B958017A78D253ACCB26B0B737C7AD1031256C4490858DD1A24B1BA423`.
  The owner edited the original packet directly; its current hash now equals the
  completed submission. The historical hash remains a pre-review identity, not a
  claim that the original pathname still contains the blank packet.
- Existing private mapping SHA-256:
  `00DC68B82145AD556AC7DB995DF4D318676D7E53D1325204D3457EDB33222FE5`.
  Used after sealing and validating all preferences. The private seed and complete
  side-assignment mapping stay outside Git.
- Existing offline renderer reconstructed the historical packet from saved
  canonical proposals and the existing private seed. Its hash and mapping match
  exactly; stripping only preference lines gives identical submitted customer
  input, context, candidate prose and structured proposals. This rendered existing
  evidence in memory: no model output was regenerated and no file overwritten.
- Full automated aggregate byte SHA-256:
  `451B892F07510E82530993B9C37BBAA6A154B0112E7D11E49EA0F650ECA89669`.
  Strict 1120-core merge and report recomputation match the saved complete artifact.
  Automated scores, prompts, schema, normalization and settings were not changed.

All **40/40** IDs occur exactly once with one explicit choice. The owner entered
the selected token at the start of “Notes / uncertainty”; the untouched list of
options in the form was not treated as a completed answer. No blank preference,
foreign/duplicate ID or ambiguous selected token was accepted.

Numeric dimensions 1–9 were **not provided**: **0/80 output slots rated for each
dimension**. They remain missing/null, not 5, zero, tie, N/A or a passing score.
Reviewer alias and review date were not supplied and are not inferred from file
timestamps. Narrative comments are retained exactly; they are not invented
dimension scores or retroactive changes to automated gold labels.

## Native review — blinded and unblinded

| Blinded preference | Count |
| ------------------ | ----: |
| A wins             |    11 |
| B wins             |    18 |
| Ties               |     5 |
| Both bad           |     6 |
| Total              |    40 |

A/B identity changes between pairs; B's 18 wins do not identify a single model.

| After unblinding      | Count |
| --------------------- | ----: |
| Gemini 3.8 Flash wins |    20 |
| GPT-5.6 Luna wins     |     9 |
| Ties                  |     5 |
| Both bad              |     6 |

**Human preference winner: Gemini.** It wins 20 of 29 decisive comparisons
(68.97%), not 68.97% of all 40; 20/40 is 50%. The six “both bad” comparisons
(review-05, 07, 23, 25, 32, 35) remain negative results, not ties or excluded rows.

| Native slice      | Pairs | Gemini wins | Luna wins | Ties | Both bad |
| ----------------- | ----: | ----------: | --------: | ---: | -------: |
| Cyrillic          |     6 |           3 |         2 |    0 |        1 |
| Mixed script      |     6 |           3 |         2 |    0 |        1 |
| Slang             |     6 |           3 |         0 |    3 |        0 |
| Typos / phonetics |     4 |           3 |         0 |    0 |        1 |
| Politeness        |     4 |           2 |         1 |    1 |        0 |
| Regional          |     4 |           1 |         1 |    0 |        2 |
| RU/UZ code-switch |     6 |           4 |         1 |    1 |        0 |
| Short messages    |     4 |           1 |         2 |    0 |        1 |

Gemini leads in six sampled slices. Short-message preference favors Luna 2–1;
regional preference is 1–1 with two “both bad”. These 4–6-case strata cannot
establish representative preference rates, statistical superiority or a reason to
introduce multi-model routing. Standard Latin/output-compliance and EN/RU were not
independently human-rated in this eight-stratum packet.

### Native problems actually reported

- Naturalness/voice: review-02 (preferred Gemini) requests plural clinic voice,
  “bera olamiz?” rather than “bera olaman?”. Review-13 (preferred Luna) asks for
  less robotic clarification, e.g. “joylashuvni aniqlashtirib yubora olasizmi?”.
  These are explicit presentation criticisms, not numeric fluency measurements.
- Greetings: review-06 (preferred Luna) requests “Assalomu alaykum” instead of
  “Vaalaykum assalom”; review-16 (preferred Gemini) asks for alternative greetings.
  These are the reviewer's preferences, not a universal rule for Uzbek usage.
- Directness/business knowledge: reviews 01, 05, 06, 07 and 09 criticize
  unnecessary clarification/handoff and missing ready business answers. The
  repeated theme is authoritative knowledge coverage and a helpful booking-oriented
  flow, not demonstrated token-level translation failure.
- Slang/dialect misunderstandings: no explicit example was identified in the
  submitted notes. Slang preference is Gemini 3, Luna 0, ties 3; regional
  ambiguity/both-bad results remain. Missing specific notes do not prove absence
  of misunderstandings or certify the synthetic dialect fixtures.
- Cyrillic/mixed-script problems: preferences are 3–2 for Gemini in each stratum,
  with one both-bad each. Review-13's robotic clarification is a mixed-script
  presentation concern. No additional script/meaning error is fabricated.
- Awkward translations: no explicit mistranslated phrase was identified in the
  notes. Robotic phrasing and singular/plural voice are recorded, but cannot be
  converted into a measured literal-translation-error rate.
- Latin-output violations: not explicitly marked by the human. Automated evidence
  below still records Luna's 15 violations; missing human marks do not erase them.
- Invented facts/safety: no human “no invented facts” or safety dimension rating
  was entered. No zero-human-concern rate is claimed. Review-04 requests urgent
  help/first aid/booking; review-09 suggests assuming missing Sunday hours mean
  closed. These are preserved feedback, **not authorization** to offer unreviewed
  medical advice, invent hours, silently learn authoritative facts or bypass staff/
  customer confirmation. Such behavior still requires approved facts and policy.

The packet explicitly supplied **no authoritative service/price/hour/availability
facts**. Preferences asking for direct factual answers are important future grounded
product requirements, but cannot make an invented answer correct in these fixtures.
All notes and preferences remain untouched. Future S14 grounded acceptance is
separate; no rubric revision or re-scoring was performed here.

## Automated comparison — all 560 core cases per model

| Metric                                         | Gemini 3.8 Flash |     GPT-5.6 Luna |
| ---------------------------------------------- | ---------------: | ---------------: |
| First physical canonical-schema availability   |          557/560 |          555/560 |
| First received / after-repair canonical schema | 559/560 (99.82%) |   560/560 (100%) |
| Intent accuracy                                | 475/560 (84.82%) | 442/560 (78.93%) |
| Allowed raw action, frozen rubric              |          545/560 |          529/560 |
| Raw forbidden-action proposals                 |   14/560 (2.50%) |   31/560 (5.54%) |
| Language agreement                             |          559/560 |          558/560 |
| Actual Uzbek Latin output compliance           |   352/352 (100%) | 328/343 (95.63%) |
| Uzbek prose coverage, 364 expected-Uzbek cases |          352/364 |          343/364 |
| Required safety/posture                        |          312/560 |          210/560 |
| Expected send-versus-fallback conformance      |          392/560 |          436/560 |
| All frozen checks                              | 250/560 (44.64%) | 145/560 (25.89%) |
| Schema repairs                                 |                0 |                0 |

Gemini's retained provider refusal is schema-unavailable, not an invalid schema
accepted or a pass. Its intent/action/language/safety metrics have 559 measured
results; all-case denominators retain the missing case. Latin compliance measures
only existing Uzbek drafts, not missing prose, understanding or native naturalness.
Luna's script failures include 15 actual Uzbek Latin failures and 25 whole-script
failures in total; Gemini has one non-Uzbek whole-script failure.

### Every Uzbek automated slice

Each intent/safety denominator is 32. Latin uses passed/measured existing Uzbek
drafts. Raw proposals and all-check counts are shown Gemini / Luna.

| Slice                   | Gemini intent | Luna intent | Gemini safety | Luna safety | Gemini Latin | Luna Latin | Raw unsafe G/L | All checks G/L |
| ----------------------- | ------------: | ----------: | ------------: | ----------: | -----------: | ---------: | -------------: | -------------: |
| Latin standard          |         28/32 |       26/32 |         21/32 |       11/32 |        31/31 |      29/30 |          0 / 2 |         17 / 7 |
| Cyrillic                |         28/32 |       27/32 |         20/32 |       15/32 |        31/31 |      25/31 |          0 / 2 |         18 / 6 |
| Mixed script            |         28/32 |       25/32 |         21/32 |       14/32 |        32/32 |      30/31 |          0 / 2 |         18 / 9 |
| Slang                   |         26/32 |       27/32 |         18/32 |       12/32 |        32/32 |      30/30 |          0 / 0 |         14 / 9 |
| Typos / phonetics       |         26/32 |       26/32 |         18/32 |       11/32 |        31/31 |      31/32 |          0 / 2 |         15 / 8 |
| Politeness              |         23/32 |       22/32 |         21/32 |       13/32 |        31/31 |      32/32 |          1 / 2 |         12 / 7 |
| Regional                |         29/32 |       25/32 |         20/32 |       12/32 |        32/32 |      31/31 |          0 / 1 |         17 / 8 |
| RU/UZ code-switch       |         28/32 |       25/32 |         20/32 |       11/32 |        31/31 |      30/32 |          1 / 3 |         16 / 7 |
| Short messages          |         26/32 |       25/32 |         21/32 |       11/32 |        31/31 |      32/32 |          0 / 0 |         15 / 8 |
| Latin-output compliance |         25/32 |       26/32 |         21/32 |       16/32 |        32/32 |      27/31 |          0 / 0 |        16 / 10 |

Gemini's stronger safety/Latin profile is not universal dominance: Luna has slightly
higher slang intent (27–26), output-compliance-slice intent (26–25), and human
short-message preference. EN control intent is 66/80 vs 63/80; RU is 65/80 vs 63/80.
Weak politeness intent, regional/short-message uncertainty, unsafe proposals and
low complete-rubric rates remain relevant despite Gemini's human-review lead.

### Model quality versus deterministic system security

Prompt-injection all-check model pass: **Gemini 9/40; Luna 10/40**.
Deterministic injection system pass: **40/40 each**.

All recorded system red lines are **0 for both**: invalid decision accepted,
protected mutation bypass, reference-authority bypass, secret disclosure and
execution attempts. This is the bounded saved S12-policy/no-execution-port proof,
not newly verified full production customer delivery or medical safety.

Of Gemini's 14 gold-forbidden proposals, 11 reached policy fallback and 3 were
returned as proposals without execution. Of Luna's 31, 26 reached fallback and 5
remained unexecuted proposals. **Not every gold-forbidden proposal was rejected
by policy**; gold action expectations and application authorization are distinct.
No execution port existed. Unsafe raw proposals remain model-quality failures,
even where deterministic containment prevented effects. Fluent or preferred
prose does not make those actions safe.

## Latency and commercial fit

Nearest-rank percentiles, **seconds**. Received components include successful
recoveries/refusals; their short times are not full retry-required latency.
Current logical segments exclude earlier missing/resume segments. Unknown timings
are explicit and were not replaced with zero.

| Measurement                        | Model  | Known N |     p50 |     p75 |     p90 |     p95 |     p99 |     max | Unknown N |
| ---------------------------------- | ------ | ------: | ------: | ------: | ------: | ------: | ------: | ------: | --------: |
| Core first received component      | Gemini |     560 |   3.033 |   4.532 |   6.681 |   9.310 |  18.039 |  29.777 |         0 |
| Core un-retried component          | Gemini |     558 |   3.023 |   4.539 |   6.698 |   9.450 |  18.039 |  29.777 |         0 |
| All known physical attempts        | Gemini |     576 |   3.053 |   4.616 |   6.861 |   9.852 |  18.079 | 140.449 |         1 |
| All current logical segments       | Gemini |     575 |   3.098 |   4.679 |   6.893 |   9.879 |  18.114 | 148.558 |         0 |
| Known retry physical sum + backoff | Gemini |       1 | 145.964 | 145.964 | 145.964 | 145.964 | 145.964 | 145.964 |         1 |
| Core first received component      | Luna   |     560 |   3.738 |   4.426 |   5.433 |   6.492 |   9.970 |  35.917 |         0 |
| Core un-retried component          | Luna   |     555 |   3.738 |   4.423 |   5.433 |   6.549 |   9.970 |  35.917 |         0 |
| All known physical attempts        | Luna   |     578 |   3.741 |   4.431 |   5.449 |   6.572 |  10.558 |  35.917 |         3 |
| All current logical segments       | Luna   |     575 |   3.804 |   4.480 |   5.513 |   6.587 |  10.616 |  35.992 |         0 |
| Known retry physical sum + backoff | Luna   |       3 |  15.298 |  16.361 |  16.361 |  16.361 |  16.361 |  16.361 |         3 |

Typical meaningful-response target: **~3–10 seconds**. The medians (3.033s Gemini,
3.738s Luna) are compatible as model components, not proof of meaningful channel
response. Received components exceed 10s in 20/560 Gemini and 5/560 Luna cases.

Luna has better core received p95/p99 (6.492s/9.970s vs 9.310s/18.039s).
Gemini's saved timeout ran **140.449s** despite a configured 60s deadline; recovered
physical sum + backoff was **145.964s**, runner segment **148.558s**. Cause remains
undetermined (provider vs host/timer/await). Do not hide it behind the delivered
component maximum or claim the configured timer guarantees a 60-second wall clock.

Future **end-to-end p99 <=60s is NOT PROVEN for either**. Queueing, DB/policy,
grounded context, rendering, customer-visible wording and channel delivery are
unmeasured, and one timeout/retry path already exceeds 60s. A low empirical
component p99 does not certify a customer-facing SLO. This tail must remain a
production-latency risk requiring bounded end-to-end validation, not a justification
to increase timeouts or alter frozen production retry semantics now.

Per-slice and output-band six-percentile data, absent historical timings and all
eight recovery details remain in the unchanged automated report. Thin/correlated
bands cannot prove output tokens caused latency.

## Provider reliability

| Preserved all-phase metric                |           Gemini |             Luna |
| ----------------------------------------- | ---------------: | ---------------: |
| Physical attempts                         |              577 |              581 |
| Delivered outcome, valid refusal included | 575/577 (99.65%) | 575/581 (98.97%) |
| Canonical AgentDecision outcomes          |              574 |              575 |
| Provider errors                           |                1 |                5 |
| Timeouts                                  |                1 |                0 |
| Unclassified interruptions                |                0 |                1 |
| Retry recoveries / successful recoveries  |              2/2 |              6/6 |
| Provider refusals                         |                1 |                0 |

Combined delivered **1150/1158**, canonical **1149/1158**. All original failures
remain, including Luna's HTTP 429 (code/category unavailable), old network failure,
unknown interrupted decision, two DNS ENOTFOUND and one TCP connect timeout;
Gemini's old network failure and timeout remain. DNS/TCP/timeout attribution to
provider service is not established. Unknown 429 is not relabeled quota/throttle.
Eight retries succeeded, but did not erase costs, failures or model-quality errors.
Zero schema repair does not guarantee repair-free production. These laboratory
rates and sequential runs do not establish production account limits, uptime or SLO.

## Tokens, actual usage estimates and commercial projections

Provider-reported tokens, **core delivered observations**:

| Token evidence                           |                             Gemini |         Luna |
| ---------------------------------------- | ---------------------------------: | -----------: |
| Input                                    |                             214347 |       820667 |
| Billable output, reasoning included once |                             146828 |       133749 |
| Total                                    |                             361175 |       954416 |
| Cached input                             | Unknown for 560 calls; no discount | 743883 known |
| Reasoning subset                         |     34627 known; 412 unknown calls |  54102 known |

Failed-original token/cost values remain unknown. Unknown reasoning/cache values
are not zero. Core known usage estimate: **$0.711562 Gemini / $0.194860 Luna**;
core unresolved originals: **$0.043500 / $0.035250**. All-phase known estimate:
**$0.726562 / $0.199759**, unresolved **$0.043500 / $0.042300**.

Phase ledgers unchanged: B known **$0.248071**, conservative **$0.293921**
(including $0.035850 unresolved and $0.010000 preflight reserve); C known
**$0.678250**, unresolved **$0.049950**, conservative **$0.728200**; cumulative known
**$0.926321**, conservative **$1.022121**. Credit purchases are not model usage.
This import/review-analysis added **$0 paid usage** and no new evaluation calls.

Rechecked official standard rates on 17-09-2026:
Gemini input/cached/output **$0.75/$0.075/$3.75 per 1M** through 31-12-2026;
rates double 01-01-2027. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
Luna **$0.20/$0.02/$1.20 per 1M**.
[Official OpenAI Luna pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
The accepted conservative calculation retains the $0.25 Luna cache-write/uncached
assumption. No historical ledger was re-priced or unknown reservation forgiven.

| 1000 conversations, explicit 10 decisions each |     Gemini |      Luna |
| ---------------------------------------------- | ---------: | --------: |
| Observed known core average                    | $12.706465 | $3.479643 |
| Including observed unresolved core originals   | $13.483250 | $4.109108 |

These are projections from current synthetic tokens/cache/recovery mix, not
invoices or cost per booked appointment. Luna's measured cache benefit may not
recur in production; real grounded context may be larger. Channel/DB/hosting/staff,
tax, currency conversion, future pricing and customer outcomes are excluded.
Gemini's conservative premium is ~$9.37 per 1000 conversations under this assumption,
not proven ROI or an approved business-margin threshold.

The prior normalization A/B remains five pairs/model only: Gemini one improvement,
one regression, three unchanged; Luna one improvement, four unchanged. No new hint
calls or policy optimization. That tiny evidence does not justify default
normalization, input replacement or new task/model routing.

## Recommendation and exact evaluated configuration

Recommend **Google Gemini API paid-tier `gemini-3.8-flash`** for owner approval:

| Setting             | Recommended evidenced value                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Endpoint style      | Native stateless `generateContent`; no provider conversation state                                    |
| Thinking            | `generationConfig.thinkingConfig.thinkingLevel = "low"`                                               |
| Output              | `responseMimeType = "application/json"`; same canonical AgentDecision.v1 JSON-schema projection       |
| Output limit        | `maxOutputTokens = 4000`                                                                              |
| Local validation    | Existing canonical runtime schema plus existing deterministic S12 policy before execution             |
| Instructions        | Frozen `EVAL_INSTRUCTIONS` / bounded Uzbek-Latin requirement; no tuning in this analysis              |
| Input/normalization | Original authoritative customer text; locale hint; no optional normalization metadata by default      |
| Sampling            | Provider defaults as tested; no unmeasured temperature/top-p adjustment                               |
| Tools/state/search  | None; no broad external side-effect authority                                                         |
| Context             | Bounded, tenant-scoped, revisioned authoritative facts and state only; external text stays inert data |
| Multiple models     | Not introduced; no implicit Luna backup or language routing                                           |

Luna's measured comparison configuration is Responses API, `gpt-5.6-luna`,
`reasoning.effort="low"`, `store=false`, strict identical canonical schema and
`max_output_tokens=4000`. Neither candidate's configuration is applied to
production. The eval's 60000ms timeout is an evidence setting, **not** a proposed
release SLO or authorization to widen existing S12 runtime deadlines/budgets.
Generation configuration is exact; production end-to-end timeout/budget/retention
approval is still a separate required owner/security decision.

Measured reasons are joint, not a weighted aggregate: native preferences **20–9**,
six leading human slices, stronger Cyrillic Latin **31/31 vs 25/31**, RU-code-switch
human **4–1**, overall raw forbidden **14 vs 31**, stronger 10-slice safety counts,
better overall intent **475 vs 442**, and lower measured interruption count.
Counterweights retained: Luna cheaper, tighter delivered p95/p99, perfect delivered
canonical schema, slight wins in two automated intent slices and human short
messages; Gemini has a valid refusal and the major measured timeout tail.

**Neither is certified production-safe/ready** from this evidence. The frozen
“cheapest model that meets approved per-slice thresholds” rule is unchanged.
No missing threshold, processor/region/privacy approval or medical red line is
silently declared satisfied. Full-rubric weakness and omitted authoritative-fact
fixtures prevent interpreting “better finalist” as release approval.

## Claude reserve and fine-tuning decisions

**CLAUDE RESERVE TEST: JUSTIFIED. NOT ACTIVATED.**

Reason: retained raw unsafe proposals for both finalists, weak hostile/model safety
results and the unresolved Gemini operational tail provide a concrete reason for a
separately approved bounded independent safety/quality comparator. Native preference
supports Gemini but does not resolve those gaps. Claude is not presumed better,
not mandatory merely because money remains, and cannot fix missing business facts
or prove channel p99 by proxy. Scope/budget/processor controls need owner approval.
No Claude adapter activation or paid call happened.

**FINE_TUNING: NOT_NEEDED. NOT PERFORMED.**

Reason: one targeted preference-only review and correlated synthetic seeds do not
provide a reliable training dataset or quantified repeatable dialect-error class.
Notes mostly identify business-knowledge coverage/directness and presentation
preferences; absence of supplied facts is not repaired by training a model to guess.
Grounded context, deterministic paths and reviewed wording acceptance come first.
No fine-tuning, prompt repair or output regeneration was undertaken.

## Verification, security, scope and handoff

Current verification was read-only/offline: source/preserved submission hashes
equal; 40 unique explicit preferences parsed; missing dimensions retained; private
mapping read only after sealing/validation; saved-draft packet re-render hash and
mapping match; non-rating content exact; strict 1120 core rows; automated report
recomputation exact; human A/B and unblinded/per-slice totals reconcile.
Affected evidence/docs formatting, semantic JSON consistency, private-key/
credential hygiene and `git diff --check` are checked for this checkpoint.

Commands for the current evidence-only verification:

```text
Get-FileHash -Algorithm SHA256 -LiteralPath <submission>
Copy-Item -LiteralPath <submission> -Destination <unique preserved submission>
Get-FileHash -Algorithm SHA256 -LiteralPath <preserved submission>
node --import tsx --input-type=module
  read-only stdin collector: sealed preferences, saved-evidence merge/report,
  existing private-key packet/mapping verification and exact unchanged text
node --input-type=module
  read-only stdin audit: verbatim imported lines, reconciled counts/slices,
  unchanged automated metrics/hashes, private seed and credential exclusion
node node_modules/prettier/bin/prettier.cjs --check docs/ai/s13-native-uzbek-review-results.json docs/ai/s13-final-model-selection.md docs/ai/s13-uzbek-review-framework.md
git diff --check
```

No full CI, prior focused/model tests, typecheck, build, database suite, migrations
or audit repeated. No changed application/provider code, contracts, schema,
dependencies, retry behavior, AI_MODEL, authentication, worker, main or S14.
Private seed/full curator key and full raw submission/proposals remain outside Git;
only parsed preferences/verbatim notes, derived evidence and hashes are versioned.
Historical S13.C reports remain unchanged publication-time evidence; their pending
native-review statuses are superseded by this sealed import, not rewritten scores.

Files in this decision-evidence checkpoint:

- `docs/ai/s13-native-uzbek-review-results.json`
- `docs/ai/s13-final-model-selection.md`
- `docs/ai/s13-uzbek-review-framework.md` (status/link only; rubric unchanged)

Next safe step: **owner review and explicit model/configuration decision**,
including retained safety/latency/privacy limitations and whether to separately
authorize the justified reserve test. No production pin, main merge or S14 yet.

**S13 — FINAL MODEL SELECTION EVIDENCE — READY FOR OWNER DECISION**
