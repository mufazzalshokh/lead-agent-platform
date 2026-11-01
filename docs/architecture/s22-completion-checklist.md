# S22 current completion checklist

Checkpoint: **1 November 2026. S22 remains unaccepted; S23 is not started.**
This is the current navigation/status view, not a replacement for dated evidence
or a new acceptance policy. Criteria come from the
[S22a/S22b roadmap](11-adrs-roadmap-risks.md#codex-sized-implementation-roadmap),
[staging freeze](26-s22-staging-recovery-capacity.md) and the detailed
[evidence register](s22-acceptance-evidence.md#shortest-execution-sequence-and-evidence-limits).
Historical pending headings are superseded only by explicitly scoped later proof.

## Retain accepted proof — do not repeat it

- The original Instagram synthetic confirmed booking and its scoped
  [reservation/dispatch completion](s22-acceptance-evidence.md#2026-10-07--owner-supplied-dispatchaccounting-completion-pass)
  remain closed. Historical NULL costs remain unknown; this is not exact recovered
  historical billing and creates no new customer-message/provider allowance.
- The API error-ratio correction was
  [applied on 21 October](s22-monitoring-rollout-plan.md#consumed-apply-receipt-and-next-gate).
  Do not reopen the corrected source defect. Actual incident/delivery proof is
  still open; a configured policy is not a delivered alert.
- Default-off connection-fault code is
  [deployed and verified](s22-connection-fault-code-rollout-plan.md#approved-apply-and-independent-verification--1-november-2026):
  one API update, 88 configurations, zero remaining changes. Plan `41228923359`
  is consumed. API source is `7a4201c`; other runtimes remain `abc3071` with the
  exact immutable image/provenance bindings in that receipt. This is not rollback,
  a live fault, a backup restore or full S22a/S22b acceptance.
- Existing domain/security/PostgreSQL/eval results remain evidence within their
  source/scope. Map them to the final release before proposing any rerun. Do not
  repeat Auth0 onboarding, fixture publication, closed Claim/Resolve proof or
  model selection merely because another gate remains open.

## Open gates — no invented completion percentage

| Gate                                 | Current state                                       | Evidence needed to close it                                                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 — M2 customer channels            | Open                                                | Website Chat request → real staff offer → customer confirmation → persisted confirmed booking and recovery; real Telegram **Business** connection/eligible DM/same-DM reply, not standalone bot chat. Retain prior inbound/reply proof; no unapproved resend/reset.         |
| C2 — M3 connection fault and alert   | Preparation active; default-off prerequisite closed | [Offline guard/controller](s22-connection-fault-exercise-plan.md), separately authorized fixed profile/window, actual tagged transport failures, expiry/normal recovery and matching metric/incident/recipient proof. A profile or local fixture is not live evidence.      |
| C3 — M3 failures, rollback and drain | Open                                                | Actual compatible previous-digest rollback/return, interruption/shutdown handling, bounded worker/channel/provider failure, queue drain and no duplicate/lost protected effect. The connection probe cannot close these.                                                    |
| C4 — M3 isolated restore             | Open                                                | Separate restored target; schema/52-table/RLS, encryption, representative tenant/audit/Outbox integrity; measured RPO ≤5 minutes and RTO ≤60 minutes; reviewed cleanup. Configured PITR/backups are not restore proof.                                                      |
| C5 — M3 capacity and response clocks | Open                                                | Approved normal 10 tenants/~1 msg/s/15 min and burst 25/~5 msg/s/5 min, fake AI, bounded stress/noisy-tenant/fairness, queue/DB/resource metrics and meaningful-response percentiles. A few fast replies are not a capacity/SLO result.                                     |
| C6 — M2 product release matrix       | Open; reuse existing cases                          | Fill actual current-release P0 gaps: contact/consent, reject/decline/cancel/expiry/racing offers, permission/idempotency, EN/RU/UZ safety, keyboard/accessibility, and synthetic outcome/revenue/source-funnel reconciliation. Do not invent a real visit or revenue event. |
| C7 — M3/M4 security and cost         | Open; uninspected findings conditional              | Current-release scans and applicable rotation/revocation/operator/shared-instance-rate controls, bounded attributable costs and retained unknown-cost exceptions; no unresolved critical/high release finding or unowned exception. An alert is not a spending kill switch. |
| C8 — M4 final gate/promotion         | Not entered                                         | All preceding mandatory gates accounted for; one coherent final-tree CI/PostgreSQL/build/contracts/boundaries plus security/privacy review and policy-compliant promotion. S23 requires separate named go/no-go authority.                                                  |

## Execution control

M1 is the scoped original booking proof; M2 is customer/channel/P0 acceptance;
M3 is operational rehearsal; M4 is final verification/promotion. We have advanced
the owner-approved M3 prerequisite while M2 remains unfinished. Record that
sequencing honestly: operational preparation is not customer acceptance, and
neither M2 nor M3 may disappear from the final gate. This checklist does not
silently authorize another order change or early promotion.

Current work package: C2's offline exercise tooling. **Two of three tooling
substeps are implemented**: dedicated profile guard libraries and the bounded
browser controller with offline fixtures. The third is **default-off Terraform/
workflow wiring and its regression/full-CI verification**. These are engineering
substeps, not closed acceptance gates: **all eight groups above remain open**.
Real bindings, saved configuration plans,
activation, fault traffic and notification observation require their applicable
authority/readiness; do not collect a session or schedule a window while tooling
is incomplete. Keep one active work package with a finite closure criterion;
return to the remaining M2 matrix rather than letting operational preparation
replace it. Telegram Business may run last when externally constrained, as the
existing execution sequence permits.

For every gate, attach source/environment, exact finite observation, result and
remaining gap. A failed/ambiguous execution keeps its ID; investigate it instead
of blindly rerunning, replacing a session or inventing a percentage. New customer
tests must preserve consumed usage/history and need their own bounded authority.

Billing/WhatsApp/external calendars/reminders/new configurable booking policies
remain later scope, not new S22 blockers. The larger production capacity target
and placement/residency/on-call/legal/provider decisions belong to the existing
launch/S23 boundary; this small S22 profile does not prove them.
