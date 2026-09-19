# S13.D — Owner-approved Commercial V1 model

The owner approved this exact production profile after the
[joint automated/native selection analysis](s13-final-model-selection.md).
Model approval is not approval to launch with customer data or a claim of clinical
safety. The historical evaluation reports, scores, failures and human notes are
unchanged. Promotion requires the authoritative GitHub Actions `pnpm ci:verify`
on the final reviewed tree, followed by a fast-forward of that exact commit.

## Pinned configuration

| Setting               | Approved value                                                                         |
| --------------------- | -------------------------------------------------------------------------------------- |
| Provider              | Google Gemini API; internal provider ID `gemini`                                       |
| Account tier          | Paid API tier, verified operationally on the credential's Google project               |
| Model                 | `gemini-3.8-flash` (no latest/preview alias or alternate-model routing)                |
| Thinking              | `generationConfig.thinkingConfig.thinkingLevel = "low"`                                |
| Output                | JSON MIME type and canonical AgentDecision.v1 schema projection; full local validation |
| Maximum output tokens | 4,000, including billable reasoning as reported by the provider                        |
| Request style         | Stateless native `generateContent`, original text, bounded tenant-scoped context       |
| Instructions          | `s13-uzbek-latin.v1`: byte-identical frozen evaluation instructions                    |
| Model profile         | `s13-commercial-v1.v1`                                                                 |
| Tools/provider state  | No generic tools, search, caches, interactions or provider-managed conversation        |
| Runtime deadline      | Existing 15,000ms default; existing validated timeout override/bounds unchanged        |
| Authority             | Existing deterministic application schema/policy; proposal-only, `applied:false`       |

[Google's model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
documents the stable model ID, structured outputs and low thinking. The adapter
uses the [native thinking request format](https://ai.google.dev/gemini-api/docs/generate-content/thinking).
Gemini's provider-native JSON configuration is used, not OpenAI-only `strict` or
`store` flags. Local canonical validation never becomes optional.

`COMMERCIAL_V1_AI_PROFILE` is immutable. `loadCommercialV1AIConfig` accepts only
`AI_PROVIDER=gemini` and `AI_MODEL=gemini-3.8-flash` if those overrides are present.
Absent overrides use the same pin. `GEMINI_API_KEY` comes only from runtime secret
configuration; a missing/empty key leaves the worker's proposal-only handler off.
Invalid keys/configurations fail without disclosing secret values. OpenAI keys
alone cannot select a backup or activate the worker's AI route.

The paid tier is an account/billing deployment prerequisite, not something a JSON
request can enforce. Operations must verify the correct paid project and approved
data controls before enabling customer processing. No key is copied into examples,
logs, documentation, model inputs or Git.

`createCommercialV1AIProvider` returns the existing application-owned `AIProvider`.
The worker composes it into unchanged orchestration/policy. The Gemini adapter
defaults to low thinking, rejects a different reported model, discards hidden
thoughts and preserves bounded I/O, redirect denial, sanitized failures and zero
production transport retries. The frozen evaluated language instruction is copied
unchanged; tests compare it to the evaluation fixture. No normalization A/B option,
new sampling setting or language/model routing is enabled.

AI persistence records the selected provider/model/profile/prompt in existing
columns and allocates attempts by the selected provider, rather than mislabeling
Gemini as OpenAI. Existing OpenAI callers keep their S12 provenance defaults.
No schema, migration, contract, tenant boundary or retry policy changes.

## Decision and accepted tradeoffs

Selection combines slice evidence rather than choosing from one aggregate:
Gemini intent accuracy **475/560 vs 442/560**, native decisive preference **20–9**,
actual Uzbek Latin outputs **352/352 vs 328/343**, and raw forbidden proposals
**14/560 vs 31/560**. Cyrillic, mixed-script, slang/phonetic and RU/UZ findings remain
in the joint report; neither result certifies flawless business/medical wording.
The owner accepts Gemini's higher API cost and slower delivered p95/p99
**9.310/18.039s vs 6.492/9.970s**, plus documented timeout/network evidence.

The **~3–10s meaningful-response target** and future **end-to-end p99 ≤60s** remain
commercial targets, not measured channel TTFR guarantees. The evaluation timeout
tail remains operational evidence; the evaluated 60-second timeout does not widen
the production deadline. Production transport retries, budgets, launch data
controls, provider terms/region/retention and end-to-end latency validation are not
silently approved by a model pin. Unknown usage/cost remains unknown, not zero.
S20 prices new complete physical attempts against the effective versioned catalog;
existing `not-priced.v1` persistence is not replaced by fabricated billing.
The 560 cases still derive from 60 correlated seed clusters; the native 40-pair
packet is diagnostic, not a representative population sample.

## Non-default infrastructure and reserves

- Luna/OpenAI remains publicly supported through `createOpenAIProvider` and
  `loadOpenAIHarnessConfig`, with stateless Responses `store:false`, strict schema,
  and its existing bounds. It is **not** a worker fallback or language router.
- **Claude reserve: NOT ACTIVATED.** Claude Sonnet 5 remains a future reserve only
  when measured production evidence creates a specific need and the owner authorizes it.
- **Fine-tuning: NOT_NEEDED.** Reconsider only from measured production failure
  clusters, with separate approval; no training is performed here.

## Regression and acceptance gate

Deterministic affected checks cover the immutable profile, invalid/alternate
provider/model denial, absent-key behavior, exact normal/repair request shape,
byte-identical language instructions, schema, low thinking, token ceiling, no
provider tools/state, different-model rejection and no automatic provider fallback.
Existing OpenAI, Gemini, policy/orchestrator/worker tests remain offline. PostgreSQL
regression verifies actual Gemini provider/profile/prompt provenance and two-attempt
schema repair with atomic audit/Outbox and no protected action execution.

Run affected tests, source typechecks, touched-package builds, lint/format,
boundaries and diff review first. The existing S13 pull request then runs the
authoritative Ubuntu GitHub Actions `pnpm ci:verify`, including isolated real
PostgreSQL suites and all builds. Dependency/security/privacy/secret review must
pass before promotion. Check the PR merge tree equals the reviewed head tree,
fast-forward main to the exact verified head (no squash/rebase/force), verify
remote equality/clean tree, and remove only the merged S13 review branch.

The next roadmap stage after accepted promotion is
**S14 — GROUNDED FAQ / PRICING RESPONSE**. S14 is not implemented by this checkpoint.
