import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  STAGING_WEB_ORIGIN,
  buildWidgetHostDocument,
  createWidgetHostServer,
  parseWidgetInstallationSnippet,
} from "./s22-widget-host.mjs";

const key = "w".repeat(43);
const canonical = `<script async src="${STAGING_WEB_ORIGIN}/embed/widget.js" data-widget-key="${key}" data-locale="uz"></script>`;
const nonce = "n".repeat(32);

test("accepts only the exact public staging installation snippet", () => {
  assert.equal(parseWidgetInstallationSnippet(canonical), key);
  assert.equal(parseWidgetInstallationSnippet(`\n ${canonical} \n`), key);
});

test("rejects foreign, credential-bearing, injected and noncanonical installation code", () => {
  const rejected = [
    "",
    null,
    {},
    canonical.replace(STAGING_WEB_ORIGIN, "https://attacker.example"),
    canonical.replace(STAGING_WEB_ORIGIN, `${STAGING_WEB_ORIGIN}.attacker.example`),
    canonical.replace("https://", "http://"),
    canonical.replace("https://", "https://owner:private@"),
    canonical.replace("/embed/widget.js", "/embed/widget.js?token=private"),
    canonical.replace("/embed/widget.js", "/embed/widget.js#extra"),
    canonical.replace("async ", 'async onload="alert(1)" '),
    canonical.replace('data-locale="uz"', 'data-locale="en"'),
    canonical.replace(key, "w".repeat(42)),
    canonical.replace(key, "w".repeat(44)),
    canonical.replace(key, "<".repeat(43)),
    `${canonical}<script>alert(1)</script>`,
    `<div>${canonical}</div>`,
    canonical.replace("</script>", "alert(1)</script>"),
  ];
  for (const snippet of rejected) {
    assert.throws(() => parseWidgetInstallationSnippet(snippet), TypeError);
    try {
      parseWidgetInstallationSnippet(snippet);
    } catch (error) {
      assert.doesNotMatch(error.message, /private|attacker|alert|w{42}/u);
    }
  }
});

test("generated host is visibly synthetic and rejects an invalid CSP nonce", () => {
  const document = buildWidgetHostDocument(nonce);
  assert.match(document, /S22/u);
  assert.match(document, /synthetic/iu);
  assert.match(document, new RegExp(`<script nonce="${nonce}">`, "u"));
  for (const invalid of ["", "short", 'x" onload="alert(1)', "<script>", null]) {
    assert.throws(() => buildWidgetHostDocument(invalid), TypeError);
  }
});

test("serialized parser cannot terminate the generated script element before its bootstrap", () => {
  const document = buildWidgetHostDocument(nonce);
  assert.equal(document.match(/<\/script\b/giu)?.length, 1);
  const bootstrap = /<script nonce="[A-Za-z0-9_-]+">([\s\S]*?)<\/script>/iu.exec(document)?.[1];
  assert.ok(bootstrap);
  assert.equal(/<\/script/iu.test(bootstrap), false);
  assert.ok(bootstrap.includes("<\\/script>"));
  assert.ok(bootstrap.includes("startWidgetHost"));
});

const readResponse = (port, path, method = "GET", headers = {}) =>
  new Promise((resolve, reject) => {
    const operation = request({ host: "127.0.0.1", port, path, method, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({ status: response.statusCode, headers: response.headers, body }),
      );
    });
    operation.setTimeout(2_000, () => operation.destroy(new Error("local_http_timeout")));
    operation.once("error", reject);
    operation.end();
  });

const withServer = async (inspect) => {
  const server = createWidgetHostServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    await inspect(address.port);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

test("real HTTP GET and HEAD serve only the no-store nonce-protected synthetic host", async () => {
  await withServer(async (port) => {
    const response = await readResponse(port, "/", "GET", {
      authorization: "Bearer must-not-be-echoed",
      cookie: "private-session=must-not-be-echoed",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /^text\/html(?:;|$)/u);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.doesNotMatch(response.body, /must-not-be-echoed|private-session/u);
    const csp = response.headers["content-security-policy"];
    assert.equal(typeof csp, "string");
    const scriptNonce = /<script nonce="([A-Za-z0-9_-]+)">/u.exec(response.body)?.[1];
    assert.ok(scriptNonce);
    assert.ok(csp.includes(`'nonce-${scriptNonce}'`));
    const directives = new Map(
      csp.split(";").map((value) => {
        const [directive, ...sources] = value.trim().split(/\s+/u);
        return [directive, sources];
      }),
    );
    for (const directive of ["frame-src", "connect-src", "form-action"]) {
      assert.deepEqual(directives.get(directive), [STAGING_WEB_ORIGIN]);
    }
    assert.ok(directives.get("script-src").includes(`${STAGING_WEB_ORIGIN}/embed/widget.js`));
    assert.equal(directives.get("script-src").includes("'unsafe-inline'"), false);
    assert.equal(directives.get("script-src").includes("'unsafe-eval'"), false);
    assert.equal(csp.includes("*"), false);
    const head = await readResponse(port, "/", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(head.headers["cache-control"], "no-store");
  });
});

test("real HTTP server fails closed on writes and unsupported paths", async () => {
  await withServer(async (port) => {
    assert.equal((await readResponse(port, "/", "POST")).status, 405);
    assert.equal((await readResponse(port, "/v1/widget/conversations", "POST")).status, 405);
    assert.equal((await readResponse(port, "/other")).status, 404);
    assert.equal((await readResponse(port, "/v1/staff/me")).status, 404);
  });
});

const browserFixture = (origin = "https://8080-synthetic-preview.example") => {
  const scripts = [];
  const copied = [];
  let outboundRequests = 0;
  const element = () => {
    const listeners = new Map();
    return {
      textContent: "",
      value: "",
      disabled: false,
      dataset: {},
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      async click() {
        await listeners.get("click")?.();
      },
      async dispatch(name) {
        await listeners.get(name)?.();
      },
      remove() {
        const index = scripts.indexOf(this);
        if (index !== -1) scripts.splice(index, 1);
      },
    };
  };
  const nodes = new Map(
    ["#origin", "#copy-origin", "#installation-code", "#mount-widget", "#status"].map((id) => [
      id,
      element(),
    ]),
  );
  const document = {
    querySelector: (selector) => nodes.get(selector),
    createElement(name) {
      assert.equal(name, "script");
      return element();
    },
    body: { append: (script) => scripts.push(script) },
  };
  Object.defineProperty(document, "cookie", {
    get() {
      throw new Error("fixture_must_not_read_cookies");
    },
  });
  const browser = {
    document,
    location: { origin, protocol: new URL(origin).protocol },
    navigator: { clipboard: { writeText: (text) => copied.push(text) } },
    fetch() {
      outboundRequests += 1;
      throw new Error("fixture_must_not_call_any_api");
    },
  };
  const documentSource = buildWidgetHostDocument(nonce);
  // Match the first HTML closing tag, even if it occurs inside a JS string.
  // A greedy extraction would hide a real HTML-parser truncation defect.
  const bootstrap = /<script nonce="[A-Za-z0-9_-]+">([\s\S]*?)<\/script>/iu.exec(
    documentSource,
  )?.[1];
  assert.ok(bootstrap);
  runInNewContext(bootstrap, browser, { timeout: 1_000 });
  return {
    browser,
    nodes,
    scripts,
    copied,
    outboundRequests: () => outboundRequests,
  };
};

test("exact generated browser bootstrap survives HTML parsing and displays/copies the real HTTPS origin", async () => {
  const fixture = browserFixture();
  assert.equal(fixture.nodes.get("#origin").textContent, fixture.browser.location.origin);
  await fixture.nodes.get("#copy-origin").click();
  assert.deepEqual(fixture.copied, [fixture.browser.location.origin]);
  assert.match(fixture.nodes.get("#status").textContent, /copied/iu);
  assert.equal(fixture.scripts.length, 0);
  assert.equal(fixture.outboundRequests(), 0);
});

test("exact generated bootstrap rejects HTTP, same-origin and malformed host boundaries", async () => {
  for (const origin of [
    "http://synthetic-preview.example",
    STAGING_WEB_ORIGIN,
    "https://synthetic-preview.example/path",
  ]) {
    const fixture = browserFixture(origin);
    assert.equal(fixture.nodes.get("#mount-widget").disabled, true);
    assert.equal(fixture.nodes.get("#copy-origin").disabled, true);
    assert.equal(fixture.nodes.get("#installation-code").disabled, true);
    fixture.nodes.get("#installation-code").value = canonical;
    await fixture.nodes.get("#mount-widget").click();
    assert.equal(fixture.scripts.length, 0);
    assert.equal(fixture.outboundRequests(), 0);
  }
});

test("exact bootstrap installs only the canonical staging loader, clears input, and never sends a message", async () => {
  const fixture = browserFixture();
  fixture.nodes.get("#installation-code").value = canonical;
  await fixture.nodes.get("#mount-widget").click();
  assert.equal(fixture.scripts.length, 1);
  const loader = fixture.scripts[0];
  assert.equal(loader.src, `${STAGING_WEB_ORIGIN}/embed/widget.js`);
  assert.equal(loader.async, true);
  assert.equal(loader.dataset.widgetKey, key);
  assert.equal(loader.dataset.locale, "uz");
  assert.equal(fixture.nodes.get("#installation-code").value, "");
  assert.equal(fixture.nodes.get("#installation-code").disabled, true);
  assert.equal(fixture.nodes.get("#mount-widget").disabled, true);
  await loader.dispatch("load");
  assert.match(fixture.nodes.get("#status").textContent, /Do not send a message/u);
  await fixture.nodes.get("#mount-widget").click();
  assert.equal(fixture.scripts.length, 1);
  assert.equal(fixture.outboundRequests(), 0);
});

test("exact bootstrap shows safe feedback and installs nothing on untrusted pasted code", async () => {
  const fixture = browserFixture();
  for (const unsafe of [
    canonical.replace(STAGING_WEB_ORIGIN, "https://attacker.example"),
    `${canonical}<script>private_credential()</script>`,
    "private-token-do-not-echo",
  ]) {
    fixture.nodes.get("#installation-code").value = unsafe;
    await fixture.nodes.get("#mount-widget").click();
    assert.equal(fixture.scripts.length, 0);
    assert.equal(fixture.nodes.get("#mount-widget").disabled, false);
    assert.match(fixture.nodes.get("#status").textContent, /public installation code/u);
    assert.doesNotMatch(fixture.nodes.get("#status").textContent, /attacker|private/u);
  }
  assert.equal(fixture.outboundRequests(), 0);
});

test("script load failure removes the failed loader and requires an explicit new owner action", async () => {
  const fixture = browserFixture();
  fixture.nodes.get("#installation-code").value = canonical;
  await fixture.nodes.get("#mount-widget").click();
  await fixture.scripts[0].dispatch("error");
  assert.equal(fixture.scripts.length, 0);
  assert.equal(fixture.nodes.get("#installation-code").disabled, false);
  assert.equal(fixture.nodes.get("#mount-widget").disabled, false);
  assert.match(fixture.nodes.get("#status").textContent, /could not load/u);
  assert.equal(fixture.outboundRequests(), 0);
  fixture.nodes.get("#installation-code").value = canonical;
  await fixture.nodes.get("#mount-widget").click();
  assert.equal(fixture.scripts.length, 1);
  assert.equal(fixture.outboundRequests(), 0);
});

test("clipboard failure offers manual copying without any alternate transport", async () => {
  const fixture = browserFixture();
  fixture.browser.navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
  await fixture.nodes.get("#copy-origin").click();
  assert.match(fixture.nodes.get("#status").textContent, /manually/u);
  assert.equal(fixture.scripts.length, 0);
  assert.equal(fixture.outboundRequests(), 0);
});
