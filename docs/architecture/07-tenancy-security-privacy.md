# 07. Multi-Tenancy, Security, and Privacy

Status: **Stage 0 normative specification**
Scope: tenant isolation, authorization, initial threat model, security controls,
and privacy/data lifecycle for V1.

## Security and privacy invariants

1. A request has no tenant authority until server-side authentication/routing
   resolves an organization and authorization confirms the principal's scope.
2. Every tenant-owned row carries `organization_id`; repositories scope every
   operation explicitly and PostgreSQL forced row-level security (RLS) supplies
   a second boundary.
3. An identifier, widget key, origin, route parameter, JWT claim, webhook field,
   model output, or job payload alone is never proof of tenant access.
4. Tenant and location permission checks happen before resource lookup results
   are disclosed. Unauthorized and absent tenant resources have the same public
   `404` behavior where enumeration is a risk.
5. Customer/knowledge text and model output are untrusted data. They cannot
   alter policy, obtain a tool, or execute a protected action.
6. Secrets are stored in a secrets manager or encrypted credential store,
   redacted from all reads/logs, rotated, and scoped to one integration purpose.
7. Privacy data is collected for defined purposes, retained for an explicit
   period, and exportable/deletable through authenticated, audited workflows.
8. Healthcare use remains administrative: service information, qualification,
   scheduling requests, and human routing. No autonomous diagnosis, treatment
   recommendation, emergency triage claim, or clinical record system behavior.

## Tenant model

`Organization` is the tenant boundary. A human `user` may have independent
`membership` records in several organizations. Tenant-owned aggregates include
locations, services/prices/FAQs/policies, channel connections, contacts, leads,
conversations/messages, appointment requests, handoffs, notifications, AI runs,
consents, analytics, operational receipts/jobs, and audit events.

### Tenant resolution by entry point

| Entry point | Untrusted selector | Server-side authority |
|---|---|---|
| Staff/private API | `X-Organization-Context`, URL/resource IDs | Authenticated user ID plus active membership loaded from the database; role and optional location restriction become the request authorization context. |
| Website widget bootstrap | Publishable widget key, browser `Origin`, page URL | Active widget `channel_connection` resolved by a random public key, configured domain allowlist, and server-issued short-lived widget session. Page URL/body organization fields have no authority. |
| Existing widget session | Widget token and resource IDs | Verified token audience/expiry/JTI binds immutable organization, channel connection, origin, session/conversation and scopes; database state is rechecked. |
| Telegram webhook | Opaque connection route key and payload account/chat IDs | Valid configured webhook secret/signature plus matching active bot/account connection; organization comes only from that connection. |
| Future channel webhook | Opaque route key and provider payload | Adapter-specific raw-body signature/timestamp verification and expected provider account mapping. |
| Worker | `organization_id` in a durable job/outbox row | Job is created inside a tenant-resolved transaction; worker loads it through a restricted operational path, then establishes a fresh tenant DB context and revalidates referenced ownership. |
| Platform operation | Support target organization | Separate platform identity and time-bound support grant; never a tenant membership or an unscoped default. |

Resolution precedes domain deserialization where practical. Public ingress has a
minimal routing repository backed by an exact-key, fixed-search-path
`SECURITY DEFINER` function over `inbound_routes`; the ingress/runtime roles have
no direct table or scan access. It returns only the active organization/
connection identifiers needed to establish tenant context. Credential material
is then read through the tenant-scoped connection path.

Forced RLS remains enabled on `inbound_routes`. The resolver function is owned
by a dedicated `NOLOGIN` definer role with `BYPASSRLS` and SELECT only on that
table; it has no other tenant-table privileges. Runtime/ingress receives only
function `EXECUTE`, is `NOBYPASSRLS`, and cannot assume the definer role. This is
a contained database capability, not a generic application bypass.

### Membership and location scope

Tenant roles are `owner`, `admin`, `staff`, and `analyst`. A membership also has
`status` and a location scope:

```text
location_scope = all | restricted
membership_locations = set<location_id> when restricted
```

An empty restricted set grants no location access. Owners normally require
`all`; changes to role/location scope are high-risk audit events. Organization-
wide objects (membership, organization policy, integrations) require the
corresponding tenant permission and are not made accessible by a location grant.
For location-owned operational objects, policy checks both role permission and
the object's location. Objects whose location is not yet known (for example an
unqualified inbound lead) are visible only under a documented organization-wide
queue permission, not accidentally to every restricted staff member.

Baseline permissions:

| Capability | owner | admin | staff | analyst |
|---|:---:|:---:|:---:|:---:|
| Organization ownership/lifecycle | yes | no | no | no |
| Manage members | yes | yes, except ownership transfer/final owner | no | no |
| Configure locations/services/prices/FAQ/policy | yes | yes | no | read public configuration only |
| Configure/rotate integrations | yes | yes with step-up | no | no |
| Read/reply to in-scope conversations | yes | yes | yes | no message/contact body |
| Read/update in-scope leads and handoffs | yes | yes | yes | aggregate only |
| Accept/reject/cancel in-scope appointment request | yes | yes | yes | no |
| Record `staff_attested_external` customer confirmation | yes | yes | yes, in-scope and recent auth | no |
| Record/correct in-scope attendance and add/reverse revenue attribution | yes | yes | yes | no |
| View aggregate analytics | yes | yes | limited as configured | yes |
| Read audit/security events | yes | yes | own operational actions only | no |
| Request productized tenant export/deletion (P1 when enabled) | yes | no by default | no | no |

Permissions are server-side named capabilities, not hard-coded role comparisons
scattered through handlers. Deny is the default. The current user may not approve
their own elevation or remove the final owner.

## Isolation architecture

Isolation has mutually reinforcing layers. Passing one layer never permits
skipping another.

### 1. Application context

- Authentication/routing creates an immutable `TenantContext` containing
  `organization_id`, principal/actor type and ID, membership ID/role/location
  scope where applicable, request ID, and permission set.
- `TenantContext` is passed explicitly through application services. It is never
  a mutable process global, singleton, or inherited from a previous pooled
  request. Its trusted Organization ID is passed to
  `withTenantTransaction(organizationId, callback)`.
- The wrapper begins an explicit transaction, establishes transaction-local
  tenant context before any tenant query, and exposes only a
  `TenantDbSession`/`TenantTransaction` bound to that Organization. Tenant
  repositories are created from that session, not the raw pool/base database.
- Repository methods do not accept a second Organization ID. They include the
  session's `organization_id` in every SELECT/INSERT/UPDATE/DELETE predicate;
  find-by-ID APIs are actually find-by-bound-tenant-and-ID.
- Domain objects do not accept a caller-supplied `organization_id` mutation. New
  rows obtain it from the trusted context/parent aggregate.
- Batch, analytics, search, cache, object-store, rate-limit, and lock keys begin
  with a trusted tenant namespace. Exports and signed object URLs are scoped to
  one organization and requesting actor.
- Job/outbox consumers process one organization per unit of work and create a
  new database transaction/context for each item. Mixed-tenant batches are
  prohibited unless an audited platform-only aggregation path explicitly
  anonymizes output.

### 2. Relational integrity

- Every tenant-owned table has non-null `organization_id` referencing
  `organizations(id)`. UUIDv7 IDs remain globally hard to guess but do not
  substitute for scoping.
- Tenant tables expose a unique `(organization_id, id)` key. Child relations use
  composite foreign keys such as `(organization_id, conversation_id)` to the
  parent's `(organization_id, id)`, preventing a child in tenant A from pointing
  at a parent in tenant B even if application code is wrong.
- Tenant-relative uniqueness starts with `organization_id`, for example
  `(organization_id, normalized_phone_hash)` where appropriate. Global
  uniqueness is reserved for true global identity/routing keys.
- Cross-aggregate transaction code rechecks organization on every referenced
  membership, location, service, contact, conversation, and appointment.
- Deletion and cascading rules cannot traverse an unscoped foreign key.

### 3. PostgreSQL RLS defense in depth

All tenant-owned tables enable and force RLS:

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_conversations ON conversations
  USING (organization_id = app.current_organization_id())
  WITH CHECK (organization_id = app.current_organization_id());
```

The exact migration helper generates equivalent policies consistently for every
tenant table. The authoritative 47-table classification is in
`04-data-model.md` Section 2.4. Requirements:

- The migration/owner role owns schema objects and applies reviewed migrations;
  application processes never use it. The application runtime role is not a
  table owner, is `NOSUPERUSER NOBYPASSRLS`, cannot create roles/databases or
  schema objects, and receives only minimum schema/table/function privileges.
- Each tenant operation starts an explicit transaction and uses safely bound
  `set_config('app.organization_id', value, true)` (plus validated principal and
  request context) before any tenant query. The local flag is mandatory; no
  connection/session-persistent tenant state is permitted.
- The canonical `app.current_organization_id()` helper is `SECURITY INVOKER`,
  has a fixed safe `search_path`, returns a canonical UUID, and cannot bypass
  policy. Missing context returns no rows/fails insertion; invalid context
  aborts the transaction. Both fail closed.
- Commit and rollback discard context. Nested operations may reuse the session
  only for the same Organization; any attempted tenant switch fails before SQL.
  Pool tests reuse connections after commit and rollback to prove no leakage.
- INSERT policies use `WITH CHECK`; update/delete policies use both visibility
  and check behavior. Tests exercise every operation, not SELECT alone.
- Elevated maintenance, migrations, backup, and privacy purge use separate
  credentials and code paths, never the request runtime role. Their use is
  scheduled, monitored, and audited.
- Intentionally global/platform data is limited to `users` and
  `platform_audit_events`; `organizations` is the tenant root and uses
  `organizations.id = app.current_organization_id()`. Tenant repositories cannot
  scan either global table. `users` is available only through a restricted
  identity/auth path, and `platform_audit_events` only through its separately
  audited platform path.
- No `app.is_admin`, `app.is_platform`, `app.bypass_rls`, or similar generic
  runtime bypass setting exists. Future cross-tenant worker discovery also uses
  no generic `BYPASSRLS`; a narrow reviewed claim mechanism may return minimum
  references, after which business processing uses a fresh tenant transaction.
- Supported locales are enforced by schema contracts and `CHECK` constraints
  rather than a locale table. Migration-tool and pg-boss internal metadata are
  infrastructure-owned, are not queried through tenant repositories, and must
  contain no customer payload. Application `outbox_events` remain tenant-owned
  and forced-RLS; only their minimal due-work references may be claimed through
  a later-approved narrow worker boundary. `memberships` and routing maps are
  accessed through narrowly authorized policies/repositories rather than a broad
  RLS bypass.

RLS isolates organizations. Fine-grained role and location authorization stays
in application policy and may be reinforced by additional database policies only
after their correctness and operational impact are tested.

### 3.1 Frozen S5 repository and write contract

- Tenant repository instances live only for one tenant transaction and cannot
  expose the underlying pooled connection.
- Resource lookup qualifies both tenant and resource ID. Cross-tenant and absent
  identifiers produce the same not-found result.
- Versioned mutable writes use compare-and-swap on tenant + resource ID +
  expected version and advance to the exact domain-produced next version. A
  same-tenant probe may distinguish not found from version conflict internally;
  it never reveals that another tenant owns the supplied ID.
- Structural/domain conflict is distinct from not found and version conflict.
  Repositories do not invent transitions or silently retry after concurrency
  conflict; only an explicitly safe idempotency/application boundary retries.
- Aggregate mutation, history/transition children, required audit evidence, and
  outbox insertion commit in the same transaction. Any failure rolls back the
  entire business mutation, including cross-machine workflows.
- Bounded polymorphic references are validated by their writer against the
  target loaded through the same tenant session. RLS protects the referencing
  row but cannot establish ownership of an arbitrary target UUID.

### 4. Derived systems and caches

- Redis/cache keys, if introduced, use environment + organization + resource +
  version; cached values never trust a caller-selected organization namespace.
- Metrics avoid customer-level labels. Traces/logs use access-controlled
  organization IDs and correlation IDs, not names, phones, email, or message
  text.
- Search indexes/materialized analytics retain `organization_id` and apply the
  same scope before returning rows. Aggregate platform analytics are built from
  de-identified facts, not by granting tenant handlers cross-tenant reads.
- Object paths are random and organization-prefixed. Downloads require a fresh
  authorization check before a short-lived signed URL is issued.

### Cross-tenant test gate

For each tenant-owned repository and route, tests create organization A and B
with deliberately similar data and attempt access using IDs, foreign keys,
cursors, idempotency keys, cache keys, exports, job IDs, and attachment paths
from the other tenant. Required suites include:

- role and restricted-location matrix tests;
- RLS tests under the actual non-owner runtime role for SELECT/INSERT/UPDATE/
  DELETE and missing tenant settings;
- composite-FK attempts linking rows across organizations;
- staff URL/header/body IDOR, widget token swapping, webhook connection/account
  mismatches, and forged job payloads;
- pooled-connection concurrency tests that alternate tenants and inject errors/
  rollbacks to expose context leakage;
- pagination/cursor and idempotency replay across tenant boundaries;
- platform support access with absent, expired, revoked, and wrong-tenant grants.

The S5 acceptance matrix additionally proves missing context fails closed for
all CRUD verbs; tenants A and B can operate only on their own rows and cannot
create cross-tenant FKs; forced RLS applies under the actual non-owner runtime
role even for broad SQL; CAS combines tenant and version without an existence
oracle; and repository lookups remain tenant-qualified. Ordinary ingress cannot
scan `inbound_routes`, while the exact resolver resolves only active exact
hashes, cannot enumerate, and returns nothing for invalid hashes. Tenant
repositories cannot scan `users` or read `platform_audit_events`, and every
polymorphic writer rejects another tenant's target.

Any cross-tenant disclosure/mutation is a release blocker. These tests run in CI
and against migrations in staging.

## Widget trust and domain controls

The widget is an intentionally public lead intake surface. It cannot keep a
browser secret and does not prove a user is a clinic customer.

1. Each active widget connection has a random publishable key, explicit allowed
   origins, allowed environment, status, and version. Keys identify configuration
   and are rotatable; they authorize no staff/private read.
2. Bootstrap requires a syntactically valid browser `Origin`. The server
   canonicalizes scheme, IDNA host, and port and compares exact origins. Wildcard
   subdomains are opt-in and match one documented suffix boundary; arbitrary
   substring, `null`, mixed-scheme, and production localhost matches are denied.
3. `page_url`, `Host`, `Referer`, CORS, and a client body organization ID do not
   establish tenancy. Origin allowlisting reduces browser embedding abuse but is
   not authentication against scripted clients that can forge headers.
4. The bootstrap returns only public clinic presentation/configuration and a
   short-lived, narrowly scoped token with audience, expiry, JTI, immutable
   organization/connection/origin binding, and optionally conversation binding.
   Token signing keys rotate; revoked/disabled connections fail immediately on
   database recheck.
5. Widget routes enforce CORS allowlists, per-IP/key/origin/session/tenant rate
   budgets, message/attachment limits, replay/idempotency, and risk-based abuse
   challenges without blocking ordinary lead intake by default.
6. Widget UI renders all content as escaped text or sanitized allowlisted markup,
   uses a restrictive Content Security Policy, has no access to staff cookies,
   and uses `postMessage` only with exact target/source origin and a versioned
   schema. The embed integration does not grant the host page access to widget
   bearer tokens.
7. Customer confirmation uses a separate hashed, expiring, single-use grant
   bound to customer/session/conversation/appointment/version/action. A widget
   token alone cannot enumerate or confirm another request.
8. Abuse and origin decisions are observable. Domain allowlist changes, key
   rotations, and connection disables are audited.

Because public lead intake is scrapeable, no endpoint exposes tenant-private
knowledge, conversation history outside the bound session, integration
metadata, internal IDs beyond required opaque resource IDs, or whether another
customer/resource exists.

## Platform operator separation

`platform_operator` is a separate control-plane identity/audience and never a
tenant membership role. Tenant sessions cannot call platform routes; platform
tokens cannot be silently used as tenant sessions.

- Platform operators authenticate through a separate admin entry point with
  enforced phishing-resistant MFA where available, short sessions, managed
  devices/network policy as operations matures, and no shared accounts.
- Routine control-plane views show service health and redacted metadata, not
  message/contact bodies or integration secrets.
- Tenant data access requires a just-in-time support grant naming organization,
  ticket/reason, allowed capabilities, approving actor, start and expiry. It
  requires step-up authentication, is time bounded, deny-by-default, revocable,
  visibly bannered, and emits start/read/write/end audit events and alerts.
- Support elevation respects purpose and may be read-only. The operator cannot
  add themselves as an owner, impersonate a user, export a tenant, or reveal an
  integration secret through that grant.
- Emergency database break-glass uses a separate vaulted credential, explicit
  incident, two-person approval when operationally available, bounded duration,
  query/activity capture, and post-incident review. Runtime services never hold
  this credential.
- Support grants are rechecked on every request and job; an expired/revoked grant
  cannot leave a durable worker with residual authority.

## Security architecture baseline

### Identity and sessions

- Staff identity is delegated through an OIDC-compatible authentication
  component/provider behind an application port. The application owns
  memberships/RBAC and issues an opaque, revocable, server-side session; browser
  credentials live only in Secure, HttpOnly cookies with appropriate SameSite
  and narrow Path/Domain attributes.
- Browser login uses authorization code with PKCE, exact redirect URIs, and
  single-use state/nonce. The callback validates signature, issuer, audience,
  expiry and nonce against pinned provider metadata; membership identity maps by
  stable issuer + subject, never unverified email alone.
- Session IDs are random, rotated after authentication/privilege change, hashed
  at rest, idle- and absolute-expiring, and revoked on logout, password/identity
  reset, membership disable, or suspected compromise.
- Owners/admins/platform operators require MFA; sensitive membership,
  integration, privacy, confirmation-attestation, and export actions require
  recent/step-up authentication. Recovery is rate-limited and auditable.
- Cookie mutations require anti-CSRF tokens and same-origin checks. Login and
  recovery endpoints have enumeration-resistant responses, progressive delay,
  credential-stuffing controls, and security notifications.

### Application and network controls

- TLS is required end to end. Edge/proxy trust is explicitly configured so
  scheme, client IP, and host cannot be spoofed through arbitrary forwarding
  headers.
- Fastify JSON Schema validates requests/responses. Parameterized Drizzle
  queries and fixed filter/sort allowlists are mandatory; raw SQL is isolated,
  reviewed, and bound.
- Security headers include a restrictive CSP, `frame-ancestors` appropriate to
  staff pages, `X-Content-Type-Options: nosniff`, Referrer-Policy, and HSTS after
  deployment validation. Widget framing policy is separate and explicit.
- Rate limits combine edge and application controls and use actor/session,
  tenant, route, IP/network, and provider connection keys. Expensive AI work has
  a tenant cost/concurrency budget after message deduplication.
- Uploads, if enabled later, use allowlisted type/size, content sniffing, random
  object names, malware scanning/quarantine, no public bucket, and download
  authorization. V1 does not send arbitrary attachments to the model.
- Egress is allowlisted by integration where infrastructure permits. Provider
  URLs are configured, not supplied by customers; redirects/private-network
  destinations are denied to prevent SSRF.

### Secrets and cryptography

- Production secrets come from a managed secret store; `.env` is local-only and
  excluded from version control. CI secret scanning and dependency scanning are
  release gates.
- Provider/API tokens are envelope-encrypted at rest using a managed key,
  associated with organization + connection + credential purpose, decrypted
  only in the adapter process when used, never returned, and masked in UI/logs.
- Signing/encryption keys have identifiers and rotation overlap. Webhook/widget
  grants support revocation without accepting an unlimited old-key window.
- Database, backup, object storage, and transport encryption are enabled. Access
  to backups and keys is separate and audited.

### Audit events

Security-relevant operations append `audit_events` with:

```text
id, occurred_at, organization_id, actor_type, actor_id|null,
actor_membership_id|null, action, target_type, target_id|null,
result, reason_code, request_id, trace_id, source_ip_prefix,
user_agent_hash, support_grant_id|null, metadata_redacted
```

Audit metadata is an allowlist and never contains message bodies, phone/email,
session/widget tokens, webhook headers, integration secrets, raw AI prompts, or
full before/after records. Events are append-only to runtime roles; corrections
are new events. Access, export, retention, and integrity monitoring are restricted
and themselves audited.

Control-plane actions use a separate `platform_audit_events` store/schema with
the platform actor and optional target organization/support grant. They are not
inserted as organization-less rows into tenant `audit_events` and are unavailable
to generic tenant runtime roles.

## Initial threat model

### Assets and trust boundaries

Primary assets are tenant/customer PII and messages, authoritative business
knowledge/prices, appointment/handoff state, memberships/permissions,
integration and signing credentials, prompts/model decisions, audit evidence,
and service availability/cost budget.

Threat actors include anonymous internet clients, malicious leads, compromised
staff accounts, malicious/curious tenant users, forged/compromised providers,
platform insiders, supply-chain attackers, and accidental developer/operator
errors. Boundaries exist at browser/API, widget host/iframe, provider/webhook,
API/database, runtime/secret store, API/AI provider, outbox/worker/provider, and
tenant/control-plane interfaces.

### Threats and mitigations

| Threat | Main mitigations | Detection and required tests |
|---|---|---|
| Broken tenant isolation | Verified tenant context; explicit repository scope; non-null `organization_id`; composite tenant FKs; forced RLS under non-owner runtime role; tenant-namespaced caches/jobs/storage; separate elevated paths. | Cross-tenant matrix, pooled-connection leakage, RLS CRUD, composite-FK, cursor/idempotency/job/export tests; alert on RLS/context failures. |
| IDOR/resource enumeration | Authorize membership, role and location before scoped lookup; opaque UUIDv7 is defense only in depth; return indistinguishable `404`; bind widget/customer grants to exact resources. | A/B tenant and A/B customer token swapping across every read/mutation; anomalous sequential denial metrics. |
| Prompt injection | External text explicitly data; immutable policy; no model tools; no secrets in context; strict schema + source/action allowlists + deterministic policy; indirect-injection evaluation. | Uzbek/Russian/English direct and knowledge-base indirect injection evals; record redacted risk/policy failure categories. |
| Malicious webhook payload | Raw byte/body limits before parsing; provider-specific runtime schema; bounded batch/event fields; treat strings as data; isolate bad events; attachment quarantine. | Fuzz/malformed/decompression/oversize/multi-event tests; parse failure and quarantine metrics. |
| Webhook forgery | TLS; raw-body signature/secret verification before parsing; constant-time compare; expected account/connection match; secret rotation; deny on failure. | Valid/invalid/old-secret/body-mutation fixtures; signature-failure alert without logging secret/header. |
| Duplicate webhook delivery | Unique provider connection + event/message/callback identifiers; atomic receipt + enqueue; idempotent domain commands/outbox. | Concurrent duplicate/reordered batch tests prove one message/lead/request/reply; duplicate-rate metric. |
| Replay attacks | Timestamp/nonce window where provider supports it; unique event and callback grants; short-lived single-use widget/customer tokens; JTI/revocation; idempotency retention covers retry window. | Expired, reused, cross-connection and modified-payload replay tests; replay counter. |
| XSS | Store text as untrusted; context-aware escaping; sanitized allowlisted markup only; no AI/raw HTML execution; CSP; no dangerous URL schemes; isolated widget. | Stored/reflected/DOM XSS tests for message, FAQ, service, AI, filename and provider fields in all three languages. |
| CSRF | Secure HttpOnly SameSite cookies; anti-CSRF token on mutations; Origin/Fetch Metadata checks; deny-by-default CORS; webhook routes use separate auth and no staff cookie. | Missing/stale/cross-session token, cross-origin form/fetch, login CSRF tests. |
| SQL injection | Runtime JSON Schema; parameterized Drizzle queries; fixed sort/filter allowlists; no model/customer SQL; reviewed raw SQL; least-privilege DB roles. | Injection corpus against query/filter/search/report endpoints; static review/lint and database audit anomalies. |
| Brute force and rate/cost abuse | Layered IP/account/session/widget/connection/tenant limits; progressive login delays; MFA; AI concurrency/token budgets; dedupe before AI; payload limits; risk challenge. | Distributed/single-source load tests; auth/`429`/AI-budget alerts; avoid high-cardinality metrics. |
| Leaked secrets | Managed secret store; no secret echo/log; encryption; narrow scopes; rotation/revocation; CI/history scanning; separate environment credentials. | Secret scanning, canary/usage anomalies, rotation drills, response snapshot tests. |
| Account takeover | MFA, secure/revocable sessions, step-up, rotation, recovery hardening, login alerts, membership disable propagation, no shared admin accounts. | Session fixation/revocation/recovery/enumeration tests; impossible-travel/risk signals as available. |
| Compromised integration token | One connection/purpose scope where provider permits; encrypted at rest; adapter-only decrypt; no model/UI access; rotation and immediate disable; outbound limits/reconciliation. | Unexpected provider/account/destination/error-volume alert; compromised-token game day. |
| Sensitive logging | Allowlisted structured events; central redaction; no raw headers/bodies/prompts/query strings; provider errors normalized; access-controlled log sink and retention. | Automated PII/secret log canaries and scans; error-path snapshots; log access audits. |
| PII exposure | Data minimization, field-level permissions, RLS, encryption, expiring exports/URLs, masked UI, no PII metric labels, verified data-subject workflow. | Authorization/export/object URL tests; DLP scans; access anomaly review. |
| Malicious knowledge-base content | Admin-only authoring; runtime length/schema/sanitization; content labeled untrusted in prompts; version/reviewer/audit; no scripts/remote fetch; source validation. | Indirect injection/XSS/oversize/link tests; suspicious edit alerts and rollback exercise. |
| Model hallucination | Structured authoritative context; source ID/version validation; critical application templates; null/handoff when absent; multilingual eval gates; no availability/medical authority. | Missing-price/service/hours/availability/medical evals; hallucination and policy-denial rate by model/prompt/language. |
| Unauthorized model tool execution | `tools: []` in V1; closed action enum; model output cannot invoke code; schema/reference/permission/state validation; future tools require tenant-bound wrappers and ADR. | Unknown/action-smuggling/nested JSON tests; assert zero provider tool calls and zero calendar writes. |
| Staff privilege/location escalation | Central permission policy; membership/location changes restricted; no self-elevation/final-owner removal; versioning, step-up and audit. | Full role/location matrix; concurrent membership change/session revocation tests. |
| Confused-deputy worker/outbox tampering | Trusted outbox creation in same tenant transaction; payload schema/version; worker re-resolves ownership; separate least-privilege credential; idempotency. | Forged/wrong-tenant/stale job and poison/dead-letter tests; job-origin audit. |
| SSRF through URLs/integrations | Provider endpoints configured server-side; URL allowlist, DNS/IP validation and redirect limits; no customer URL fetch or V1 model web tool. | Private/link-local/redirect/DNS-rebinding test corpus; blocked-egress metrics. |
| Denial of service / provider cost exhaustion | Edge/body/time limits, queues/backpressure, per-tenant fairness, circuit breakers, AI budgets, bounded history/output, dead-letter policy. | Load/queue saturation/provider outage tests; latency, queue age, rejection and cost alerts. |
| Supply-chain/dependency compromise | Lockfile, minimal dependencies, provenance/advisory/license review, CI scanning, protected branches, reproducible artifacts, least-privilege CI. | Dependency/SBOM/image scans and patch SLA; artifact verification. |
| Backup/export theft | Encryption, separate access/key roles, immutable backup policy, expiring one-use export links, step-up and audit, lifecycle deletion. | Restore/access drills, expired/reused URL tests, unexpected download alerts. |

Threat status and residual risk are reviewed at each stage. A mitigation listed
here is not considered implemented until its code/configuration and test gate
exist.

## Privacy architecture

The product is privacy-aware infrastructure, not a declaration of legal
compliance. Launch jurisdiction, controller/processor roles, healthcare data
status, required agreements, data residency, statutory retention, and lawful
bases require legal review. Architecture makes these policies configurable and
auditable rather than guessing them.

P0 includes data minimization, consent evidence and withdrawal semantics,
sensitive-log controls, access control, configurable retention/audit/legal-hold
foundations, and a verified operator privacy-request runbook able to satisfy
applicable law. Productized automated consent-withdrawal, subject/tenant export,
deletion/anonymization, and retention-worker APIs/jobs are P1 contracts and
remain disabled until their implementation and the capability-specific gates
below pass, unless launch counsel explicitly elevates one to P0.

### Data classification and minimization

| Class | Examples | Rules |
|---|---|---|
| Public tenant data | Published service names, approved prices, public FAQ/hours/location | May be sent to leads/model when applicable; still versioned and protected from unauthorized editing. |
| Internal operational | Membership IDs, state/version, routing IDs, non-sensitive metrics | Least privilege; not exposed to anonymous clients or model unless necessary. |
| Customer PII | Name, phone, email, channel identity, IP-derived abuse data | Collect only for lead/contact/scheduling purpose; encrypt in transit/at rest, mask by role, never metric labels. |
| Sensitive conversation data | Message bodies, appointment preferences, attachments, unexpected health details | Restricted to serving staff; minimize model context; never ordinary logs; shorter configurable retention where possible. |
| Secrets/authentication | Sessions, tokens, webhook secrets, provider credentials, password/MFA material | Never model input/export/log; hash or encrypt by purpose; strict rotation/access. |
| Audit/security evidence | Actor/action/result, scoped source indicators | Append-only, metadata allowlist, longer justified retention, no content payloads. |

The widget asks only information required by the configured qualification and
booking workflow. Free-form medical history, diagnosis, insurance documents,
government IDs, payment cards, and biometrics are not requested in V1. If a lead
volunteers health information, treat it as sensitive, avoid echoing it, do not
diagnose, and route to staff under retention/access controls.

IP addresses are truncated or keyed-hashed for abuse controls when full address
is unnecessary. User-agent/referrer data is minimized. Analytics prefers domain
events and aggregate counts over message content.

### Notice, consent, and purpose records

Consent is not assumed to be the lawful basis for every processing operation.
The tenant configures approved notices/purposes after legal review. The system
records evidence in `consent_records`:

```text
id, organization_id, contact_id|null, conversation_id|null,
contact_identity_id|null, purpose,
status(granted|declined|withdrawn|not_required), lawful_basis_code|null,
notice_key, notice_version, policy_url|null, locale, capture_channel,
channel_connection_id|null, source_message_id|null,
captured_by_type(customer|member|system), captured_by_id|null,
captured_at, withdrawn_at|null, supersedes_consent_id|null,
evidence_hash, evidence_ciphertext|null, created_at
```

Widget notice is displayed before or at personal-data capture; Telegram sends
an approved concise notice/link and records the interaction where required.
Silence/prechecked boxes do not create affirmative marketing consent. Service/
booking communications and marketing are separate purposes; withdrawing
marketing consent does not erase valid operational records or prevent a
customer-requested booking message. A notice/version change does not rewrite
history.

### Retention model

Retention is policy-driven per organization and record category, constrained by
platform safety bounds and legal holds. Canonical `retention_policies` record a
version, purpose, trigger event, duration, action (`purge`, `anonymize`,
`aggregate`), jurisdiction/legal basis reference, approver, and effective date.
All durations below are engineering planning values for capacity/cost analysis,
not active production defaults or legal advice. Production retention
configuration remains unset—and processing real customer data is blocked—until
launch-jurisdiction approval replaces or explicitly adopts them:

| Category | Trigger | Provisional default | Expiry action |
|---|---|---:|---|
| Contacts, leads, conversations/messages, appointment requests, handoffs | Conversation/lead closed or last meaningful activity, whichever is later | 730 days | Purge or irreversibly anonymize related content/identifiers unless hold applies. |
| Successful normalized webhook/idempotency receipts | Receipt/completion | 30 days; REST idempotency replay availability at least 24 hours | Purge payload/hash material not required for audit. |
| Raw webhook body | Receipt | Do not retain on success; encrypted failure quarantine up to 7 days | Purge. |
| AI raw prompt/response debug capture | AI run completion | Off by default; exceptional capture up to 7 days | Purge automatically. |
| `ai_runs` operational metadata and redacted decision | AI run completion | 365 days | Purge or aggregate non-identifying cost/quality facts. |
| Outbox/job payload and dead letter | Terminal completion/failure | 30 days after resolution | Purge payload; retain non-PII outcome metric. |
| Application/security logs and traces | Emission | 30 days online; security archive only if approved | Purge by storage lifecycle. |
| Audit events | Event time | 365 days | Purge/anonymize subject fields unless security/legal requirement extends it. |
| Consent/notice evidence | End of subject relationship or withdrawal | Related data lifetime plus 365 days | Retain minimal evidence or purge per approved legal schedule. |
| Generated export | Ready time | 7 days | Delete object and revoke grants/URLs. |
| Deletion deduplication tombstone | Deletion completion | 30 days | Purge; contains only salted/non-reversible identifiers. |
| Encrypted backups | Backup creation | 35 days | Automatic expiry; deleted data disappears as backup generations age out. |

The planned P1 retention worker selects eligible rows under tenant scope, writes
an auditable deletion batch, applies child-first purge/anonymization
transactionally in bounded batches, and retries idempotently. Until enabled, the
P0 operator runbook applies the approved schedule through restricted, audited
operations. Legal/security holds are explicit P0 records with scope, reason,
approver and expiry/review; they do not become permanent silent flags. Policy
changes affect future eligibility but retain policy/version evidence.

Aggregate funnel metrics may outlive source records only after organization and
person identifiers are removed/generalized so re-identification is not reasonably
available. Counts too small for safe platform benchmarking are suppressed.

### Deletion

The following productized workflows are P1; the P0 operator runbook preserves the
same verification, tenant scope, hold, processor, audit, and backup rules.
There are two workflows:

**Data-subject deletion**

1. Receive request through an authenticated tenant staff process or a public
   request channel; do not expose whether an identifier exists.
2. Verify requester identity proportionately, record scope and deadline, and
   locate identities through tenant-scoped contact identity mappings.
3. Inventory contacts, leads, conversations/messages, appointment/handoff,
   consents, AI debug captures, attachments, exports, and processor references.
4. Apply documented legal/contract/security hold exceptions. Restrict records
   while disputed where policy requires.
5. Purge or anonymize eligible rows without breaking financial/security audit
   invariants. Audit retains only minimal non-content evidence that a deletion
   occurred; it does not retain deleted PII in metadata.
6. Enqueue processor/provider deletion where supported, invalidate customer
   sessions/grants/exports, and record completion/failure for each processor.
7. Confirm completion safely. Backups are not selectively rewritten; data is
   access-restricted and disappears through the disclosed backup lifecycle, and
   a restore reapplies deletion ledgers before serving traffic.

**Organization deletion**

Only the owner with recent step-up authentication can request it. The workflow
offers an export, uses an explicit cooling-off window, disables new public
ingress/integrations, revokes memberships/tokens, drains or cancels jobs, then
purges tenant rows/objects/credentials and schedules key material destruction
where per-tenant envelope keys exist. Cancellation before the destructive phase,
phase status, failures, and final evidence are audited. No immediate database
CASCADE is exposed as an HTTP operation.

### Export and portability

The productized export endpoint/job is P1; a legally required P0 request is
fulfilled through the verified restricted operator runbook until it is enabled.

- Owner-authorized tenant exports and verified data-subject exports are
  asynchronous jobs with a frozen scope/policy version.
- The worker uses tenant RLS context and produces documented JSON plus CSV for
  tabular data; timestamps, currencies, locale, IDs, consent history, and booking
  confirmation provenance remain unambiguous.
- Integration credentials, session/grant secrets, password/MFA material,
  internal prompt policy, other subjects' data, platform-only security signals,
  and unsafe provider payloads are excluded.
- Export objects are encrypted, random-named, malware/content checked where
  relevant, and available through a short-lived single-use authorization flow
  after fresh permission/step-up validation. Download and expiry are audited;
  the object is deleted after seven days by default.
- A subject export redacts third-party/staff private information and verifies
  identity before generation and again before download.

### Sensitive log handling

Logging is allowlist-first. Permitted operational fields include request/trace
IDs, organization/resource IDs in restricted sinks, route template, status,
duration, sizes, stable error/category codes, model/prompt/schema version, token
counts, and retry count. Prohibited fields include:

- names, phones, emails, full IPs, addresses, customer message/FAQ bodies;
- `Authorization`, cookies, CSRF/widget/customer grants, webhook signatures and
  raw headers/bodies;
- provider/integration credentials, connection strings, encryption keys;
- raw AI prompts/responses/reasoning, SQL parameters, exports, or attachments.

Central serializers redact known keys before emission; HTTP/provider/database
error adapters normalize errors before logging. Query strings are excluded or
allowlisted. Emergency debug capture is encrypted, access/audit controlled,
expires automatically, and is never enabled globally without incident approval.
CI uses synthetic canary secrets/PII to assert they do not appear in logs.

### Privacy audit trail

Audit events are required for notice/consent grant/withdrawal, contact merges,
PII view/export, export download/expiry, deletion/hold lifecycle, retention policy
change, membership/location permission change, integration secret rotation,
support access, staff-attested external confirmation, and administrative access
to debug captures. Audit access is limited to owner/admin security permissions
and authorized platform security staff through a support/control-plane process.

## Operational security and privacy response

- Security events route to an incident process with severity, owner, containment,
  credential/session revocation, tenant impact analysis, evidence preservation,
  notification decision, and post-incident actions.
- A suspected isolation failure disables the affected path, preserves redacted
  evidence, rotates implicated credentials, and triggers cross-tenant impact
  review. Availability pressure does not justify bypassing RLS.
- A compromised channel connection can be disabled independently; inbound
  verification and outbound sends stop while staff retains the in-product inbox.
- A provider/model outage triggers the deterministic AI handoff path and circuit
  breaker. It never relaxes schema/policy checks.
- Restore tests prove tenant constraints/RLS, deletion-ledger reapplication,
  secret separation, and audit continuity before a backup is considered usable.

## Security and privacy verification gates

Before P0 production release, evidence must include:

- automated role/location/tenant/RLS/IDOR tests described above under the real
  runtime database role;
- OWASP-style API and browser tests for CSRF, XSS, injection, session fixation,
  CORS/CSP, rate limits, enumeration, upload/URL handling where enabled;
- signed webhook fixture, forgery, replay, duplicate, reorder, oversized and
  malformed payload tests;
- AI direct/indirect prompt-injection and hallucination evals in Uzbek, Russian,
  and English, with assertion of zero tool/calendar writes;
- secret/PII log tests, repository/container/dependency/secret scanning, and
  credential rotation drills;
- baseline storage lifecycle/expiry, enforceable legal-hold behavior, and a
  tested manual privacy-request runbook; before enabling the P1 APIs/jobs,
  additionally verify export authorization/expiry, deletion under foreign-key/
  RLS constraints, retention-worker idempotency, and restore re-deletion;
- platform support grant expiry/revocation and break-glass exercise;
- documented threat-model review and privacy/legal approval for actual launch
  jurisdictions, retention values, subprocessors, data controls, notice and
  healthcare positioning.

## Open privacy/security decisions

These require product/legal/operations input and cannot be inferred safely:

- launch jurisdictions, controller/processor roles, data residency, healthcare
  data classification, required data-processing agreements, breach-notification
  obligations, and statutory retention;
- final identity provider/authentication component, recovery process, mandatory
  MFA factors, and enterprise SSO timing;
- approved legal bases, notice text/versions, marketing scope, minimum age, and
  identity-verification procedure for subject requests;
- final retention bounds replacing the provisional values above and which fields
  must be anonymized versus purged;
- whether attachments enter V1 (architecture currently treats arbitrary
  attachments as unsupported/quarantined and excludes them from AI);
- support staffing/two-person break-glass availability and production network/
  device restrictions;
- OpenAI/other processor contract, region, data controls, and suitability for the
  exact production data before customer content is enabled.

None of these open choices permits weakening tenant scoping, forced RLS, no-tool
AI authority, webhook verification, customer-confirmation provenance, secret
handling, or audit requirements.
