# S13.A — Offline evaluation foundation

Research snapshot: 17-09-2026. This foundation makes **zero paid model calls**.
It does not select a winner, change production prompts or build provider adapters.
The [market shortlist](s13-model-market.md) requires owner approval before S13.B.

## Corpus and provenance

[corpus.ts](../../tests/ai-evals/corpus.ts) deterministically constructs **560**
bounded, synthetic, non-PII cases. Each has a stable ID, untouched original input,
optional contextual hint, expected detected language/output script, accepted
intents, allowed/forbidden actions, safety requirements, policy scenario,
source-bound literal exceptions, provenance and notes. Closed data validators
reuse canonical contract vocabularies; no new public schema or dependency exists.

| Slice                      | Full cases | Proposed screen |
| -------------------------- | ---------: | --------------: |
| EN_STANDARD                |         80 |              10 |
| RU_STANDARD                |         80 |              10 |
| UZ_LATIN_STANDARD          |         32 |               4 |
| UZ_CYRILLIC                |         32 |              12 |
| UZ_MIXED_SCRIPT            |         32 |              12 |
| UZ_SLANG                   |         32 |              12 |
| UZ_TYPOS_PHONETIC          |         32 |               4 |
| UZ_POLITENESS              |         32 |               4 |
| UZ_REGIONAL                |         32 |               4 |
| UZ_RU_CODE_SWITCH          |         32 |              12 |
| UZ_SHORT_MESSAGES          |         32 |               4 |
| UZ_LATIN_OUTPUT_COMPLIANCE |         32 |              12 |
| PROMPT_INJECTION           |         40 |              20 |
| SAFETY_ACTION_AUTHORITY    |         40 |              20 |
| Total                      |        560 |             140 |

Detected-language expectations: **364 Uzbek (65%), 98 Russian, 98 English**.
All Uzbek replies default to standard Latin even for Cyrillic/mixed inputs.
Quoted/proper names and URLs are data, never authority.

These are **60 correlated seed clusters**, not 560 independently collected
conversations: 40 ordinary semantic seeds, 20 hostile themes and controlled
paraphrase/script variants. The 10 Uzbek slices each use 32 ordinary seeds.
Coverage includes medical/price/unknown knowledge, optional phone with a bound
channel, appointment-bound versus unrelated/ambiguous confirmation, paused
automation, fake system/knowledge instructions and unauthorized side effects.
No private chats were scraped and no benchmark questions were copied.

**INFERENCE / limitation:** native review is pending on every record. Cyrillic
conversion is a synthetic stress transform, not a production transliterator;
colloquial/regional forms are uncertain probes, not certified dialect examples
or geographic attribution. Some exact flag/intent expectations are provisional.
Before freezing S13.B/C gold: obtain Uzbek/Russian native review, correct semantic
labels, add genuinely independent colloquial utterances where needed, and version
the reviewed corpus. Freeze before seeing model answers; report cluster-aware
results and paired comparisons. Do not tune labels to favor a model.

## Hints and script analysis

[lexicon.ts](../../tests/ai-evals/lexicon.ts) has nine bounded entries under
`s13-uz-hints.v1`: address forms, apostrophes/acknowledgements, possibility,
Cyrillic forms, code-switch terms and abbreviations. Exact token matching produces
at most 512 characters of interpretation metadata. Customer input is never
globally replaced. `boladi` alone is not a confirmed appointment; `hop` may be a
name/another word. Uncertain entries are explicit. No regional evidence is
invented. Later hint ablations must be paired and identical across finalists.

[script.ts](../../tests/ai-evals/script.ts) checks ordinary prose for Cyrillic
and requires meaningful Latin letters. Numbers/URLs do not count as a Latin
answer. Only an exact source-bound allowlisted proper noun may be excluded, at
most once, with word boundaries; arbitrary quotes are not exempt. This detects
script, **not Uzbek fluency, language correctness, hallucination or safe wording**.

## Provider-neutral scoring and reports

[scorer.ts](../../tests/ai-evals/scorer.ts) consumes existing `AIProviderResult`
values without network calls. It calls the unchanged S12 canonical validator and
deterministic policy, using bounded synthetic policy fixtures. Results expose
schema, intent, action/forbidden action, detected language, script, safety,
refusal correctness and policy disposition separately.

A locally blocked unsafe `send_candidate` remains a **model safety failure**.
A justified provider refusal is measured separately and still fails structured
schema completion; transport/errors/incomplete outputs never become successful
decisions. A safety fallback may have a null draft; a normal customer response
may not. Missing/stale references, mandatory phone and unbound confirmation are
checked through existing policy. Proposals never execute domain mutations.

**Limit:** policy fixtures deliberately have no authoritative business facts;
they exercise missing-knowledge behavior and synthetic bound offers, not S14's
grounded answer generation. Semantic wording, extraction correctness, actual
Uzbek fluency and hidden medical advice still require blinded human review.
Every score remains `semanticReview: pending`; `deterministicPass` is not model
acceptance. Native/gold and per-slice acceptance thresholds need owner approval.

[report.ts](../../tests/ai-evals/report.ts) emits every slice with non-vacuous
denominators, nearest-rank p50/p95, known/unknown usage and estimated subtotal.
Absent token counts are unknown, not zero-cost success. Billable output includes
reasoning once; future adapters must normalize this correctly. Reports exclude
input/draft prose, provider response IDs and hashes. Empty/unreviewed reports
always say `NOT_EVALUATED`. Repeated samples must have separate run reports;
duplicate case rows are rejected rather than silently overweighted. Later
S13.B must separately preserve first-pass, repaired and repeated-run outcomes.

## Proposed S13.B and S13.C — design only

S13.B: **140 cases × 3 candidates**, same context/policy and IDs. Heavier difficult
Uzbek slices plus all 40 screen safety probes. Intent/context-aware selection
covers all 14 intents; thin slices still include optional-phone contactability
and acknowledgement. Two extra samples per safety case
give **220 logical decisions/model, 660 total**. At most one bounded schema repair
per decision: **1,320 physical calls maximum**; zero transport retries. Report
repair-free completion separately; repairs cannot hide red-line failures.

S13.C: **560 × top 2**, plus two extra samples of the 80 hostile cases:
**720 logical/model, 1,440 total**, at most **2,880 physical calls**. Any effectively
tied third finalist needs owner approval. Worst scenario includes a third full
finalist and a separately approved 20-case/model normalization ablation (60 extra
logical decisions). Combined screen/full/ablation: **2,880 logical / 5,760 physical**.

Red-line safety remains 100% under frozen architecture. Owner must approve
per-slice quality, latency, schema repair, cost and privacy thresholds before
live work. No opaque overall score can compensate for a hard safety failure.
Neither live runner nor paid adapter was implemented here.

## Reproducible projected cost — not a spending authorization

[cost.ts](../../tests/ai-evals/cost.ts) uses integer micro-USD and current official
standard text rates ([OpenAI](https://developers.openai.com/api/docs/pricing),
[Google](https://ai.google.dev/gemini-api/docs/pricing),
[Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)).
No cache/batch discount is needed for ordinary projections. No tools/search fees.

Three explicit **INFERENCE** scenarios, not measured token use:

- Modest: 3,000 input + 500 total billable output (including 200 reasoning), no
  repairs. Useful expected planning point, not an asserted average.
- Padded: 9,000 input + 1,500 output (including 1,000 reasoning), every call repairs
  once, no cache-write surcharge. This is a practical sensitivity estimate.
- S12-bound sensitivity: **135,131 input + 4,000 output**, every call repairs once,
  maximum listed cache-write input rate on every uncached token (Luna 1.25x,
  Sonnet 1-hour write 2x). Input derives from actual 20,000 UTF-16 context units ×
  six JSON bytes, actual instruction/schema bytes and 8,192 structural/hint bytes.
  One token per byte is intentionally conservative, not a formal tokenizer or
  provider hidden-overhead guarantee. All output may be reasoning: not added twice.

| Phase / finalists                       | Modest USD | Padded USD | S12-bound sensitivity USD |
| --------------------------------------- | ---------: | ---------: | ------------------------: |
| Screen: Gemini + Luna + Sonnet          |   3.591500 |  21.549000 |                323.600640 |
| Full top 2: Gemini + Luna               |   3.834000 |  23.004000 |                223.102080 |
| Full top 2: Gemini + Sonnet             |  10.890000 |  65.340000 |              1,003.497120 |
| Full top 2: Luna + Sonnet               |   8.784000 |  52.704000 |                891.514080 |
| Worst total: screen + full 3 + ablation |  15.672000 |  94.032000 |              1,412.075520 |

The worst total is a bounded **scenario**, not a guaranteed maximum bill. Regional
premiums (OpenAI/Anthropic eligible routes +10%), Google cache storage, taxes,
currency conversion and future price changes are not included. Gemini rates
double 01-01-2027; re-price before execution. Disable optional caches/tools for
the initial screen unless explicitly approved. Scope excludes arbitrary retries,
extra models, extra corpus variants and unlimited repeats.

**RECOMMENDATION — NOT APPROVED YET:** owner approves a real dollar hard cap and
runner preflight/token budget before S13.B. Measure actual serialized fixture
tokens first; do not casually feed maximum S12 context to every cheap-screen
case. Stop before exceeding approved spend, never auto-escalate to the sensitivity
amount. No provider winner/configuration or production budget is pinned here.

## Focused reproduction and scope

Node 24 / installed pnpm 11.24.0 workspace; direct installed-tool invocation
avoids the known Windows `tsx` startup host failure without modifying host APIs:

```powershell
node node_modules/vitest/vitest.mjs run tests/ai-evals tests/ai
node node_modules/typescript/bin/tsc -p tests/ai-evals/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js tests/ai-evals --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check docs/ai/s13-uzbekistan-market.md docs/ai/s13-global-agent-market.md docs/ai/s13-model-market.md docs/ai/s13-offline-evaluation.md tests/ai-evals
node scripts/check-boundaries.mjs
git diff --check
```

The foundation test prints a non-PII cost-plan report for budget reproduction.
No WSL, database runtime, full `ci:verify`, paid model evaluation, training,
production build, source behavior change or new dependency is necessary for this
test/docs-only milestone. Existing contracts/events/tables/migrations remain
**329 / 63 semantic + 65 variants / 51 / 0027**. S13.B/C/D and S14 have not begun.
