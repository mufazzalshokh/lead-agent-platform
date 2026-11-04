import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// Synthetic embedding host only. Never proxy the API or hold staff credentials.
export const STAGING_WEB_ORIGIN = "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app";

export function parseWidgetInstallationSnippet(snippet) {
  if (typeof snippet !== "string" || snippet.length > 512) {
    throw new TypeError("Use only Copy installation code from staging Website Chat.");
  }
  const prefix = `<script async src="${STAGING_WEB_ORIGIN}/embed/widget.js" data-widget-key="`;
  const suffix = '" data-locale="uz"></script>';
  const trimmed = snippet.trim();
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith(suffix)) {
    throw new TypeError("Use only Copy installation code from staging Website Chat.");
  }
  const key = trimmed.slice(prefix.length, -suffix.length);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(key)) {
    throw new TypeError("Use only Copy installation code from staging Website Chat.");
  }
  return key;
}

export function startWidgetHost(browser) {
  const document = browser.document;
  const origin = document.querySelector("#origin");
  const copy = document.querySelector("#copy-origin");
  const input = document.querySelector("#installation-code");
  const mount = document.querySelector("#mount-widget");
  const status = document.querySelector("#status");
  const websiteOrigin = browser.location.origin;
  origin.textContent = websiteOrigin;
  if (
    browser.location.protocol !== "https:" ||
    websiteOrigin === STAGING_WEB_ORIGIN ||
    !/^https:\/\/[A-Za-z0-9.-]+(?::[1-9][0-9]{0,4})?$/u.test(websiteOrigin)
  ) {
    status.textContent = "Open this page through Cloud Shell Web Preview on port 8080.";
    copy.disabled = true;
    input.disabled = true;
    mount.disabled = true;
    return;
  }
  copy.addEventListener("click", async () => {
    try {
      await browser.navigator.clipboard.writeText(websiteOrigin);
      status.textContent =
        "Website address copied. Use it in staging Website Chat → Business website.";
    } catch {
      status.textContent = "Copy the website address shown above manually.";
    }
  });
  let installed = false;
  mount.addEventListener("click", () => {
    if (installed) return;
    let key;
    try {
      key = parseWidgetInstallationSnippet(input.value);
    } catch {
      status.textContent =
        "Paste only the public installation code copied from staging Website Chat.";
      return;
    }
    installed = true;
    mount.disabled = true;
    input.disabled = true;
    input.value = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = `${STAGING_WEB_ORIGIN}/embed/widget.js`;
    script.dataset.widgetKey = key;
    script.dataset.locale = "uz";
    script.addEventListener("load", () => {
      status.textContent =
        "Widget installed. Open Chat with us, then close/reopen it. Do not send a message.";
    });
    script.addEventListener("error", () => {
      script.remove();
      installed = false;
      mount.disabled = false;
      input.disabled = false;
      status.textContent =
        "Widget loader could not load. Check access to staging, then paste the installation code again.";
    });
    status.textContent = "Loading the approved Widget loader…";
    document.body.append(script);
  });
}

export function buildWidgetHostDocument(nonce) {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{22,128}$/u.test(nonce)) {
    throw new TypeError("Invalid fixture nonce");
  }
  // HTML closes script elements even when </script> appears inside a JS string.
  const bootstrap = [
    `const STAGING_WEB_ORIGIN = ${JSON.stringify(STAGING_WEB_ORIGIN)};`,
    parseWidgetInstallationSnippet.toString(),
    `(${startWidgetHost.toString()})(globalThis);`,
  ]
    .join("\n")
    .replace(/<\/script/giu, "<\\/script");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S22 synthetic Widget test website</title>
<style nonce="${nonce}">
body{margin:0;background:#f5f8f6;color:#17201d;font:16px/1.6 system-ui,sans-serif}main{max-width:680px;margin:40px auto;padding:24px;background:#fff;border:1px solid #d8e2dc;border-radius:16px}h1{font-size:26px}h2{font-size:19px}code{display:block;overflow-wrap:anywhere;padding:12px;background:#edf3ef;border-radius:8px}textarea{box-sizing:border-box;width:100%;min-height:110px;margin-top:8px;padding:10px;font:14px monospace}button{padding:12px 16px;margin-top:12px;background:#276153;color:#fff;border:0;border-radius:8px;font:600 15px system-ui;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,textarea:focus-visible{outline:3px solid #86b9ab;outline-offset:3px}.notice{padding:12px;background:#fff4df;border-radius:8px}#status{min-height:52px}small{color:#52635a}@media(max-width:720px){main{margin:12px}}
</style></head><body><main>
<p><strong>S22 synthetic test website — not a real clinic</strong></p>
<h1>Website Chat: session-only check</h1>
<p class="notice">No messages or paid AI tests are authorized here. Open and close the chat only; do not press Send.</p>
<h2>1. Use this website address</h2><code id="origin"></code><button id="copy-origin" type="button">Copy website address</button>
<p>In the existing staging workspace, open Integrations → Website Chat. Paste this exact address into Business website and click Set up. Then click Copy installation code.</p>
<h2>2. Install the public Widget snippet</h2>
<label for="installation-code">Paste only the public installation code from Website Chat.</label>
<textarea id="installation-code" spellcheck="false" autocomplete="off" placeholder="Paste Copy installation code here"></textarea>
<small>Never paste passwords, tokens, cookies or private credentials. The snippet is validated and is not stored.</small><br>
<button id="mount-widget" type="button">Install Widget</button><p id="status" role="status" aria-live="polite">Waiting for installation code.</p>
<p>After installation, use Chat with us to open the frame. Close and reopen it without sending. This page is temporary: keep Cloud Shell running and stop it with Ctrl+C when testing is finished. A later Replace setup on the next approved website rotates this installation key.</p>
</main><script nonce="${nonce}">
${bootstrap}
</script></body></html>`;
}

export function createWidgetHostServer() {
  const server = createServer((request, response) => {
    const nonce = randomBytes(24).toString("base64url");
    const headers = {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' ${STAGING_WEB_ORIGIN}/embed/widget.js`,
        `style-src 'nonce-${nonce}'`,
        `connect-src ${STAGING_WEB_ORIGIN}`,
        `frame-src ${STAGING_WEB_ORIGIN}`,
        `form-action ${STAGING_WEB_ORIGIN}`,
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "object-src 'none'",
      ].join("; "),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { ...headers, allow: "GET, HEAD" });
      response.end("Read-only test website.");
      return;
    }
    if (request.url?.split("?")[0] !== "/") {
      response.writeHead(404, headers);
      response.end("Not found.");
      return;
    }
    response.writeHead(200, headers);
    response.end(request.method === "HEAD" ? undefined : buildWidgetHostDocument(nonce));
  });
  server.maxHeadersCount = 32;
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createWidgetHostServer();
  const stop = () => {
    server.close();
    server.closeAllConnections();
  };
  server.once("error", () => {
    console.error("Test website could not start on port 8080. No existing server was changed.");
    process.exitCode = 1;
  });
  server.listen(8080, "0.0.0.0", () => {
    console.log("Synthetic test website ready. Keep this terminal running.");
    console.log("Click Cloud Shell Web Preview → Preview on port 8080.");
    console.log("No credentials needed. Do not send a chat message.");
    setTimeout(stop, 60 * 60 * 1000).unref();
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
