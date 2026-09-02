# PostgreSQL relational data model

Status: Stage 0 normative logical schema

Database: PostgreSQL 17 (latest supported 17.x minor in each environment)

Identifier/time conventions: UUIDv7 and UTC `timestamptz`

This document specifies the initial relational model. It is not a migration.
Stages S4a–S4c must translate it into explicit, reviewed migrations.

## 1. Data-design rules

### 1.1 Common columns

Unless a table description says otherwise:

- `id uuid primary key` is application-generated UUIDv7.
- Every tenant-owned table has non-null `organization_id uuid`.
- Mutable roots have `created_at timestamptz`, `updated_at timestamptz`, and
  `version bigint default 1 check (version > 0)`.
- Immutable facts have `created_at` or `occurred_at` and no `updated_at`.
- Timestamps are UTC instants. Business-local input additionally stores an IANA
  time zone and, where needed, the original local date/time.
- Status and type fields use `text` plus named `CHECK` constraints in initial
  migrations. This keeps allowed values explicit while avoiding hard-to-evolve
  PostgreSQL enum types.
- Money uses `bigint` integer minor units plus `char(3)` ISO 4217 currency.
- Free-form/JSON columns have runtime schemas, size limits, and database
  structural checks (`jsonb_typeof`). JSONB is not a substitute for ownership
  FKs or indexed scalar fields.
- User-provided text has bounded length. No table accepts arbitrary HTML as
  trusted markup.

### 1.2 Composite tenant integrity

Every tenant table has:

1. `FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE
   RESTRICT`;
2. `UNIQUE (organization_id, id)`, even though `id` is already globally unique;
3. tenant-leading indexes for supported access paths;
4. composite same-tenant FKs from children, for example:

~~~sql
FOREIGN KEY (organization_id, conversation_id)
  REFERENCES conversations (organization_id, id)
  ON DELETE RESTRICT
~~~

This redundancy is intentional. A child cannot point at another organization's
parent even if application code is wrong. Cross-tenant relationships are
forbidden unless a separately reviewed control-plane design explicitly models
one.

### 1.3 Sensitive-data classes

| Class | Examples | Required treatment |
| --- | --- | --- |
| S0 public/configured | Published service name, FAQ answer, public hours | Validate, version, output-escape |
| S1 internal operational | Status, queue, delivery error category, cost units | Tenant authorization; redact identifiers from broad telemetry |
| S2 personal/confidential | Names, phone, message body, notes, IP/user agent, confirmation evidence | Minimize; field/application encryption where indicated; purpose-limited access; never routine logs |
| S3 secret/security | Provider tokens, webhook secret, session/confirmation tokens | Secret manager or envelope encryption; store only reference/hash when possible; reveal-never; rotation |

Encryption keys and tenant-specific lookup peppers are outside PostgreSQL data
rows and are managed by the secrets/KMS boundary. Hashing for equality lookup
does not make data anonymous.

### 1.4 Deletion defaults

- Organization deletion is a controlled lifecycle: suspend, export/hold check,
  anonymize/purge in dependency order, then delete. There is no generic
  `DELETE FROM organizations CASCADE` path.
- Catalog records are deactivated/superseded. Historical versions referenced by
  messages, AI runs, appointments, or audit evidence are retained according to
  policy.
- Contacts are anonymized first: remove encrypted PII and lookup hashes while
  retaining non-identifying keys needed for referential/funnel integrity.
- Message/AI payload ciphertext is tombstoned on expiry; minimal event metadata
  can be retained for abuse, audit, and aggregate metrics.
- Audit, consent, and financial/outcome facts use policy- and
  jurisdiction-specific retention. A legal hold overrides purge.
- `ON DELETE CASCADE` is allowed only for inseparable, non-audit child rows
  explicitly noted below; otherwise use `RESTRICT` and an audited purge service.

## 2. Tenant isolation and PostgreSQL RLS

Application-layer scoping is mandatory and PostgreSQL row-level security is
defense-in-depth.

### 2.1 Transaction context

Each request/job opens a transaction and sets transaction-local, validated
values:

~~~sql
SET LOCAL app.organization_id = '<server-derived uuid>';
SET LOCAL app.principal_id = '<authenticated uuid or system principal>';
SET LOCAL app.request_id = '<correlation uuid>';
~~~

A locked-down helper such as `app.current_organization_id()` safely returns a
UUID or NULL; malformed/missing settings fail closed. Connection pool code must
never use session-persistent tenant settings. A worker processing several
tenants starts a new transaction and resets context for every claimed item.

### 2.2 Policy form

Every tenant table ultimately enables and forces RLS. S4a-S4c create the
RLS-ready structural schema; S5 adds the policies, transaction-local context,
and runtime-role separation. The normal runtime role is not the owner and has
no `BYPASSRLS`:

~~~sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY conversations_tenant_isolation ON conversations
  USING (organization_id = app.current_organization_id())
  WITH CHECK (organization_id = app.current_organization_id());
~~~

`organizations` uses `id = app.current_organization_id()`. `users` and
pre-tenant routing are control-plane exceptions with no generic runtime
`SELECT`. Membership/location permissions are still evaluated in application
policy; RLS organization equality alone does not grant a user access.

Migration/owner roles are unavailable to application processes. Platform
support uses a separate, just-in-time, audited control path and does not reuse
the tenant runtime role.

### 2.3 Pre-tenant route resolution

Inbound traffic must find a tenant before setting RLS context. The
`inbound_routes` control table contains only keyed route hashes and target IDs;
it has no message content or credentials. Runtime roles have no direct table
access. A narrowly defined `SECURITY DEFINER` function accepts an exact
type/hash, returns an active organization/connection pair, has a fixed
`search_path`, owns no arbitrary SQL, and is executable only by the ingress
role. After resolution the application sets tenant context, reads the
`channel_connections` row under forced RLS, and verifies signature/origin.

This is the only public-ingress tenant lookup exception. Resource IDs and
payload `organization_id` values never use it.

## 3. Control-plane and tenancy tables

### 3.1 `organizations`

- **Purpose:** Stable tenant root and lifecycle.
- **Columns:** `id`, `slug`, `display_name`, `status active|suspended|closed`,
  `default_locale uz|ru|en`, `default_time_zone`, `current_retention_policy_id`
  (nullable until bootstrap completes), common mutable columns, `closed_at`.
- **PK/FKs/tenant:** PK `id`; self is the tenant boundary; deferred composite
  relationship to `retention_policies` after both rows exist.
- **Uniqueness:** case-normalized `slug` unique; (`id`, `id`) is not needed.
- **Indexes:** `(status)` for control-plane operations; tenant traffic selects by
  PK only.
- **Sensitive:** S1; name may be commercially confidential.
- **Deletion/RLS:** `id = current tenant` forced-RLS policy for runtime;
  `RESTRICT` while child rows exist; controlled purge only.

### 3.2 `users`

- **Purpose:** Provider-neutral global application principal; organization
  access comes only through membership.
- **Columns:** `id`, protected `email_ciphertext`/`email_lookup_hash` where
  needed, `display_name_ciphertext`, `status active|suspended|deleted`,
  `last_authenticated_at`, common columns. Provider issuer/subject fields and
  session fields never live on this table.
- **PK/FKs/tenant:** PK `id`; global control-plane table, no
  `organization_id`.
- **Uniqueness:** optional unique `email_lookup_hash` only if account policy
  requires it; email is never an authentication identity primary key and is
  never used for automatic external-identity linking.
- **Indexes:** `(status, last_authenticated_at)`; optional email lookup index
  only under the approved account policy above.
- **Sensitive:** S2 profile/contact fields.
- **Deletion/RLS:** no tenant RLS or tenant-visible list. Exact-principal
  lookup is exposed through a restricted auth function/repository. Deletion
  tombstones PII but audit actor IDs may remain.

### 3.2.1 `external_identities` (S6)

- **Purpose:** Provider-neutral 1:N mapping from an exact external identity to
  one global application user.
- **Columns:** `id`, `user_id`, exact `issuer`, exact `subject`, provider-neutral
  lifecycle/provenance timestamps defined with the S6 authentication flow.
- **PK/FKs/tenant:** PK; `user_id -> users(id) RESTRICT`; global authentication
  control table with no `organization_id`.
- **Uniqueness:** (`issuer`, `subject`). Email is not an identity key and never
  causes automatic linking.
- **Sensitive/deletion:** S2 stable pseudonymous identity. Linking another
  identity requires explicit trusted S6 logic; provider claims never establish
  tenant membership. Disable/unlink through an audited authentication workflow.

This table is allocated to S6 and is not created by S4a.

### 3.2.2 `membership_invitations` (S6)

- **Purpose:** Persist a pre-user invitation independently from membership and
  authentication identity.
- **Identity rule:** an invitation does not require `user_id`, does not
  auto-link by email, and becomes a membership only through explicit,
  security-reviewed S6 acceptance logic.
- **Secret rule:** no raw invitation token/secret is persisted if S6 uses a
  token scheme.

This table is allocated to S6 and is not created by S4a.

### 3.2.3 `auth_sessions` (S6)

- **Purpose:** Opaque, revocable server-side staff login session used by the
  private API; organization authorization is still reloaded from memberships.
- **Columns:** `id`, `user_id`, `session_token_hash`, `csrf_secret_hash`,
  `status active|revoked|expired`, `authentication_time`,
  `authentication_level`, `created_at`, `last_seen_at`,
  `idle_expires_at`, `absolute_expires_at`, `revoked_at nullable`,
  `revocation_reason nullable`, keyed `source_ip_hash nullable`,
  `user_agent_hash nullable`.
- **PK/FKs/tenant:** PK; `user_id -> users(id) RESTRICT`; global authentication
  control table with no `organization_id`. A session carries no tenant
  permission.
- **Uniqueness:** `session_token_hash`; (`user_id`, `id`).
- **Indexes:** (`user_id`, `status`, `last_seen_at desc`);
  (`status`, `idle_expires_at`); (`status`, `absolute_expires_at`).
- **Sensitive:** S3 hashes and S2 security metadata; cookie token/CSRF plaintext
  is never stored or logged.
- **Deletion/RLS:** no tenant access or generic runtime scan. Exact-token auth
  lookup/update uses a narrow auth repository/role. Revoke immediately and purge
  after the session replay/investigation window.

### 3.3 `memberships`

- **Purpose:** Bind an existing user to an existing organization with product
  role and lifecycle. A pre-user invitation is a separate S6 record.
- **Columns:** `id`, `organization_id`, `user_id`, `role owner|admin|staff|analyst`,
  `status invited|active|suspended|revoked`,
  `location_scope all|restricted`, `invited_by_user_id`,
  `invited_at`, `activated_at`, `revoked_at`, common mutable columns.
- **PK/FKs/tenant:** PK `id`; FK organization; composite tenant FK for inviter's
  membership/user authorization is enforced in the application/audit record;
  `user_id -> users.id RESTRICT`.
- **Uniqueness:** (`organization_id`, `user_id`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `role`);
  (`user_id`, `status`) for login membership discovery.
- **Sensitive:** S1; membership is confidential.
- **Deletion/RLS:** forced RLS when S5 is applied. Revoke rather than delete;
  hard delete only an unactivated membership for an existing user when it has
  no audit dependency.

A restricted membership with zero `membership_location_scopes` rows has access
to no location. Owners normally require `location_scope=all`; permission policy
still controls organization-wide resources.

`membership_location_scopes` persistence and all role/location authorization
evaluation are allocated to S6. S4a stores only the membership's structural
role/status/location-scope value; it implements no authorization behavior.

### 3.4 `membership_location_scopes`

- **Purpose:** Optional allowlist of locations for a membership.
- **Columns:** `organization_id`, `membership_id`, `location_id`, `created_at`,
  `created_by_user_id`.
- **PK/FKs/tenant:** composite PK
  (`organization_id`, `membership_id`, `location_id`); composite FKs to
  membership and location ensure same tenant.
- **Uniqueness:** PK.
- **Indexes:** (`organization_id`, `location_id`, `membership_id`) reverse lookup.
- **Sensitive:** S1.
- **Deletion/RLS:** forced RLS; cascade only when the membership is explicitly
  hard-purged; location deletion remains restricted.

### 3.5 `retention_policies`

- **Purpose:** Versioned tenant data-retention configuration.
- **Columns:** `id`, `organization_id`, `version_no`, `status draft|published|retired`,
  `jurisdiction_profile`, `effective_from`, `published_by_user_id`,
  `approved_by_user_id`, immutable `created_at`.
- **PK/FKs/tenant:** PK `id`; composite same-tenant publisher membership/user
  attribution; FK organization.
- **Uniqueness:** (`organization_id`, `version_no`); at most one published
  current row by partial unique index.
- **Indexes:** (`organization_id`, `status`, `effective_from desc`).
- **Sensitive:** S1; do not place case-specific legal-hold reasons here.
- **Deletion/RLS:** forced RLS; published/referenced versions immutable and
  restricted from deletion.

### 3.6 `retention_policy_rules`

- **Purpose:** Structured rule within one retention-policy version.
- **Columns:** `id`, `organization_id`, `retention_policy_id`,
  `data_class`, `purpose`, `trigger_event`, `duration_days integer`,
  `expiry_action purge|anonymize|aggregate`, `jurisdiction_reference`,
  `legal_basis_reference`, `created_at`.
- **PK/FKs/tenant:** PK; composite FK to retention policy.
- **Uniqueness:** (`organization_id`, `retention_policy_id`, `data_class`,
  `purpose`, `trigger_event`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `retention_policy_id`);
  (`organization_id`, `data_class`, `trigger_event`).
- **Sensitive:** S1 legal/configuration metadata.
- **Deletion/RLS:** forced RLS; draft children may be replaced; published rule
  rows are immutable/restricted with their policy version.

### 3.7 `inbound_routes`

- **Purpose:** Minimal pre-tenant exact-match routing from widget/provider route
  fingerprint to an organization/channel connection.
- **Columns:** `id`, `route_type widget_key|telegram_webhook`,
  `route_key_hash bytea`, `organization_id`, `channel_connection_id`,
  `status active|disabled`, `rotated_at`, `created_at`.
- **PK/FKs/tenant:** PK `id`; `organization_id -> organizations(id)` plus
  mandatory composite
  (`organization_id`, `channel_connection_id`) ->
  `channel_connections(organization_id, id)`, so a route can never bind a
  connection to the wrong tenant. It is classified as control-plane because it
  must be resolved before tenant context.
- **Uniqueness:** (`route_type`, `route_key_hash`); one active route per
  connection/type as applicable.
- **Indexes:** unique exact lookup only; no prefix/search endpoint.
- **Sensitive:** S3-adjacent hash; possession may aid route enumeration.
- **Deletion/RLS:** no generic grants; only fixed security-definer lookup and
  separately authorized tenant-admin rotation command. Disable/rotate first;
  delete after replay window and audit retention.

## 4. Business configuration tables

### 4.0 Multilingual value representation

V1 uses a bounded locale-map value object in JSONB for versioned presentation
fields instead of separate translation tables. This is deliberate: only
`uz|ru|en` are supported, all translations for one immutable knowledge version
must publish atomically, and the records are small. It does not put
language-specific business rules in the domain.

An immutable database validation function used by `CHECK` constraints enforces:

- the value is an object with keys drawn only from `uz`, `ru`, and `en`;
- each present value is a bounded non-empty string;
- at least one value exists; and
- a published record includes the organization's default locale, enforced by
  the publish transaction because a cross-table value cannot be a simple check.

Deterministic fallback is requested published locale -> exact published
organization-default-locale text with a clear language clarification -> typed
missing-translation outcome/handoff. Runtime model translation is never
authoritative and is not sent as a business fact in V1. A model may propose a
translation only as an unpublished owner-review configuration draft. Consent,
emergency, guarantee, and safety wording always requires an approved exact-
locale variant or handoff.

`service_versions` and `faqs` include generated `tsvector` search columns for
each supported locale using a verified PostgreSQL configuration (initially
`simple` where a supported stemmer is unavailable), with GIN indexes named by
locale. These are presentation/search infrastructure only; all queries still
lead with organization/status/scope filters, and the same ranking policy is
used for every locale. JSONB GIN indexes are added only for measured
containment-key queries. No vector database or cross-tenant search index exists
in V1.

### 4.1 `locations`

- **Purpose:** Stable location identity and lifecycle.
- **Columns:** `id`, `organization_id`, `code`, `status active|inactive`,
  `current_version_id`, common mutable columns.
- **PK/FKs/tenant:** PK; FK organization; deferred same-tenant FK
  `current_version_id -> location_versions`.
- **Uniqueness:** (`organization_id`, normalized `code`);
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `code`).
- **Sensitive:** S0/S1.
- **Deletion/RLS:** forced RLS; deactivate; `RESTRICT` if referenced.

### 4.2 `location_versions`

- **Purpose:** Immutable authoritative presentation/time-zone snapshot.
- **Columns:** `id`, `organization_id`, `location_id`, `version_no`,
  `name_i18n jsonb`, `address_i18n jsonb`, `public_contact_jsonb`,
  `time_zone`, `published_at`, `published_by_user_id`, `content_hash`,
  `created_at`.
- **PK/FKs/tenant:** PK; composite FKs to location and publisher membership/
  user context.
- **Uniqueness:** (`organization_id`, `location_id`, `version_no`);
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `location_id`, `version_no desc`).
- **Sensitive:** S0 when published; internal contact metadata must be excluded.
- **Deletion/RLS:** forced RLS; immutable; restrict while cited/referenced.

### 4.3 `location_business_hours`

- **Purpose:** Regular local opening intervals attached to one immutable
  location version.
- **Columns:** `id`, `organization_id`, `location_version_id`,
  `day_of_week smallint 1..7`, `opens_at_local time`,
  `closes_at_local time`, `sequence_no`, `created_at`.
- **PK/FKs/tenant:** PK; composite FK to location version.
- **Uniqueness:** (`organization_id`, `location_version_id`, `day_of_week`,
  `sequence_no`); exclusion/application validation prevents overlaps.
- **Indexes:** (`organization_id`, `location_version_id`, `day_of_week`).
- **Sensitive:** S0.
- **Deletion/RLS:** forced RLS; inseparable version child may cascade only when
  an unreferenced draft version is purged; published history is restricted.

### 4.4 `location_closures`

- **Purpose:** Immutable exceptional closure or hours override for a local date.
- **Columns:** `id`, `organization_id`, `location_id`, `local_date date`,
  `kind closed|override`, optional `opens_at_local`/`closes_at_local`,
  `reason_i18n jsonb`, `status active|superseded|cancelled`,
  `supersedes_id`, `created_by_user_id`, `created_at`.
- **PK/FKs/tenant:** PK; composite FKs to location and superseded row.
- **Uniqueness:** one active record per (`organization_id`, `location_id`,
  `local_date`) by partial unique index.
- **Indexes:** (`organization_id`, `location_id`, `local_date`) where active.
- **Sensitive:** S0/S1; public reason must be deliberately publishable.
- **Deletion/RLS:** forced RLS; supersede/cancel rather than edit; retained when
  used as provenance.

### 4.5 `services`

- **Purpose:** Stable service identity and lifecycle.
- **Columns:** `id`, `organization_id`, `code`, `status active|inactive`,
  `current_version_id`, common mutable columns.
- **PK/FKs/tenant:** PK; FK organization; deferred composite FK to current
  version.
- **Uniqueness:** (`organization_id`, normalized `code`);
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `code`).
- **Sensitive:** S0.
- **Deletion/RLS:** forced RLS; deactivate; restrict if referenced.

### 4.6 `service_versions`

- **Purpose:** Immutable localized service facts used as AI authority.
- **Columns:** `id`, `organization_id`, `service_id`, `version_no`,
  `name_i18n jsonb`, `description_i18n jsonb`,
  `duration_guidance_minutes` nullable, `disclaimer_i18n jsonb`,
  generated `search_vector_uz`/`search_vector_ru`/`search_vector_en`,
  `content_hash`, `published_at`, `published_by_user_id`, `created_at`.
- **PK/FKs/tenant:** PK; composite FK to service and publisher.
- **Uniqueness:** (`organization_id`, `service_id`, `version_no`);
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `service_id`, `version_no desc`); GIN on
  each locale search vector for authorized catalog search.
- **Sensitive:** S0.
- **Deletion/RLS:** forced RLS; published versions immutable/restricted.

### 4.7 `service_locations`

- **Purpose:** Declare at which locations a service is offered, without claiming
  time-slot availability.
- **Columns:** `organization_id`, `service_id`, `location_id`,
  `status active|inactive`, `effective_from`, `effective_to`, `created_at`.
- **PK/FKs/tenant:** composite PK
  (`organization_id`, `service_id`, `location_id`, `effective_from`);
  composite same-tenant FKs.
- **Uniqueness:** PK; non-overlapping active intervals enforced by exclusion
  constraint or transaction validation.
- **Indexes:** (`organization_id`, `location_id`, `status`);
  (`organization_id`, `service_id`, `status`).
- **Sensitive:** S0.
- **Deletion/RLS:** forced RLS; close effective interval rather than delete.

### 4.8 `service_prices`

- **Purpose:** Authoritative immutable price/effective version.
- **Columns:** `id`, `organization_id`, `service_id`,
  `location_id nullable`, `price_type fixed|from|range|quote_required`,
  `currency char(3)`, `min_amount_minor bigint nullable`,
  `max_amount_minor bigint nullable`, `display_text_i18n jsonb`,
  `effective_from`, `effective_to nullable`, `status draft|published|retired`,
  `version_no`, `published_by_user_id`, `created_at`.
- **PK/FKs/tenant:** PK; composite FKs to service, optional location, publisher.
- **Uniqueness:** (`organization_id`, `service_id`,
  coalesced `location_id`, `currency`, `version_no`); published effective
  intervals cannot overlap for the same scope/currency.
- **Indexes:** (`organization_id`, `service_id`, `location_id`,
  `status`, `effective_from desc`).
- **Sensitive:** S0 when published.
- **Deletion/RLS:** forced RLS; immutable after publication; retire and retain
  while cited.

### 4.9 `faqs`

- **Purpose:** Versioned authoritative FAQ record.
- **Columns:** `id`, `organization_id`, `faq_key`, `version_no`,
  `service_id nullable`, `location_id nullable`, `question_i18n jsonb`,
  `answer_i18n jsonb`, generated
  `search_vector_uz`/`search_vector_ru`/`search_vector_en`,
  `status draft|published|retired`,
  `effective_from`, `effective_to`, `content_hash`,
  `published_by_user_id`, `created_at`.
- **PK/FKs/tenant:** PK; composite optional service/location and publisher FKs.
- **Uniqueness:** (`organization_id`, `faq_key`, `version_no`); one current
  published version per key/scope by partial unique index.
- **Indexes:** (`organization_id`, `status`, `service_id`, `location_id`,
  `effective_from desc`); GIN on each generated locale search vector. Search
  queries apply the tenant/scope predicate as well as the text index.
- **Sensitive:** S0, but content is untrusted for prompt/tool policy.
- **Deletion/RLS:** forced RLS; published rows immutable/restricted.

### 4.10 `business_policies`

- **Purpose:** Versioned deterministic qualification, required-field, handoff,
  expiry, and approved response/safety configuration.
- **Columns:** `id`, `organization_id`, `policy_key`, `version_no`,
  `policy_type qualification|booking|handoff|safety|consent`,
  `schema_version`, `rules_jsonb`, `status draft|published|retired`,
  `effective_from`, `effective_to`, `content_hash`,
  `published_by_user_id`, `created_at`.
- **PK/FKs/tenant:** PK; FK organization and same-tenant publisher attribution.
- **Uniqueness:** (`organization_id`, `policy_key`, `version_no`); one current
  published version per key/type.
- **Indexes:** (`organization_id`, `policy_type`, `status`,
  `effective_from desc`).
- **Sensitive:** S1; approved public wording inside may be S0.
- **Deletion/RLS:** forced RLS; published versions immutable and retained while
  referenced.

### 4.11 `channel_connections`

- **Purpose:** Tenant-owned configuration for a widget or Telegram adapter.
- **Columns:** `id`, `organization_id`, `channel_type widget|telegram`,
  `status pending|active|disabled|revoked`, `display_name`,
  `provider_account_id_hash`, `credential_secret_ref`,
  `webhook_secret_hash`, `configuration_jsonb`, `verified_at`,
  `credential_version`, common mutable columns.
- **PK/FKs/tenant:** PK; FK organization.
- **Uniqueness:** provider account identity unique per channel where provider
  requires unambiguous routing is enforced through `inbound_routes`, not as a
  cross-tenant customer-identity index here; (`organization_id`, channel type,
  `provider_account_id_hash`); (`organization_id`, normalized display name);
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `channel_type`, `status`).
- **Sensitive:** S3 refs/hashes and S1 configuration. Plain credentials are not
  stored.
- **Deletion/RLS:** forced RLS; disable/revoke then rotate route/secret; restrict
  while messages reference the connection.

### 4.12 `widget_allowed_origins`

- **Purpose:** Exact HTTPS-origin allowlist for a widget connection.
- **Columns:** `id`, `organization_id`, `channel_connection_id`,
  `match_type exact|subdomain_wildcard`, `scheme https`,
  `normalized_host`, `port nullable`, `status active|disabled`,
  `created_by_user_id`, `created_at`.
- **PK/FKs/tenant:** PK; composite FK to widget connection.
- **Uniqueness:** (`organization_id`, `channel_connection_id`, `match_type`,
  `scheme`, `normalized_host`, coalesced `port`) by expression unique index.
- **Indexes:** unique lookup above; (`organization_id`, `status`).
- **Sensitive:** S1 (customer domain inventory).
- **Deletion/RLS:** forced RLS; disable first; hard delete after audit/route
  replay window if unreferenced.

Wildcard matching is opt-in and means one documented subdomain suffix boundary;
it never uses substring matching. `null` origins, non-HTTPS production origins,
IDNA ambiguity, and wildcard ports fail validation.

### 4.13 `widget_sessions`

- **Purpose:** Tenant-owned server-side binding/revocation record for an
  anonymous widget bearer session.
- **Columns:** `id`, `organization_id`, `channel_connection_id`,
  `widget_allowed_origin_id`, `session_token_jti_hash`,
  `participant_lookup_hash`, `status active|expired|revoked`,
  `requested_locale uz|ru|en`, `contact_id nullable`,
  `conversation_id nullable`, `issued_at`, `last_seen_at`, `expires_at`,
  `revoked_at nullable`, `revocation_reason nullable`, common mutable columns.
- **PK/FKs/tenant:** PK; composite tenant FKs to channel connection, allowed
  origin, optional contact, and immutable bound conversation.
- **Uniqueness:** (`organization_id`, `session_token_jti_hash`);
  at most one active (`organization_id`, `channel_connection_id`,
  `participant_lookup_hash`) by partial unique index;
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `expires_at`);
  (`organization_id`, `conversation_id`); exact JTI lookup above.
- **Sensitive:** S2/S3 pseudonymous/token hashes; no raw bearer token, page URL,
  or message content.
- **Deletion/RLS:** forced RLS after route/token tenant resolution. Expire/revoke
  first; purge after replay/abuse window once any durable conversation binding
  is independently retained.

## 5. Contact, lead, and conversation tables

### 5.1 `contacts`

- **Purpose:** Tenant-local person/customer root; it is not a clinical patient
  record and is never globally deduplicated.
- **Columns:** `id`, `organization_id`, protected
  `display_name_ciphertext`, `preferred_locale uz|ru|en nullable`,
  `status active|anonymized|blocked`, `first_seen_at`, `last_seen_at`,
  `anonymized_at`, common mutable columns.
- **PK/FKs/tenant:** PK; FK organization; (`organization_id`, `id`) supports all
  child composite FKs.
- **Uniqueness:** no global or tenant name uniqueness.
- **Indexes:** (`organization_id`, `status`, `last_seen_at desc`).
- **Sensitive:** S2.
- **Deletion/RLS:** forced RLS. Subject erasure clears ciphertext and identities,
  sets `anonymized`, and keeps an opaque ID only while required by audit/funnel
  integrity; final hard purge is hold/retention controlled.

### 5.2 `contact_identities`

- **Purpose:** Channel participant, phone, or email identity for tenant-local
  contact resolution and communication.
- **Columns:** `id`, `organization_id`, `contact_id`,
  `identity_type widget_participant|telegram_user|phone|email`,
  `channel_connection_id nullable`, `value_ciphertext bytea nullable`,
  `lookup_hash bytea`, `hash_key_version`, `display_redacted`,
  `validation_status unverified|valid|verified|invalid`, `verified_at`,
  `status active|withdrawn|anonymized`, common mutable columns.
- **PK/FKs/tenant:** PK; composite FKs to contact and optional channel
  connection.
- **Uniqueness:** (`organization_id`, `identity_type`,
  coalesced `channel_connection_id`, `lookup_hash`) by expression unique index
  for active identities. There is deliberately no global identity uniqueness.
- **Indexes:** (`organization_id`, `contact_id`, `status`); tenant-leading
  exact-hash lookup only.
- **Sensitive:** S2; ciphertext and linkable hashes.
- **Deletion/RLS:** forced RLS. Withdrawal disables use; anonymization removes
  ciphertext/hash. Hard delete only after dependent consent/message routing is
  resolved.

### 5.3 `consent_records`

- **Purpose:** Append-only evidence of a grant, denial, or withdrawal for a
  specific purpose/notice.
- **Columns:** `id`, `organization_id`, `contact_id nullable`,
  `conversation_id nullable`, `contact_identity_id nullable`,
  `purpose booking_follow_up|service_messages|analytics_optional|marketing`,
  `status granted|declined|withdrawn|not_required`,
  `lawful_basis_code nullable`, `notice_key`, `notice_version`,
  `policy_url nullable`, `locale uz|ru|en`,
  `capture_channel widget|telegram|staff`,
  `channel_connection_id nullable`,
  `source_message_id nullable`, `captured_by_type customer|member|system`,
  `captured_by_id nullable`, `captured_at`, `withdrawn_at nullable`,
  `supersedes_consent_id nullable`, `evidence_hash`,
  protected `evidence_ciphertext nullable`, `created_at`.
- **PK/FKs/tenant:** PK; composite tenant FKs to optional contact,
  conversation, contact identity, connection, source message, and superseded
  consent. A check requires at least one tenant-local subject anchor
  (contact/identity/conversation).
- **Uniqueness:** optional source-event dedupe
  (`organization_id`, `contact_id`, `purpose`, `source_message_id`,
  `status`) where source exists; (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `contact_id`, `purpose`,
  `captured_at desc`); (`organization_id`, `contact_identity_id`, `purpose`,
  `captured_at desc`); (`organization_id`, `purpose`, `status`).
- **Sensitive:** S2; evidence may contain IP/channel metadata.
- **Deletion/RLS:** forced RLS; append-only. Retain/minimize according to legal
  policy; withdrawal does not delete the evidence of the prior grant.

### 5.4 `leads`

- **Purpose:** Commercial lifecycle and source attribution for one tenant-local
  contact/opportunity.
- **Columns:** `id`, `organization_id`, `contact_id`,
  `status new|engaged|qualified|booking_requested|converted|disqualified|closed`,
  `source_channel_connection_id`, `campaign_key nullable`,
  `service_id nullable`, `location_id nullable`,
  `assigned_membership_id nullable`, `qualification_policy_id nullable`,
  `qualification_reason_codes text[]`, milestone timestamps
  (`engaged_at`, `qualified_at`, `booking_requested_at`, `converted_at`,
  `closed_at`), `closed_reason`, common mutable columns.
- **PK/FKs/tenant:** PK; composite tenant FKs to contact, connection, service,
  location, assignment, and policy version.
- **Uniqueness:** (`organization_id`, `id`); a partial unique active-lead key
  must follow the product decision on campaign/service scope and is not invented
  before that question is resolved.
- **Indexes:** (`organization_id`, `status`, `updated_at desc`);
  (`organization_id`, `contact_id`, `created_at desc`);
  (`organization_id`, `assigned_membership_id`, `status`);
  funnel milestone indexes as measured.
- **Sensitive:** S1/S2 by association; reason codes are structured, not medical
  notes.
- **Deletion/RLS:** forced RLS; close rather than delete. Contact erasure
  preserves pseudonymous funnel facts; hard purge follows policy.

### 5.5 `lead_qualification_evaluations`

- **Purpose:** Immutable deterministic qualification result and evidence
  snapshot.
- **Columns:** `id`, `organization_id`, `lead_id`, `business_policy_id`,
  `result qualified|disqualified|incomplete`, `reason_codes text[]`,
  `facts_jsonb` (schema-valid administrative fields),
  `evaluated_by system|member`, `member_id nullable`, `occurred_at`.
- **PK/FKs/tenant:** PK; composite FKs to lead, policy, optional member.
- **Uniqueness:** (`organization_id`, `lead_id`, `id`); command/event
  idempotency is enforced through the shared idempotency record.
- **Indexes:** (`organization_id`, `lead_id`, `occurred_at desc`);
  (`organization_id`, `business_policy_id`).
- **Sensitive:** S2; facts must exclude diagnosis/clinical details and are
  encrypted as a field if launch facts contain sensitive free text.
- **Deletion/RLS:** forced RLS; immutable; redact fact payload on retention while
  retaining result/policy/reason codes where allowed.

### 5.6 `lead_qualification_evidence`

- **Purpose:** Relationally bind each qualification field/reason to the
  same-tenant source message(s), without trusting a UUID array.
- **Columns:** `organization_id`, `evaluation_id`, `message_id`,
  `field_key`, `evidence_kind customer_statement|staff_entry|derived`,
  `created_at`.
- **PK/FKs/tenant:** composite PK (`organization_id`, `evaluation_id`,
  `message_id`, `field_key`); composite tenant FKs to evaluation and message.
- **Uniqueness:** PK.
- **Indexes:** (`organization_id`, `message_id`, `evaluation_id`) reverse
  provenance lookup.
- **Sensitive:** S1; no copied message text or extracted value.
- **Deletion/RLS:** forced RLS; immutable; retained/tombstoned with evaluation
  and message provenance policy.

### 5.7 `conversations`

- **Purpose:** Provider-neutral conversation root and response-ownership state.
- **Columns:** `id`, `organization_id`, `contact_id`, `lead_id`,
  `channel_connection_id`, `external_thread_hash nullable`,
  `status open|awaiting_lead|awaiting_staff|resolved|closed`,
  `preferred_locale uz|ru|en`, `automation_mode ai|staff|paused`,
  `next_sequence_no bigint`, `started_at`, `last_activity_at`,
  `resolved_at`, `closed_at`, common mutable columns.
- **PK/FKs/tenant:** PK; composite FKs to contact, lead, connection.
- **Uniqueness:** (`organization_id`, `channel_connection_id`,
  `external_thread_hash`, `id`) is not enough to define active grouping; use a
  partial unique provider/session key after channel grouping policy is fixed.
  (`organization_id`, `id`) always unique.
- **Indexes:** (`organization_id`, `status`, `last_activity_at desc`);
  (`organization_id`, `lead_id`, `started_at desc`);
  (`organization_id`, `channel_connection_id`, `last_activity_at desc`).
- **Sensitive:** S1/S2 by association; thread hashes are pseudonymous.
- **Deletion/RLS:** forced RLS; resolve/close for lifecycle. Payload deletion
  occurs through messages; conversation shell may remain for funnel/audit.

Conversation/handoff coupling is explicit and transactional. A requested
handoff sets `awaiting_staff + paused`; assignment or work in progress sets
`awaiting_staff + staff`; an explicit AI-resume disposition sets `open + ai`;
conversation resolution sets `resolved + paused`; and conversation closure
sets `closed + paused`. Cancelling, expiring, or resolving a handoff never
selects a conversation outcome by default and never implicitly resumes AI.

### 5.8 `messages`

- **Purpose:** Canonical immutable inbound/outbound/staff-internal message and
  processing/delivery metadata.
- **Columns:** `id`, `organization_id`, `conversation_id`,
  `channel_connection_id`, `direction inbound|outbound|staff_internal`,
  `sender_type customer|member|system`, `sender_contact_id nullable`,
  `sender_membership_id nullable`, `sequence_no bigint`,
  `external_event_id nullable`, `external_message_id nullable`,
  `external_sent_at nullable`, `external_sequence nullable`,
  `content_type text`, protected `body_ciphertext bytea nullable`,
  `body_hash bytea`, `locale uz|ru|en nullable`,
  `processing_status accepted|processing|processed|failed|suppressed`,
  `delivery_status not_applicable|queued|sent|delivered|failed`,
  `reply_to_message_id nullable`, `ai_run_id nullable`,
  `knowledge_manifest_jsonb nullable`, `redacted_at nullable`, `created_at`.
- **PK/FKs/tenant:** PK; composite tenant FKs to conversation, connection,
  optional sender, reply, and AI run. The schema creates messages first, creates
  `ai_runs` with its trigger-message FK, then adds the message-to-AI-run FK;
  inbound trigger messages have no `ai_run_id` and generated outbound messages
  reference their completed/validated run.
- **Uniqueness:** (`organization_id`, `conversation_id`, `sequence_no`);
  partial unique (`organization_id`, `channel_connection_id`,
  `external_message_id`) when non-null; similarly external event where the
  provider guarantees message-level identity; (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `conversation_id`, `sequence_no`);
  (`organization_id`, `processing_status`, `created_at`);
  (`organization_id`, `delivery_status`, `created_at`);
  no general plaintext body index.
- **Sensitive:** S2; body and customer identifiers encrypted/protected. Hashes
  are linkable and access-controlled.
- **Deletion/RLS:** forced RLS. Body ciphertext is tombstoned on expiry/erasure;
  minimal immutable envelope/dedupe metadata remains as policy allows.

The widget adapter normalizes API `client_message_id` into
`external_message_id`. Therefore its documented
`(organization_id, channel_connection_id, client_message_id)` uniqueness is
the same physical message unique key, not a second field or dedupe system.

## 6. Booking and outcome tables

### 6.1 `appointment_requests`

- **Purpose:** Authoritative human-reviewed request and current booking state.
- **Columns:** `id`, `organization_id`, `lead_id`, `contact_id`,
  `conversation_id`, `source_message_id`, `service_id`,
  `service_version_id`, `location_id`, `location_version_id`,
  `business_policy_id`,
  `status requested|staff_accepted|awaiting_customer_confirmation|confirmed|rejected|cancelled|expired`,
  `request_dedupe_key`, `customer_notes_ciphertext`,
  `staff_decided_by_membership_id nullable`, `staff_decided_at nullable`,
  `staff_decision_reason_code nullable`,
  offered `start_at`/`end_at` nullable, `offered_time_zone nullable`,
  `offered_local_start nullable`, `offer_version integer default 0`,
  `confirmation_issued_at nullable`, `offer_expires_at nullable`,
  `confirmation_token_hash nullable`,
  `confirmation_token_consumed_at nullable`, `confirmed_at nullable`,
  `confirmation_source nullable`,
  `rejection_reason_code`, `cancellation_reason_code`,
  `cancelled_by_type nullable`, `expired_at`, common mutable columns.
- **PK/FKs/tenant:** PK; composite FKs to every tenant-owned lead/contact/
  conversation/message/service/version/location/version/policy/member
  reference. Database checks ensure `start_at < end_at` and, when a
  confirmation capability exists, `confirmation_issued_at < offer_expires_at`.
  A confirmation command must match both the locked request aggregate version
  and its current `offer_version`. Its explicit clock instant is valid only in
  the half-open interval `[confirmation_issued_at, offer_expires_at)`; equality
  with `offer_expires_at` is expired.
- **Uniqueness:** (`organization_id`, `request_dedupe_key`);
  partial unique (`organization_id`, `source_message_id`) when one source
  message is the submission; partial unique `confirmation_token_hash` when
  non-null; (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `created_at`);
  (`organization_id`, `location_id`, `status`, `created_at`);
  (`organization_id`, `lead_id`, `created_at desc`);
  (`organization_id`, `offer_expires_at`) for awaiting states;
  (`organization_id`, `staff_decided_by_membership_id`, `staff_decided_at`).
- **Sensitive:** S2 notes/contact association; S3 token hash.
- **Deletion/RLS:** forced RLS; status lifecycle, not deletion. Notes/token are
  tombstoned after retention; authoritative transitions/outcome IDs retained
  according to policy. Hard delete is restricted by audit/outcome rows.

### 6.2 `appointment_request_preferences`

- **Purpose:** One or more original customer-preferred time windows, explicitly
  not availability.
- **Columns:** `id`, `organization_id`, `appointment_request_id`,
  `preference_order smallint`, `start_at nullable`, `end_at nullable`,
  `time_zone`, `original_local_text_ciphertext nullable`,
  `local_start nullable`, `local_end nullable`,
  `precision exact|part_of_day|date_only|free_text`, `created_at`.
- **PK/FKs/tenant:** PK; composite FK to request; checks for chronology and
  required fields per precision.
- **Uniqueness:** (`organization_id`, `appointment_request_id`,
  `preference_order`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `appointment_request_id`,
  `preference_order`); optional (`organization_id`, `start_at`).
- **Sensitive:** S2 original text; normalized times S1.
- **Deletion/RLS:** forced RLS; inseparable child but restricted after request
  audit exists; original text may be tombstoned.

### 6.3 `appointment_request_transitions`

- **Purpose:** Append-only state-transition ledger.
- **Columns:** `id`, `organization_id`, `appointment_request_id`,
  `from_status nullable`, `to_status`, `aggregate_version bigint`,
  `actor_type customer|member|system`, `actor_contact_id nullable`,
  `actor_membership_id nullable`, `reason_code nullable`,
  `source_message_id nullable`, `correlation_id`, `occurred_at`,
  `metadata_jsonb` (bounded/redacted).
- **PK/FKs/tenant:** PK; composite FKs to request and optional actor/source.
- **Uniqueness:** (`organization_id`, `appointment_request_id`,
  `aggregate_version`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `appointment_request_id`,
  `occurred_at`); (`organization_id`, `to_status`, `occurred_at`).
- **Sensitive:** S1; metadata cannot contain message body/contact values.
- **Deletion/RLS:** forced RLS; append-only; retain with request/audit policy.

### 6.4 `appointment_confirmation_evidence`

- **Purpose:** Immutable evidence of customer confirm/decline for an exact offer,
  including staff attestation of an external customer act.
- **Columns:** `id`, `organization_id`, `appointment_request_id`,
  `offer_version`, `outcome confirmed|declined`,
  `source customer_session|telegram|staff_attested_external`,
  `customer_contact_id`, `recorded_by_membership_id nullable`,
  `source_message_id nullable`, `external_reference_hash nullable`,
  `customer_acted_at`, `recorded_at`,
  `attestation_method phone|in_person nullable`,
  `attestation_reason_code nullable`,
  protected `evidence_ciphertext nullable`, `correlation_id`.
- **PK/FKs/tenant:** PK; composite FKs to request, customer contact, optional
  member/message.
- **Uniqueness:** one accepted outcome command per
  (`organization_id`, `appointment_request_id`, `offer_version`) by partial
  unique index; external reference unique within organization/source when
  non-null; (`organization_id`, `id`).
- **Checks:** staff-attested source requires member, method, reason, and no claim
  that staff acceptance was customer confirmation; direct sources prohibit
  attestation fields. The command's expected aggregate version and offer
  version must both equal the locked current request during the confirmation
  transaction. Evidence persists the accepted offer version; the transition
  ledger persists the resulting aggregate version.
- **Indexes:** (`organization_id`, `appointment_request_id`,
  `recorded_at desc`); (`organization_id`, `source`, `recorded_at`).
- **Sensitive:** S2 evidence and S1 actor metadata.
- **Deletion/RLS:** forced RLS; append-only. Tombstone evidence ciphertext
  according to policy while retaining source/actor/outcome provenance when
  lawful.

### 6.5 `appointment_request_attendance`

- **Purpose:** P0 manual, correctable attendance outcome; not a request status.
- **Columns:** `id`, `organization_id`, `appointment_request_id`,
  `outcome attended|did_not_attend|unknown`, `occurred_at nullable`,
  `recorded_by_membership_id`, `recorded_at`,
  `source staff_manual|approved_import`, `is_current boolean`,
  `supersedes_id nullable`, `reason_code nullable`.
- **PK/FKs/tenant:** PK; composite FKs to request, member, and superseded row.
- **Uniqueness:** one current row per
  (`organization_id`, `appointment_request_id`) by partial unique index;
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `outcome`, `occurred_at`);
  (`organization_id`, `appointment_request_id`, `recorded_at desc`).
- **Sensitive:** S1; attendance may be sensitive by association but stores no
  clinical detail.
- **Deletion/RLS:** forced RLS; immutable correction chain. Retention and
  erasure follow outcome/legal policy; no in-place rewrite.

### 6.6 `appointment_revenue_attributions`

- **Purpose:** P0 manual revenue facts linked to a confirmed request for ROI;
  not billing authority.
- **Columns:** `id`, `organization_id`, `appointment_request_id`,
  `amount_minor bigint`, `currency char(3)`,
  `entry_type charge|adjustment|reversal`, `category_code`,
  `recognized_at`, `recorded_by_membership_id`, `recorded_at`,
  `source staff_manual|approved_import`,
  `reverses_attribution_id nullable`, `external_reference_hash nullable`,
  `reason_code nullable`.
- **PK/FKs/tenant:** PK; composite FKs to request, member, and reversed entry.
- **Uniqueness:** approved-import external reference unique per tenant/source
  when supplied; a row can be reversed at most once by partial unique index on
  `reverses_attribution_id`; (`organization_id`, `id`).
- **Checks:** currency format; positive charge/adjustment amounts under initial
  policy; reversal references a same-currency entry and deterministic service
  computes signed reporting effect.
- **Indexes:** (`organization_id`, `recognized_at`, `currency`);
  (`organization_id`, `appointment_request_id`, `recorded_at`).
- **Sensitive:** S1/S2 commercial data; no card/payment/clinical data.
- **Deletion/RLS:** forced RLS; corrections/reversals append, not update/delete.
  Retain per financial/privacy policy and never sum unlike currencies.

## 7. Handoff and notification tables

### 7.1 `handoffs`

- **Purpose:** Current accountable human-handoff state for a conversation.
- **Columns:** `id`, `organization_id`, `conversation_id`, `lead_id`,
  `location_id nullable`, `status requested|assigned|in_progress|resolved|cancelled|expired`,
  `trigger_reason customer_requested|missing_authoritative_information|medical_or_safety|low_confidence|policy_blocked|ai_unavailable|delivery_problem|staff_created|other`,
  `queue_key`, `assigned_membership_id nullable`, `requested_at`,
  `assigned_at`, `started_at`, `sla_due_at`, `resolved_at`,
  `resolution_code nullable`, common mutable columns.
- **PK/FKs/tenant:** PK; composite tenant FKs to conversation, lead, optional
  location/member.
- **Uniqueness:** one active handoff per conversation by partial unique index on
  (`organization_id`, `conversation_id`) where status in
  `requested|assigned|in_progress`; (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `sla_due_at`);
  (`organization_id`, `queue_key`, `status`, `requested_at`);
  (`organization_id`, `assigned_membership_id`, `status`).
- **Sensitive:** S1; trigger reason must be categorical, not copied customer
  content.
- **Deletion/RLS:** forced RLS; lifecycle terminal states, append-only history
  retained; hard deletion follows conversation policy.

### 7.2 `handoff_transitions`

- **Purpose:** Append-only handoff state/assignment history.
- **Columns:** `id`, `organization_id`, `handoff_id`,
  `from_status nullable`, `to_status`, `aggregate_version`,
  `actor_type customer|member|system`, optional actor contact/member,
  `from_assignee_id nullable`, `to_assignee_id nullable`,
  `conversation_disposition resume_ai|resolve_conversation|successor_handoff nullable`,
  `reason_code nullable`, `correlation_id`, `occurred_at`.
- **PK/FKs/tenant:** PK; composite FKs to handoff and optional actors/assignees.
- **Uniqueness:** (`organization_id`, `handoff_id`, `aggregate_version`);
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `handoff_id`, `occurred_at`);
  (`organization_id`, `to_assignee_id`, `occurred_at desc`).
- **Checks:** reassignment is a real `assigned -> assigned` transition that
  increments `aggregate_version` and requires distinct non-null
  `from_assignee_id` and `to_assignee_id`. Its domain event carries the new
  assignee only; this transition row preserves both old and new assignee
  provenance. A terminal handoff transition records exactly one explicit
  conversation disposition: `resume_ai`, `resolve_conversation`, or
  `successor_handoff`; there is no default disposition. Non-terminal transition
  rows require `conversation_disposition` to be null.
- **Sensitive:** S1.
- **Deletion/RLS:** forced RLS; immutable; retained with handoff/audit.

### 7.3 `notifications`

- **Purpose:** Durable notification intent. P0 staff notifications are
  authoritative in-app tasks; optional outbound alerts use the same intent.
- **Columns:** `id`, `organization_id`,
  `notification_type staff_task|customer_message|staff_alert`,
  `audience_type membership|queue|contact`,
  `recipient_membership_id nullable`, `recipient_contact_id nullable`,
  `queue_key nullable`, `related_resource_type`, `related_resource_id`,
  `template_key`, `template_version`, protected
  `payload_ciphertext nullable`,
  `status pending|processing|delivered|failed|dead_lettered|cancelled`,
  `dedupe_key`, `available_at`, `attempt_count`, `next_attempt_at`,
  `delivered_at`, `read_at nullable`, `claimed_by_membership_id nullable`,
  `last_error_category nullable`, common mutable columns.
- **PK/FKs/tenant:** PK; composite tenant FKs to explicit recipients/claimer.
  Resource type/ID is polymorphic and must be ownership-validated by the
  creating service; the originating outbox event is also stored.
- **Uniqueness:** (`organization_id`, `dedupe_key`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `available_at`);
  (`organization_id`, `queue_key`, `status`, `created_at`);
  (`organization_id`, `recipient_membership_id`, `read_at`, `created_at desc`).
- **Sensitive:** S1/S2 encrypted payload. In-app list projections expose only
  authorized resource summaries.
- **Deletion/RLS:** forced RLS; delivered task metadata expires per policy;
  related domain state is never cascaded from notification deletion.

### 7.4 `notification_attempts`

- **Purpose:** Immutable per-adapter delivery attempt telemetry.
- **Columns:** `id`, `organization_id`, `notification_id`,
  `adapter in_app|widget|telegram|email|sms|push`,
  `attempt_no integer`, `provider_request_key`,
  `started_at`, `finished_at`, `outcome delivered|retryable_failure|permanent_failure`,
  `provider_status_code nullable`, `error_category nullable`,
  `provider_message_id_hash nullable`, `latency_ms`.
- **PK/FKs/tenant:** PK; composite FK to notification.
- **Uniqueness:** (`organization_id`, `notification_id`, `adapter`,
  `attempt_no`); stable provider request key unique per tenant/adapter.
- **Indexes:** (`organization_id`, `notification_id`, `attempt_no`);
  (`organization_id`, `outcome`, `finished_at`).
- **Sensitive:** S1; provider IDs are hashed; never store provider response body
  or secret.
- **Deletion/RLS:** forced RLS; immutable; operational retention can be shorter
  than notification/domain history.

## 8. AI governance tables

### 8.1 `ai_runs`

- **Purpose:** Auditable lifecycle, provenance, safety, latency, and cost for one
  model invocation.
- **Columns:** `id`, `organization_id`, `conversation_id`,
  `trigger_message_id`, `expected_conversation_version`,
  `provider_id`, `requested_model_id`, `model_profile_version`,
  `provider_resolved_model_id`, `orchestrator_version`,
  `prompt_template_version`, `decision_schema_version`,
  `policy_version`, `status started|succeeded|failed|schema_rejected|policy_denied|stale`,
  nullable `input_units`, `output_units`, `cached_input_units`,
  `reasoning_units nullable`, `total_units nullable`,
  `estimated_cost_micros bigint nullable`, `cost_currency`,
  `cost_catalog_version`,
  `latency_ms`, `attempt_no`, `failure_category`,
  `knowledge_manifest_jsonb`, `input_hash`, `output_hash`,
  protected `input_snapshot_ciphertext nullable`,
  protected `output_snapshot_ciphertext nullable`,
  `snapshot_capture_policy_id nullable`,
  `schema_valid boolean nullable`, `policy_allowed boolean nullable`,
  `started_at`, `finished_at`,
  `correlation_id`.
- **PK/FKs/tenant:** PK; composite tenant FKs to conversation/message/policy.
- **Uniqueness:** (`organization_id`, `trigger_message_id`, `attempt_no`,
  `provider_id`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `conversation_id`, `started_at desc`);
  (`organization_id`, `status`, `started_at`);
  (`organization_id`, `requested_model_id`, `started_at`) for cost/latency
  aggregates.
- **Sensitive:** S1 plus S2 encrypted snapshots. Prompt/output is never standard
  log data. Snapshot columns are NULL/disabled by default in production and may
  be populated only by an explicit tenant/legal/consent-compatible,
  short-retention capture policy. Cost uses integer millionths of the named
  currency to avoid rounding sub-cent runs to zero; it is telemetry, not billing
  authority. `cost_catalog_version` pins the rates used.
- **Deletion/RLS:** forced RLS. Tombstone snapshots on short AI-payload
  retention; retain minimized usage/status/hash facts per policy.

`requested_model_id` and `model_profile_version` identify the pinned configured
model/profile; `provider_resolved_model_id` records what the provider reports.
A floating `latest` alias alone is invalid in production.
All usage-unit columns are nonnegative. `reasoning_units` is populated only
when the provider reports that category. `total_units` stores a provider-
reported total or a versioned deterministic derivation; it is not naively summed
from overlapping categories and is not billing authority. The pinned cost
catalog maps provider-specific categories exactly once when estimating cost.
Unknown usage or price is NULL, never zero; `estimated_cost_micros` is NULL when
a complete versioned estimate cannot be computed. `schema_valid` is NULL until
schema validation occurs, and `policy_allowed` is NULL until policy evaluation
occurs, so started/provider-failed runs cannot be mistaken for a negative
decision.

### 8.2 `ai_action_evaluations`

- **Purpose:** Record the one V1 schema-constrained proposed action and its
  independent application validation/outcome. This is not provider tool
  execution; V1 sends `tools: []`.
- **Columns:** `id`, `organization_id`, `ai_run_id`,
  `action_name none|request_information|create_appointment_request|confirm_appointment|decline_appointment|request_handoff`,
  `action_schema_version`, `proposal_hash`,
  protected `arguments_ciphertext`, `validation_status pending|allowed|denied|malformed`,
  `policy_reason_code`, `application_status not_applied|applied|failed|stale`,
  `target_aggregate_type nullable`, `target_aggregate_id nullable`,
  `result_hash nullable`, protected `result_ciphertext nullable`,
  `started_at`, `finished_at`.
- **PK/FKs/tenant:** PK; composite FK to AI run.
- **Uniqueness:** (`organization_id`, `ai_run_id`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `action_name`, `validation_status`,
  `started_at`); unique run lookup above.
- **Sensitive:** S1/S2; arguments/results encrypted and minimized.
- **Deletion/RLS:** forced RLS; snapshots tombstoned with AI payload policy;
  decision and denial metadata retained for safety evaluation.

## 9. Reliability and integration tables

### 9.1 `webhook_receipts`

- **Purpose:** Authenticate, deduplicate, order, and track provider/webhook
  processing without rerunning effects.
- **Columns:** `id`, `organization_id`, `channel_connection_id`,
  `provider`, `external_event_id`, `external_message_id nullable`,
  `payload_hash`, protected `payload_ciphertext nullable`,
  `signature_verified_at`, `provider_sent_at nullable`,
  `provider_sequence nullable`,
  `status received|processing|processed|retryable_failure|permanent_failure`,
  `attempt_count`, `next_attempt_at`, `processed_message_id nullable`,
  `first_received_at`, `last_received_at`, `correlation_id`,
  `last_error_category nullable`.
- **PK/FKs/tenant:** PK; composite FKs to connection and optional message.
- **Uniqueness:** (`organization_id`, `channel_connection_id`,
  `external_event_id`); partial unique external message key where provider
  guarantees it; (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `next_attempt_at`);
  (`organization_id`, `channel_connection_id`, `provider_sent_at`).
- **Sensitive:** S1/S2 encrypted raw payload; signature value itself is not
  retained.
- **Deletion/RLS:** forced RLS. Tombstone raw payload after short replay/debug
  period; retain hashes/IDs/status long enough to prevent duplicates under the
  provider replay window.

### 9.2 `idempotency_keys`

- **Purpose:** Return the same result for repeated application/API commands and
  reject key reuse with a different request.
- **Columns:** `id`, `organization_id`, `scope`, `key_hash`,
  `principal_type user|widget_session|channel_participant|system`,
  `principal_id_hash`, `request_hash`,
  `status in_progress|succeeded|failed`,
  `response_status nullable`, protected `response_ciphertext nullable`,
  `resource_type nullable`, `resource_id nullable`, `locked_until nullable`,
  `expires_at`, `created_at`, `completed_at`.
- **PK/FKs/tenant:** PK; FK organization; polymorphic resource ownership is
  validated before insert.
- **Uniqueness:** (`organization_id`, `principal_type`, `principal_id_hash`,
  `scope`, `key_hash`);
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `expires_at`);
  (`organization_id`, `status`, `locked_until`).
- **Sensitive:** S1/S2 response snapshot; plaintext client key is never stored.
- **Deletion/RLS:** forced RLS. Purge after the documented maximum retry/replay
  window, never sooner than the API's 24-hour V1 replay guarantee; domain
  uniqueness remains the final defense.

### 9.3 `outbox_events`

- **Purpose:** Atomically persist domain/integration events and asynchronously
  deliver side effects.
- **Columns:** `id`, `organization_id`, `event_type`, `schema_version`,
  `aggregate_type`, `aggregate_id`, `aggregate_version`,
  `payload_jsonb` (minimal/schema-valid), `correlation_id`, `causation_id`,
  `occurred_at`, `status pending|processing|published|dead_lettered`,
  `attempt_count`, `available_at`, `locked_by`, `locked_until`,
  `published_at`, `last_error_category`.
- **PK/FKs/tenant:** PK; FK organization. Aggregate reference is polymorphic and
  validated by the writer. Platform-only events use a separate control-plane
  outbox rather than nullable tenant ownership.
- **Uniqueness:** (`organization_id`, `aggregate_type`, `aggregate_id`,
  `aggregate_version`, `event_type`); (`organization_id`, `id`).
- **Indexes:** partial (`status`, `available_at`, `id`) for workers plus
  tenant-leading audit/query index (`organization_id`, `occurred_at desc`);
  (`locked_until`) for abandoned lease recovery.
- **Sensitive:** S1; payload explicitly excludes raw message, PII, secrets, and
  unrestricted model content.
- **Deletion/RLS:** forced RLS for tenant readers/writers. A dedicated worker
  claims work through a reviewed function/role, sets per-item tenant context,
  and cannot query application tables outside that tenant. Published rows are
  retained through consumer replay window then purged; dead letters require
  resolution/audit.

## 10. Governance, privacy, and analytics tables

### 10.1 `audit_events`

- **Purpose:** Append-only tenant-visible security and administrative audit
  trail.
- **Columns:** `id`, `organization_id`, `event_type`,
  `actor_type customer|member|system|platform_operator`,
  `actor_id nullable`, `actor_membership_id nullable`,
  `impersonation_session_id nullable`, `support_grant_id nullable`,
  `target_type`, `target_id nullable`, `action`,
  `result succeeded|denied|failed`, `reason_code nullable`,
  `request_id`, `trace_id nullable`, `correlation_id`,
  `source_ip_prefix nullable`, `user_agent_hash nullable`,
  `metadata_redacted_jsonb` (allowlisted field names and redacted values only),
  `occurred_at`.
- **PK/FKs/tenant:** PK; FK organization. Actor/target are deliberately
  polymorphic to preserve events after anonymization; optional
  `actor_membership_id` uses a composite tenant FK, while application validates
  other ownership at write time.
- **Uniqueness:** (`organization_id`, `id`); optional originating command/event
  ID unique when supplied.
- **Indexes:** (`organization_id`, `occurred_at desc`);
  (`organization_id`, `target_type`, `target_id`, `occurred_at desc`);
  (`organization_id`, `actor_type`, `actor_id`, `occurred_at desc`);
  BRIN on `occurred_at` after volume justifies it.
- **Sensitive:** S1/S2; allowlisted metadata only, never secrets/raw content.
  Source IP is a justified truncated prefix and user-agent is keyed-hashed;
  neither field stores the raw value.
- **Deletion/RLS:** forced RLS with an additional `audit.read` permission in
  application policy. Append-only DB grants; retention/legal hold controlled.

### 10.2 `platform_audit_events`

- **Purpose:** Separate record of platform-operator/support actions, including
  just-in-time access to a tenant.
- **Columns:** `id`, `operator_principal_id`, `action`,
  `target_organization_id nullable`, `target_type`, `target_id nullable`,
  `approval_reference`, `reason_code`, `result`, `request_id`,
  `source_ip_hash`, `occurred_at`, redacted `metadata_jsonb`.
- **PK/FKs/tenant:** PK; control-plane table; optional FK organization.
- **Uniqueness:** event ID; approval reference plus action may be unique where
  the support workflow guarantees it.
- **Indexes:** (`operator_principal_id`, `occurred_at desc`);
  (`target_organization_id`, `occurred_at desc`).
- **Sensitive:** S1/S2 security data.
- **Deletion/RLS:** no tenant runtime access and no ordinary mutations; append
  through dedicated audited role. A corresponding tenant `audit_events` fact is
  written when a tenant resource is accessed. Long security retention/hold.

### 10.3 `privacy_requests`

- **Purpose:** Track subject access/export, correction, restriction, and
  erasure workflows.
- **Columns:** `id`, `organization_id`, `contact_id nullable`,
  `request_type access|export|correct|restrict|erase`,
  `status received|identity_verification|in_progress|completed|rejected|cancelled`,
  `requested_at`, `due_at`, `verified_at`, `completed_at`,
  `request_channel`, `handled_by_membership_id nullable`,
  `reason_code nullable`, protected `request_details_ciphertext`,
  `export_artifact_ref nullable`, `artifact_expires_at nullable`,
  `legal_hold_blocked boolean`, common mutable columns.
- **PK/FKs/tenant:** PK; composite tenant FKs to contact/handler.
- **Uniqueness:** external request/reference key unique per tenant if present;
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `due_at`);
  (`organization_id`, `contact_id`, `requested_at desc`).
- **Sensitive:** S2/S3 artifact reference.
- **Deletion/RLS:** forced RLS and narrow privacy permission. Request evidence
  retained by applicable law; export artifacts are encrypted, short-lived, and
  deleted on expiry.

### 10.4 `legal_holds`

- **Purpose:** Prevent policy-driven deletion for a scoped tenant/subject/data
  class.
- **Columns:** `id`, `organization_id`,
  `scope_type organization|contact|conversation|appointment_request|data_class`,
  `scope_id nullable`, `data_class nullable`, `status active|released`,
  protected `reason_ciphertext`, `placed_by_user_id`, `placed_at`,
  `released_by_user_id nullable`, `released_at nullable`,
  `approval_reference`.
- **PK/FKs/tenant:** PK; FK organization. Polymorphic scope is ownership-checked
  and limited by a check constraint.
- **Uniqueness:** at most one equivalent active hold by partial unique index;
  (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `status`, `scope_type`, `scope_id`);
  (`organization_id`, `data_class`, `status`).
- **Sensitive:** S2 legal/security information.
- **Deletion/RLS:** forced RLS and privileged legal/privacy permission. Release,
  never delete, until legal retention permits.

### 10.5 `analytics_events`

- **Purpose:** Versioned, privacy-minimized fact projection for funnel and
  operational analysis; never transactional authority.
- **Columns:** `id`, `organization_id`, `source_event_id`, `event_type`,
  `schema_version`, `occurred_at`, optional `lead_id`, `conversation_id`,
  `appointment_request_id`, `channel_type`, `locale uz|ru|en nullable`,
  `campaign_key nullable`, `service_id nullable`, `location_id nullable`,
  `confirmation_source nullable`, `dimensions_jsonb` (allowlisted),
  `numeric_value_minor nullable`, `currency nullable`, `projected_at`.
- **PK/FKs/tenant:** PK; FK organization and optional composite tenant FKs to
  subjects while retained. The source event is an outbox event ID or stable
  domain event identifier.
- **Uniqueness:** (`organization_id`, `source_event_id`, `event_type`,
  `schema_version`); (`organization_id`, `id`).
- **Indexes:** (`organization_id`, `occurred_at`, `event_type`);
  (`organization_id`, `lead_id`, `occurred_at`);
  (`organization_id`, `appointment_request_id`, `occurred_at`);
  optional BRIN/partitioning only after measured volume.
- **Sensitive:** S1/pseudonymous. No raw content, phone/email, name, provider
  participant ID, prompt, or high-cardinality arbitrary text.
- **Deletion/RLS:** forced RLS. Subject erasure nulls/pseudonymizes subject IDs
  when legally required while aggregate facts may remain; retention policy
  purges old events. Reprojection is idempotent and canonical tables win.

## 11. Entity-relationship diagrams

The diagrams show ownership/cardinality, not every column. Every tenant
relationship shown is implemented as a composite
`(organization_id, foreign_id)` FK even where Mermaid displays only the entity
link.

### 11.1 Tenant, knowledge, and customer workflow

~~~mermaid
erDiagram
    USERS ||--o{ AUTH_SESSIONS : authenticates
    ORGANIZATIONS ||--o{ MEMBERSHIPS : has
    USERS ||--o{ MEMBERSHIPS : joins
    ORGANIZATIONS ||--o{ RETENTION_POLICIES : versions
    RETENTION_POLICIES ||--o{ RETENTION_POLICY_RULES : contains
    MEMBERSHIPS ||--o{ MEMBERSHIP_LOCATION_SCOPES : scoped_by
    ORGANIZATIONS ||--o{ LOCATIONS : owns
    LOCATIONS ||--o{ LOCATION_VERSIONS : versions
    LOCATION_VERSIONS ||--o{ LOCATION_BUSINESS_HOURS : contains
    LOCATIONS ||--o{ LOCATION_CLOSURES : overrides
    LOCATIONS ||--o{ MEMBERSHIP_LOCATION_SCOPES : permits
    ORGANIZATIONS ||--o{ SERVICES : owns
    SERVICES ||--o{ SERVICE_VERSIONS : versions
    SERVICES ||--o{ SERVICE_LOCATIONS : offered_at
    LOCATIONS ||--o{ SERVICE_LOCATIONS : offers
    SERVICES ||--o{ SERVICE_PRICES : priced_by
    LOCATIONS o|--o{ SERVICE_PRICES : overrides
    ORGANIZATIONS ||--o{ FAQS : owns
    ORGANIZATIONS ||--o{ BUSINESS_POLICIES : owns
    ORGANIZATIONS ||--o{ CHANNEL_CONNECTIONS : owns
    CHANNEL_CONNECTIONS ||--o{ WIDGET_ALLOWED_ORIGINS : allows
    CHANNEL_CONNECTIONS ||--o{ WIDGET_SESSIONS : serves
    WIDGET_ALLOWED_ORIGINS ||--o{ WIDGET_SESSIONS : binds
    CHANNEL_CONNECTIONS ||--o{ INBOUND_ROUTES : routed_by
    ORGANIZATIONS ||--o{ CONTACTS : owns
    CONTACTS ||--o{ CONTACT_IDENTITIES : identified_by
    CONTACTS ||--o{ CONSENT_RECORDS : gives
    CONTACTS ||--o{ LEADS : generates
    LEADS ||--o{ LEAD_QUALIFICATION_EVALUATIONS : evaluated_by
    LEAD_QUALIFICATION_EVALUATIONS ||--o{ LEAD_QUALIFICATION_EVIDENCE : supported_by
    MESSAGES ||--o{ LEAD_QUALIFICATION_EVIDENCE : sources
    CONTACTS ||--o{ CONVERSATIONS : participates
    CONTACTS o|--o{ WIDGET_SESSIONS : identifies
    LEADS ||--o{ CONVERSATIONS : discussed_in
    CHANNEL_CONNECTIONS ||--o{ CONVERSATIONS : carries
    CONVERSATIONS ||--o{ MESSAGES : contains
    CONVERSATIONS o|--o{ WIDGET_SESSIONS : binds
    LEADS ||--o{ APPOINTMENT_REQUESTS : requests
    CONVERSATIONS ||--o{ APPOINTMENT_REQUESTS : originates
    SERVICES ||--o{ APPOINTMENT_REQUESTS : requests
    LOCATIONS ||--o{ APPOINTMENT_REQUESTS : requests_at
    APPOINTMENT_REQUESTS ||--o{ APPOINTMENT_REQUEST_PREFERENCES : prefers
    APPOINTMENT_REQUESTS ||--o{ APPOINTMENT_REQUEST_TRANSITIONS : transitions
    APPOINTMENT_REQUESTS ||--o{ APPOINTMENT_CONFIRMATION_EVIDENCE : evidenced_by
    APPOINTMENT_REQUESTS ||--o{ APPOINTMENT_REQUEST_ATTENDANCE : outcomes
    APPOINTMENT_REQUESTS ||--o{ APPOINTMENT_REVENUE_ATTRIBUTIONS : attributes
    CONVERSATIONS ||--o{ HANDOFFS : escalates
    HANDOFFS ||--o{ HANDOFF_TRANSITIONS : transitions
~~~

### 11.2 AI, delivery, reliability, and governance

~~~mermaid
erDiagram
    ORGANIZATIONS ||--o{ WEBHOOK_RECEIPTS : receives
    CHANNEL_CONNECTIONS ||--o{ WEBHOOK_RECEIPTS : authenticates
    WEBHOOK_RECEIPTS o|--o| MESSAGES : produces
    ORGANIZATIONS ||--o{ IDEMPOTENCY_KEYS : scopes
    ORGANIZATIONS ||--o{ OUTBOX_EVENTS : commits
    CONVERSATIONS ||--o{ AI_RUNS : invokes
    MESSAGES ||--o{ AI_RUNS : triggers
    AI_RUNS ||--o| AI_ACTION_EVALUATIONS : proposes
    ORGANIZATIONS ||--o{ NOTIFICATIONS : owns
    NOTIFICATIONS ||--o{ NOTIFICATION_ATTEMPTS : attempts
    ORGANIZATIONS ||--o{ AUDIT_EVENTS : audits
    ORGANIZATIONS ||--o{ PRIVACY_REQUESTS : handles
    ORGANIZATIONS ||--o{ LEGAL_HOLDS : protects
    ORGANIZATIONS ||--o{ ANALYTICS_EVENTS : projects
    ORGANIZATIONS o|--o{ PLATFORM_AUDIT_EVENTS : targeted_by
~~~

## 12. Critical access paths and index review

Indexes are justified by these initial access patterns. Query plans are captured
with production-like cardinality before launch; unused/redundant indexes are not
added speculatively.

| Access path | Required predicate/order | Supporting index |
| --- | --- | --- |
| Staff conversation inbox | tenant + allowed locations/assignee + active status, newest activity | `conversations(organization_id, status, last_activity_at desc)` plus lead/location join indexes |
| Conversation detail | tenant + conversation, messages in canonical order | unique `messages(organization_id, conversation_id, sequence_no)` |
| Appointment review queue | tenant + allowed location + `requested`, oldest first | `appointment_requests(organization_id, location_id, status, created_at)` |
| Confirmation expiry | tenant + awaiting state + due time | partial `appointment_requests(organization_id, offer_expires_at)` for `staff_accepted\|awaiting_customer_confirmation` |
| Handoff SLA queue | tenant + queue/assignee + active status + due time | `handoffs(organization_id, queue_key, status, requested_at)` and `(... status, sla_due_at)` |
| Knowledge load | tenant + active service/location/policy + effective instant | catalog tenant/status/effective indexes described above |
| Provider dedupe | tenant + connection + exact external ID | webhook/message unique indexes |
| Contact resolution | tenant + identity type/connection + exact tenant-peppered hash | contact identity expression unique index |
| Outbox claim | global worker due pending items | partial `outbox_events(status, available_at, id)` through dedicated claim function; tenant context set before processing |
| Notification claim | tenant/worker + due state | `notifications(organization_id, status, available_at)` |
| Funnel report | tenant + event type + occurred range, optional dimensions | `analytics_events(organization_id, occurred_at, event_type)` and subject indexes |
| Audit target history | tenant + target + reverse time | audit target composite index |

All user/API list queries use keyset cursors, not unbounded offsets. Cursor
ordering includes a unique tiebreaker (`created_at, id` or equivalent). The
encoded cursor is opaque/signed and bound to tenant and filters.

## 13. Constraints that require transactions or triggers

Database constraints enforce simple facts; application commands plus row locks
enforce state-dependent facts. A migration may use small, reviewed constraint
triggers for cross-row invariants, but must not hide core business state
machines in opaque trigger code.

- Appointment, lead, conversation, and handoff allowed transitions are checked
  by domain code under expected version; transition unique constraints expose
  races.
- Staff accept/reject and customer confirm acquire/update the request by
  (`organization_id`, `id`, expected `version`). Exactly one concurrent command
  succeeds.
- Creating `awaiting_customer_confirmation` requires the confirmation
  notification/task and transition/outbox records in the same transaction.
- Customer confirmation inserts evidence, consumes the current offer token,
  updates request, converts lead, writes transition/audit/outbox atomically.
- Active-handoff and current-attendance partial unique indexes prevent two
  current rows even under racing workers.
- Price/service-location effective intervals use PostgreSQL range exclusion
  constraints when the selected ORM/migration tool represents them safely;
  otherwise a serialized application command and integration test enforce them.
- Publishing i18n content checks default locale and all same-tenant referenced
  records in the transaction.
- Every write includes explicit organization IDs in composite FKs; no trigger
  fills tenant identity from another row.

## 14. Retention, deletion, and export execution

### 14.1 Data-subject erasure order

After identity verification, authorization, legal-hold check, and export if
required:

1. stop optional communication and append consent withdrawal/restriction;
2. invalidate widget/confirmation sessions and remove contact identity
   ciphertext/lookup hashes;
3. tombstone contact name and free-form message, appointment-note,
   confirmation-evidence, AI-input/output, webhook-payload, and notification
   payload ciphertext;
4. null/pseudonymize subject links in analytics where required;
5. retain minimal transition, consent, security, and financial facts only for
   the configured lawful period;
6. hard-delete the remaining graph in explicit dependency order once all holds
   and retention periods expire.

Every step is idempotent, records an audit event, and is resumable. Deletion
jobs never select across tenants in one unrestricted transaction.

### 14.2 Organization offboarding

Set organization `suspended`, disable inbound routes/channel connections,
revoke memberships, drain or cancel side effects according to policy, create a
verified export, wait the contracted recovery window, and run a tenant-scoped
purge plan. Backups age out under documented backup retention; the deletion
report states that lag. The final organization row is deleted only when FK
checks prove no child remains.

### 14.3 Export

Exports are built from canonical tenant-scoped tables, include schema/version
metadata, and separate ciphertext-decrypted subject data from audit/security
facts. Artifacts are encrypted, time-limited, checksum-protected, access logged,
and never delivered through a public stable URL.

## 15. Scaling and physical-design thresholds

- UUIDv7 improves locality while remaining opaque; it is not an authorization
  control.
- The initial design uses ordinary tables. Premature sharding or tenant-per-
  schema/database would add operational risk without demonstrated need.
- Consider time partitioning `messages`, `audit_events`, `analytics_events`,
  `webhook_receipts`, and `outbox_events` only after observed size/write/query
  plans show benefit. Any partition key must retain organization-prunable
  indexes and identical forced-RLS policy.
- Archive/purge in bounded batches ordered by tenant and time to avoid long
  locks and replication lag.
- Large encrypted payloads may later move behind an encrypted object-storage
  reference, preserving DB hash, tenant, retention, and transactional creation
  semantics.
- Read replicas may serve explicitly stale analytics/list workloads only after
  read-your-write requirements are defined. Authorization and booking commands
  use the primary.
- Connection pools are bounded and transaction-mode compatible with
  transaction-local RLS settings. Pool monitoring alerts on saturation.
- Analytics rollups/materialized views may be added as rebuildable projections;
  they never replace `appointment_requests`, attendance, or revenue facts.

## 16. Migration and database-role requirements

1. Migrations are forward-only, checksum-tracked, and run by a separate
   migration role; deployed historical migrations are never edited.
2. Create parent tables, unique (`organization_id, id`) keys, child composite
   FKs, indexes, then RLS policies/`FORCE ROW LEVEL SECURITY` before granting
   runtime access.
3. Constraint/index creation on populated large tables uses a staged
   expand/backfill/validate/contract process and `CREATE INDEX CONCURRENTLY`
   where transaction/tooling rules permit.
4. Runtime roles receive explicit table/function grants, no schema create,
   ownership, superuser, or `BYPASSRLS`.
5. Worker claim functions have fixed search paths, bounded operations, and
   return only leased IDs/tenant context; they are security-reviewed.
6. Backup/restore exercises verify keys, extensions, RLS policies, constraints,
   and encrypted-data key availability—not only row count.
7. Status check changes are additive first; application compatibility is
   deployed before old status removal.

## 17. Data-model verification obligations

- Migration tests create the schema from zero and upgrade from every supported
  prior release.
- Schema introspection asserts every tenant table has
  `organization_id`, organization FK, unique composite parent key, enabled
  forced RLS, and both `USING`/`WITH CHECK` policies.
- Cross-tenant tests attempt reads, inserts, updates, deletes, joins, nested
  references, bulk operations, cursors, worker jobs, and guessed IDs.
- Separate tests prove `users`, `inbound_routes`, and `platform_audit_events`
  have no generic tenant/runtime grants and their narrow functions fail closed.
- FK tests substitute cross-tenant contact, service, location, message, member,
  offer evidence, and policy IDs.
- Idempotency/concurrency tests race webhook receipt, message append, request
  creation, accept/reject, confirm/expire, active handoff, attendance correction,
  revenue reversal, notification, and analytics projection.
- Property/check tests cover all money price shapes, IANA/DST time conversion,
  bounded i18n keys/strings, valid status values, and local/UTC chronology.
- Privacy tests verify erasure removes ciphertext/hash/searchable PII, legal
  holds block purge, exports remain tenant-scoped, and standard logs contain no
  protected values.
- Query-plan/load tests cover the critical paths in Section 12 with launch
  cardinality and assert no accidental full-table/cross-tenant scans.
- Restore tests confirm RLS is still forced and runtime roles still lack bypass
  after recovery.

## 18. Schema inventory, stage allocation, and ownership audit

The initial schema is implemented in these explicit reviewed slices. A table is
created only in its assigned slice; later slices add their own forward
migrations rather than rewriting an earlier migration.

| Stage | Exact table manifest |
| --- | --- |
| S4a tenant/configuration foundation | `organizations`, `users`, `memberships`, `locations` |
| S4b business configuration and customer/workflow foundation | `retention_policies`, `retention_policy_rules`, `inbound_routes`, `location_versions`, `location_business_hours`, `location_closures`, `services`, `service_versions`, `service_locations`, `service_prices`, `faqs`, `business_policies`, `channel_connections`, `widget_allowed_origins`, `widget_sessions`, `contacts`, `contact_identities`, `consent_records`, `leads`, `lead_qualification_evaluations`, `lead_qualification_evidence`, `conversations`, `messages`, `appointment_requests`, `appointment_request_preferences`, `appointment_request_transitions`, `appointment_confirmation_evidence`, `appointment_request_attendance`, `appointment_revenue_attributions`, `handoffs`, `handoff_transitions`, `notifications`, `notification_attempts` |
| S4c reliability/governance foundation | `ai_runs`, `ai_action_evaluations`, `webhook_receipts`, `idempotency_keys`, `outbox_events`, `audit_events`, `platform_audit_events`, `privacy_requests`, `legal_holds`, `analytics_events` |
| S6 staff identity/RBAC persistence and implementation | `external_identities`, `membership_invitations`, `auth_sessions`, `membership_location_scopes` |

S4a contains exactly its four listed production tables. In particular it does
not create external identities, invitations, sessions, location grants,
knowledge/content, channels, customer workflows, reliability/governance, RLS,
or support/impersonation persistence. S5 owns RLS for the tables available at
that stage; S6 applies the corresponding security controls to its later tables.

All listed tables have an explicit purpose, ownership category, key strategy,
uniqueness/index plan, sensitivity class, deletion behavior, and RLS/grant
posture in this document. No implicit cross-tenant join or global contact/
channel-participant identity is permitted.

## 19. Data-model open questions

1. The active-lead uniqueness scope (contact only, service, campaign, or a
   configurable combination).
2. Exact Telegram thread grouping and widget conversation reopen/session
   windows, needed before partial active-conversation uniqueness is finalized.
3. Jurisdiction-specific retention day values, legal basis, legal-hold
   authority, and whether audit/outcome records must be physically segregated.
4. Whether each fixed V1 external-attestation method (`phone|in_person`) is
   legally acceptable and which evidence fields/retention it requires; any new
   method needs a versioned contract and architecture review.
5. Whether external imports are P0 for attendance/revenue; the schema supports
   `approved_import`, while the product requires only manual P0 entry.
6. Base currency/reporting rules for organizations operating in multiple
   currencies; raw facts remain currency-specific regardless.
7. Whether provider payloads/message bodies remain in PostgreSQL or move to
   encrypted object storage at launch volume.
8. Measured volume thresholds for partitioning and whether a read replica is
   justified.
9. Whether the selected ORM/migration stack safely supports range exclusion
    constraints, partial/expression indexes, generated search vectors,
    security-definer functions, and forced RLS; migrations must use explicit SQL
    where it does not.
