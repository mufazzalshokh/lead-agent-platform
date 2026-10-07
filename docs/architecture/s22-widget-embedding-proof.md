# S22 synthetic Website Chat embedding proof

Status: non-paid test-host preparation verified locally; live embedding/session
proof pending. This does not authorize a Widget message, provider call or S22
acceptance.

## Observed starting point — 2026-10-07

The owner's current organization-bound Integrations screenshot shows **Website
Chat: Not connected**. `https://clinic.example` is the empty input's placeholder,
not an active website configuration or a real business. Disabled **Set up** while
the input is empty matches the existing UI. This observation is not a setup/load
regression. The adjacent recorded analytics show one lead, request and confirmed
appointment; the screenshot alone is not a new analytics reconciliation.

The repository has no deployed external synthetic website. Hosting a fixture on
the platform Web origin itself would not demonstrate the required cross-origin
iframe isolation. The existing [S19 Widget boundary](23-s19-product-ux.md#widget-iframe-isolation)
and [S22 topology](26-s22-staging-recovery-capacity.md#staging-topology) stay unchanged.

## Temporary host without infrastructure deployment

[Google Cloud Shell Web Preview](https://docs.cloud.google.com/shell/docs/using-web-preview)
provides a user-account-restricted HTTPS proxy for an HTTP server on port 8080.
Use `.github/scripts/s22-widget-host.mjs` through the reviewed commit's
checksum-verified startup command supplied in the milestone handoff. It requires
only existing Node, curl and sha256sum; no dependency installation, domain,
Terraform, IAM, container image or service change. Expected reviewed SHA256:
`59e972fed6b237baf7e6f27041b8a251462b2609896726bfb6e7002d64f04a09`.

The server exposes one synthetic HTML page, not files, an API proxy or credentials.
Only GET/HEAD `/` are supported; writes and other paths fail closed. It uses
fresh CSP nonces, exact staging script/connect/frame/form destinations, no-store
responses and request timeouts. It stops after one hour or Ctrl+C. Preview
addresses are ephemeral; obtain the actual HTTPS origin from the opened page,
never invent it from an example or reuse a previous preview address.

## Owner flow and evidence boundaries

1. Start the reviewed server in the existing Cloud Shell. Keep that terminal
   running; use **Web Preview → Preview on port 8080**.
2. The synthetic page displays its actual HTTPS website origin. Use **Copy
   website address**, then the existing authenticated workspace → **Integrations
   → Website Chat → Business website → Set up**. Current owner screenshot proves
   this is initial setup, not replacement of an unrelated installation. Check
   **Active for** reports that exact origin.
3. Use **Copy installation code** in the staff UI. Paste only that public snippet
   into the synthetic page and click **Install Widget**. Do not paste any secret,
   cookie or bearer. The host validates the exact existing canonical staging
   snippet and creates its approved script; it never executes pasted HTML or
   stores the snippet.
4. Open **Chat with us**, inspect the frame, close/reopen it. **Do not send a
   message.** Opening/redeeming creates a WidgetSession, not a conversation/model
   call. The genuine isolated frame still has Send; the host cannot reach into it
   to enforce the no-Send instruction. No new paid dispatch is authorized.
5. Record actual approved-origin open/close/reopen, frame/CSP/origin binding,
   third-party-cookie-independent session behavior and disallowed-origin denial
   separately. Do not claim these live assertions from local mocks. Any missing
   evidence remains pending, and Widget customer/booking E2E remains separate.

Stop the temporary server with Ctrl+C when the window ends. The application
currently exposes setup/replacement, not a dedicated disable button. Do not
invent a removal endpoint: a later **Replace setup** for the next approved host
rotates the installation key. Track the temporary origin until replacement;
Cloud Shell's owner-only proxy and stopped server are not a claim that the
persisted allowlist entry was deleted.

## Verification already performed

- Public live staging `/embed/widget.js`: HTTP 200, 5,039 bytes,
  `API_ORIGIN=https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app`, SHA256
  `abda0e39938bcd9ab55b938fbc53e712e120b662beea18448d324e9d234d1fd9`.
  Only safe static metadata was reported. This verifies loader configuration,
  not a completed session or deployment provenance for all services.
- `node --test .github/scripts/s22-widget-host.test.mjs`: **12/12 PASS**.
  Real local HTTP/CSP and controlled exact HTML bootstrap tests cover canonical
  snippet validation, nonce/closing-tag injection, HTTPS/distinct-origin guards,
  public-code-only installation, no fixture API dispatch/cookie reads, safe
  feedback and manual-only load retry. A generated bootstrap truncation defect
  was reproduced before correction (5 PASS/6 FAIL) and fixed by escaping script
  closing tags without changing the public installation contract.
- Scoped ESLint zero warnings, Prettier and diff checks PASS; independent source
  security review PASS. No production application code, migration, runtime
  configuration or paid call changed. Cloud Shell execution and live browser
  session proof are still pending.
