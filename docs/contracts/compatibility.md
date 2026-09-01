# Public contract compatibility and drift control

Stage 2 publishes one runtime JSON Schema source of truth from
`packages/contracts`. The reviewed baseline is
`packages/contracts/snapshots/public-contracts.v1.json`; it inventories 207
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

`lead.reopened` remains one semantic event name. Its deployed V1 envelope/payload
schema identities, representations, and V1 map entries remain unchanged and
preserve historical V1 wire validation behavior.

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

## Conversation automation-mode provenance freeze

`conversation.automation_mode_changed` is an additive V1 semantic event with
independent `ConversationAutomationModeChangedDomainEvent.v1` and
`ConversationAutomationModeChangedDomainEventPayload.v1` identities. Its closed
payload accepts exactly:

- `awaiting_staff`, `paused -> staff`, and the canonical Handoff ID whose
  assignment/start began human response ownership; or
- `awaiting_staff`, `staff -> paused`, and the canonical requested successor
  Handoff ID that replaced prior active staff ownership.

Same-mode transitions, AI-mode variants, other Conversation statuses, missing or
malformed Handoff IDs, and unknown fields are rejected. The Handoff ID is
provenance, never authorization. Existing event envelope/payload identities and
wire representations—including `conversation.status_changed`—remain unchanged.
The closed event-name vocabulary and root DomainEvent union intentionally gained
this discriminant as the approved registry consequence. At that blocker
resolution the semantic event inventory became 62. Under the conservative
same-ID policy, its snapshot comparison reported those two registry expansions
as `version-requiring`, while the independently identified new envelope and
payload were `additive`. It did not change any existing individual event schema.

## Conversation active-Handoff provenance freeze

`conversation.active_handoff_changed` is an additive V1 semantic event with
independent `ConversationActiveHandoffChangedDomainEvent.v1` and
`ConversationActiveHandoffChangedDomainEventPayload.v1` identities. Its closed
payload accepts only `awaiting_staff + paused` requested-successor replacement,
with canonical distinct `previous_handoff_id` and `handoff_id` values and literal
`reason: successor_handoff`. Missing, malformed, or equal Handoff IDs, other
statuses/modes/reasons, unknown fields, and tenant/authorization smuggling are
rejected. The Handoff IDs are provenance and never authority.

This event does not change `conversation.status_changed` or
`conversation.automation_mode_changed`. Staff-owned successor replacement still
uses only `conversation.automation_mode_changed` for `staff -> paused`.
Requested-to-requested replacement uses only
`conversation.active_handoff_changed`; the atomic workflow order is the current
Handoff terminal event, successor `handoff.requested`, then the Conversation
reference event. No active-Handoff mutation may rely on transition history alone.

The semantic event inventory is now 63. The new envelope and payload are
additive; the closed event-name vocabulary and root DomainEvent union have the
necessary intentional same-ID registry expansions. No prior individual event
schema identity, version, or meaning changes.

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
| Domain events       | 63 semantic event types; 64 versioned event envelopes and 64 payloads; event/aggregate vocabularies and derived event types | `domain-events.test.ts` plus schema-ID/version-registry/union/catalog audits |
| Channels            | Channel vocabularies, bounded identifiers, inbound/outbound unions, capabilities, and derived types                         | `channel-contracts.test.ts` plus security/union/catalog audits               |
| AgentDecision       | Intent/action vocabularies, facts, claims, message, safety, and `AgentDecisionV1`                                           | `agent-decision-contract.test.ts` plus authority/vocabulary/catalog audits   |
| Compatibility/drift | Deterministic 207-schema snapshot and conservative compatibility classifier                                                 | `contract-compatibility.test.ts`, `contracts:check`, and `ci:verify`         |

This mapping covers the accepted Stage 0 requirements assigned to Stage 2.
Authentication, domain behavior, persistence, provider projection, and live
model evaluation remain owned by their later approved stages.
