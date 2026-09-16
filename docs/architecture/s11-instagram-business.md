# S11.B — Instagram Business direct messages

S11.A Telegram remains checkpointed at `c8e50375ac1196dd2609497191e141a2bcd59cd1`.
S11.B extends that baseline on `verify/s11-messaging`; neither verification
branch is a main-branch acceptance or a live-provider deployment.

## Provider and trust boundary

Use Instagram API with Instagram Login for the customer's existing Professional
Business/Creator account. No Facebook Page, personal-account integration, cold
outreach, or group chat. Minimum scopes are `instagram_business_basic` and
`instagram_business_manage_messages`. Platform endpoints and the versioned Graph
host are fixed; callback URI is platform configured, never client supplied.

The profile's canonical `user_id`, not its app-scoped `id`, identifies the account
in webhook `entry.id`. Each authenticated entry resolves independently through
the narrow ingress function. The stable customer-scoped sender ID is protected
with the existing tenant/channel hashing and encryption. Usernames are not
identity. Phone is optional; DM continuity does not imply marketing consent.

Subscription challenge uses constant-time token comparison. POST authentication
uses HMAC-SHA256 over the exact raw bytes before JSON parsing. Payloads are bounded
to 512 KiB plus finite depth, entry/event counts and used fields. Echo/self,
unsupported, deletion and receipt events cannot mutate business state. Attachment
references remain encrypted, quarantined metadata and are never downloaded.

## Onboarding and credentials

Staff onboarding and disconnect reuse S6 cookie/session, CSRF, staff-origin,
Fetch Metadata, current-membership and `integrations.manage` authorization.
Onboarding returns only an official authorization URL. A random 32-byte state
is tenant-bound through its SHA-256 hash and expires after ten minutes.

Callback verifies state, exchanges code, validates professional account/scopes,
subscribes `messages`, and creates a managed credential before a short activation
transaction. Activation consumes state through route CAS and records audit
atomically. Losing activation deletes only its newly created external credential.
Provider and secret-store I/O never occur in a database transaction.

`CredentialSecretStore` is a provider-neutral put/get/delete boundary. Production
composition fails closed if Instagram is enabled without an injected managed
adapter. There is no production in-memory/file fallback and no token in the DB;
only an opaque credential reference/version and bounded non-secret metadata.
Managed adapter deployment is a prerequisite, not silently satisfied by test fakes.

Refresh is explicit, after 24 hours and before expiry, and uses expected reference
and version CAS. It commits the new reference before deleting the previous secret.
Authentication failure revokes the channel/route and requires staff reauthorization.
Disconnect disables routes and clears credentials atomically while retaining
business history; subsequent external deletion is observable best effort.

## Canonical persistence and outbound

Instagram reuses S9's canonical Contact/Lead/Conversation/Message path. Identity
uniqueness remains organization + type + channel + lookup hash. Active Lead
grouping remains organization + contact; active Conversation grouping remains
organization + channel + protected external thread. A stable account/customer/mid
key deduplicates messages. Reordered input cannot regress activity. A new distinct
message after a terminal Conversation creates a new cycle without mutating old
terminal history or inventing a timer/reopen policy.

S8's existing `message.response_queued.v1` / `outbound_message` handler dispatches
both providers; no new queue. Outbound reloads trusted encrypted recipient/thread,
credential and active channel after secret I/O. Text is plain Unicode, at most
1,000 UTF-8 bytes, and within the 24-hour customer reply window; quick replies and
media outbound are unsupported. Provider HTTP is outside transactions. Required
delivery/audit writes remain atomic. Ambiguous network/send-then-crash failures
retain the explicit at-least-once risk; no exactly-once external-delivery claim.

## Approved compatibility correction

Only migration `0027_s11_instagram_identity_routing.sql` is added. Business tables
remain 51. Historical SQL is immutable. The finite inbound route vocabulary adds
`instagram_webhook`; resolver ownership, fixed `pg_catalog` search path, ingress
execution-only privilege and FORCE RLS are preserved. Three hardcoded Instagram
route mutations use transaction-local tenant context and expected-hash CAS.

`instagram_user` requires a non-null same-tenant channel FK. Trusted canonical
persistence additionally requires that channel's type to be Instagram; no unsafe
cross-table CHECK or new trigger is introduced. Outbox and analytics version
checks admit V2 only for the already-versioned `lead.reopened` and newly versioned
`contact.identity_added`; other event versions remain V1.

All 319 accepted public schemas, including ContactIdentityAdded V1 and staff V1,
remain unchanged. Ten additive schemas bring the catalog to 329: two Contact
identity event/payload V2 schemas and eight identity-bearing staff read V2 schemas.
There are still 63 semantic event names, with 65 registered versioned variants.
Instagram identity producers use V2; unrelated legacy producers keep V1.

Parallel reads are exactly:

- `GET /v2/staff/contacts/:id`
- `GET /v2/staff/conversations`
- `GET /v2/staff/conversations/:id`

One rich query/application model has explicit projections. V1 Contacts omit
Instagram identities before decryption; V1 Conversation participant identity
type is null for Instagram. V2 represents Instagram without changing masking,
anonymization, sensitive permission, tenant/location authorization or pagination.
No lead/message V2, Accept-header or query-parameter negotiation is introduced.

## Verification and deployment gates

S11.B uses deterministic injected fetch and test secret-store fakes. Real
PostgreSQL migration/security/canonical regressions are registered in the existing
isolated schema suite. If no safe local PostgreSQL 17 runtime is reachable, their
execution is explicitly deferred to combined S11.C on GitHub-hosted Ubuntu; source
checks and compilation are not a database PASS.

Live OAuth, webhook subscription and send smoke tests require owner credentials,
Meta dashboard configuration, appropriate app access/review and account eligibility.
Production enablement also requires the managed credential adapter. No S11.C, AI,
booking or billing functionality belongs to this batch.

Primary provider references verified for this implementation:

- [Business Login and token lifecycle](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Professional account setup and canonical IDs](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)
- [Webhook authentication and subscription](https://developers.facebook.com/documentation/instagram-platform/webhooks)
- [Messaging API, reply window and UTF-8 byte limit](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- [Instagram message webhook shape](https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/)
