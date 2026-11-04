# S22 public privacy notices — publication handoff

Status: prepared for owner review; not deployment or Meta publication evidence.

The owner selected `leadagentstaging@gmail.com` as the public project contact and
declined to share a personal name in chat. No personal name, home address, identity
document or invented company is included. `Lead Agent Staging` is a working project
name, not an assertion that a legal entity with that name exists.

## Routes and content

- `/privacy`: staging scope, data categories, eligibility minimization, providers,
  AI handling, storage/retention limitations, sessions, and request contact.
- `/data-deletion`: manual email request, proportionate verification, scope,
  exceptions/backups, and the difference between revocation and deletion.

Both routes are static public Next.js pages, independent of staff sign-in, API
credentials and database queries. Shared contact/date values are in
`apps/web/src/lib/public-notice.ts`. Page metadata requests `noindex` without
blocking public retrieval. No tracker, public form or deletion API is added.

The factual draft follows `25-s21-privacy-security.md` and the manual request
procedure in `07-tenancy-security-privacy.md`. It does not claim that launch
retention, operator/controller identity, jurisdiction review or the manual
request procedure have passed S22 live acceptance. It gives no invented fixed
retention/deletion deadline, zero-retention or healthcare-compliance promise.
Google's paid API description was checked against its official terms on
2026-10-04: <https://ai.google.dev/gemini-api/terms>.

## Owner review and external steps

1. Review the factual draft against actual staging operations. Confirm that the
   public mailbox is monitored and the manual request procedure can be fulfilled.
   Resolve the applicable operator/controller identity and launch-jurisdiction
   notice requirements before publication. Any necessary name can be entered by
   the owner locally; it need not be sent through chat. The DPO fields in Meta are
   not a substitute for this review, and no DPO status is invented here.
2. Preserve existing Windows edits. Transfer/review the scoped change on
   `verify/s22-staging-recovery-capacity`, validate it, and push through the owner's
   authenticated Git access. Do not promote `main` or declare S22 accepted.
3. Use the existing reviewed immutable-image and Terraform staging deployment
   process. Building source files does not put the pages on Cloud Run. No new
   hosting provider, domain purchase, IAM change or migration is needed for these
   routes. No deployment or Meta publishing has been performed by this change.
4. After deployment, verify unauthenticated HTTPS 200 responses and visible text
   at both exact routes before saving their URLs in Meta:
   - `https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app/privacy`
   - `https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app/data-deletion`
5. Save the privacy URL and select the data-deletion **instructions URL** option
   (not an unimplemented callback endpoint). Check Meta's remaining publication
   requirements. Publishing the Meta app is a separate owner action and must not
   be represented as approval for broad customer onboarding or advanced access.
6. Repeat one real synthetic Instagram DM and inspect bounded request metadata,
   thread eligibility, staff Inbox and same-DM reply. HTTP 200 alone is not
   evidence that a business conversation or AI response was created.

## Live delivery evidence preserved

- Friend's synthetic DM at 2026-10-03 23:16 Asia/Tashkent (18:16 UTC): received in
  Instagram, but the owner's bounded Cloud Run request query for 18:14–18:22 UTC
  found no matching webhook POST; staff Inbox remained empty.
- Dashboard `messages` test: Web HTTP 200 at `2026-10-03T18:50:52.778065Z`
  (10.573894994s); API HTTP 200 at `2026-10-03T18:50:55.671752Z`
  (7.060242947s). This proves test delivery/acknowledgment, not real DM processing.
- Owner screenshot of Instagram Login setup explicitly states that webhook
  notifications require Published status. The app was Unpublished. Correct
  callback, subscribed `messages`, and receiver message access were confirmed;
  OAuth was not repeated.

Real Instagram journey, Widget, measured recovery/capacity, observability and
authoritative final CI remain separate unaccepted S22 gates. S23 is out of scope.

## Local verification

- Node `24.19.0`, repository-pinned pnpm `11.24.0`; frozen-lockfile installation.
- `pnpm --filter @lead-agent/web run build`: production build includes both static
  public routes; TypeScript passes.
- `pnpm --filter @lead-agent/web run typecheck`: passes.
- Scoped ESLint and Prettier checks plus `git diff --check`: pass.
- `pnpm exec vitest run apps/web/src/lib/product-ux.test.ts
apps/web/src/lib/api-gateway.test.ts`: 20 existing tests pass. No new tests added
  for static copy; production HTTP smoke checks validate the new route boundary.
- Locally launched the built standalone server with its packaged static assets:
  both pages and their CSS return HTTP 200 without staff authentication or API/DB
  configuration; expected headings, navigation, contact and `noindex` are present;
  no `Set-Cookie`, personal identity or injected query canary appears. Existing
  home redirect to `/staff` remains HTTP 307.
- No secret payload was accessed; no runtime, IAM, migration, Meta setting or
  OAuth state was changed. These are local checks, not live HTTPS or final
  authoritative CI proof. Changes remain uncommitted/unpushed in this checkout.
