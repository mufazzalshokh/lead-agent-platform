# Public contract compatibility and drift control

Stage 2 publishes one runtime JSON Schema source of truth from
`packages/contracts`. The reviewed baseline is
`packages/contracts/snapshots/public-contracts.v1.json`; it inventories 203
schemas across shared primitives, API contracts, domain events, channel
contracts, and the AgentDecision contract.

## Commands

- `pnpm contracts:check` rebuilds the catalog deterministically and fails when
  it differs byte-for-byte from the reviewed snapshot. This command runs in
  `pnpm ci:verify`.
- `pnpm contracts:snapshot` deliberately rewrites the snapshot. Run it only
  after the contract change and compatibility impact have been reviewed.

The generator sorts catalog entries and every JSON object key. Array order is
preserved because it can define union, enum, and required-member semantics.
Every public schema must have a unique canonical `$id` ending in `.vN`.
Schemas that carry `schema_id` or `schema_version` literals must agree with
their root identity.

## Compatibility policy

- **Additive:** a new, independently named and versioned contract. It must not
  change an existing contract's meaning.
- **Breaking:** removal of an existing public contract. Renames appear as a
  removal plus an addition and therefore remain breaking for existing
  consumers.
- **Version-requiring:** any content change under an existing public export or
  any schema identity/version change. This conservative rule is intentional:
  many V1 objects reject unknown properties, and the same schema may be used at
  input, output, persistence, or event boundaries where direction-specific
  compatibility differs.

Field removal or rename, requiredness, type, enum/discriminant, bound, and
schema identity/version changes are covered by deterministic compatibility
fixtures. A snapshot update records intent; it does not make a breaking change
safe. A version-requiring change still needs the API/event versioning decision
and migration plan required by the architecture.

## `lead.reopened` V1-to-V2 migration freeze

`lead.reopened` remains one semantic event name, so the accepted semantic event
inventory remains 61. Its deployed V1 envelope/payload schema identities and
representations, V1 map entries, and `DomainEventSchema.v1` remain unchanged
and preserve historical V1 wire validation behavior.

V2 is an additive, independently identified envelope/payload pair with the same
`event_type` and `schema_version: "2"`. Its closed payload accepts exactly one
of:

- `disqualified -> engaged` with `reason_code`; or
- `booking_requested -> qualified` with canonical `appointment_request_id` and
  `reason_code`.

The version-aware event and payload registries expose V1 and V2 under
`lead.reopened`; every other semantic event currently exposes V1 only.
Consumers dispatch using `event_type` plus `schema_version` and verify the
matching `schema_id`. Rollout is consumers-first. After the Stage 3 producer is
implemented, new lead-reopen events use V2 only: producers do not dual-emit,
rewrite history, or reinterpret a structurally valid legacy V1 payload as V2
domain authority. V1 retention/read support is not removed by this migration.

## Audit boundaries

The test suite locks the root runtime export surface, catalog completeness,
schema-ID uniqueness, embedded identity consistency, bounded JSON wire values,
closed objects, action-vocabulary alignment, domain-event union coverage, and
the absence of duplicate public DTO declarations outside `packages/contracts`.

Security-sensitive provenance remains explicit:

- inbound channel events intentionally contain no `organization_id`; trusted
  server-side channel resolution establishes tenant context;
- domain events and outbound message intents may carry `organization_id` as
  provenance, never as authentication or authorization evidence;
- AgentDecision contains no tenant authority, secret, raw provider payload,
  chain-of-thought, prompt, or generic tool-execution field;
- customer text, generated draft text, identifiers, timestamps, and other
  necessary data-bearing fields remain bounded and must still be handled under
  the privacy and logging rules in the architecture.

Provider-specific response-format projection belongs to Stage 12. Live model
compatibility and multilingual evaluation belong to Stage 13. Neither is part
of this Stage 2 drift gate.

## Stage 0 to Stage 2 traceability

| Stage 2 area        | Canonical runtime schemas and derived types                                                                                 | Verification                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Shared primitives   | IDs, UTC timestamp, locale, money, actor, and version schemas/types                                                         | `shared-primitives.test.ts` plus catalog identity/bounds audits              |
| API contracts       | Problem/error, validation issue, pagination, metadata, and envelope factories                                               | `api-contracts.test.ts` plus catalog/export audits                           |
| Domain events       | 61 semantic event types; 62 versioned event envelopes and 62 payloads; event/aggregate vocabularies and derived event types | `domain-events.test.ts` plus schema-ID/version-registry/union/catalog audits |
| Channels            | Channel vocabularies, bounded identifiers, inbound/outbound unions, capabilities, and derived types                         | `channel-contracts.test.ts` plus security/union/catalog audits               |
| AgentDecision       | Intent/action vocabularies, facts, claims, message, safety, and `AgentDecisionV1`                                           | `agent-decision-contract.test.ts` plus authority/vocabulary/catalog audits   |
| Compatibility/drift | Deterministic 203-schema snapshot and conservative compatibility classifier                                                 | `contract-compatibility.test.ts`, `contracts:check`, and `ci:verify`         |

This mapping covers the accepted Stage 0 requirements assigned to Stage 2.
Authentication, domain behavior, persistence, provider projection, and live
model evaluation remain owned by their later approved stages.
