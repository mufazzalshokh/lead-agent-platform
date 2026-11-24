// Opt-in real Chrome regression, entirely isolated loopback fixtures. No live channel/DB/provider.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { proxyApiRequest } from "../../apps/web/src/lib/api-gateway.ts";
import {
  buildWidgetFrameDocument,
  buildWidgetLoader,
} from "../../apps/web/src/lib/widget-embed.ts";

const chromeBinary = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const opensslBinary = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
const repository = fileURLToPath(new URL("../../", import.meta.url));
const baseline = "833901476b77b5fddfa1a7bbe7688b19ec16d26c";
const conversation = "01a11b80-abcd-7123-8b01-0123456789ab";
const message = "01a11b80-abce-7123-8b01-0123456789ab";
const reply = "01a11b80-abcf-7123-8b01-0123456789ab";
const fixtureText = "Synthetic browser regression only";
const safeError = (code) => Object.assign(new Error(), { code });

export const readPinnedBaseline = (run = execFileSync) => {
  const options = { cwd: repository, encoding: "utf8", windowsHide: true, timeout: 15000 };
  const commit = run("git", ["rev-parse", baseline], options).trim();
  if (commit !== baseline) throw safeError("BASELINE_COMMIT_MISMATCH");
  const source = run("git", ["show", `${baseline}:apps/web/src/lib/api-gateway.ts`], options);
  return { commit, source, hash: createHash("sha256").update(source).digest("hex") };
};

const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const until = async (read, code, milliseconds = 15000) => {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw safeError(code);
};
const listen = async (server) => {
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  return server.address().port;
};
const closeServer = async (server) => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
};
const removeFixtureDirectory = async (dir) => {
  const target = await realpath(dir),
    parent = await realpath(tmpdir());
  if (dirname(target) !== parent || !basename(target).startsWith("s22-widget-origin-browser-"))
    throw safeError("TEMP_CLEANUP_SCOPE_INVALID");
  // Chrome/AV may retain a Windows profile handle briefly after the root process exits.
  // Only the validated temporary fixture is retried; application/browser assertions stay strict.
  await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
};
export const isFixtureUrl = (value, origins) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:", "ws:"].includes(url.protocol) &&
      url.hostname === "127.0.0.1" &&
      url.username === "" &&
      url.password === "" &&
      origins.includes(url.origin)
    );
  } catch {
    return false;
  }
};
export const normalizeFixturePath = (value) => {
  try {
    const path = new URL(value, "http://127.0.0.1").pathname;
    if (path === `/v1/widget/conversations/${conversation}/messages`)
      return "/v1/widget/conversations/:fixture/messages";
    return [
      "/v1/widget/embed-grants",
      "/v1/widget/embed-sessions/redeem",
      "/v1/widget/conversations",
      "/v1/widget/telemetry",
    ].includes(path)
      ? path
      : null;
  } catch {
    return null;
  }
};
const readBody = async (request) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8192) throw safeError("FIXTURE_BODY_LIMIT");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
const replyJson = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
};
const toRequest = async (request, origin) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const part of value) headers.append(name, part);
    else if (typeof value === "string") headers.set(name, value);
  }
  const body = await readBody(request);
  return new Request(origin + request.url, {
    method: request.method,
    headers,
    ...(["GET", "HEAD"].includes(request.method) ? {} : { body, duplex: "half" }),
  });
};

export const waitForCdpOpen = (ws, timeoutMilliseconds = 5000) =>
  new Promise((done, reject) => {
    let settled = false;
    const finish = (code = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === null) done();
      else {
        try {
          ws.close();
        } catch {
          /* The connection may already be closing. */
        }
        reject(safeError(code));
      }
    };
    const timer = setTimeout(() => finish("CDP_CONNECTION_TIMEOUT"), timeoutMilliseconds);
    ws.addEventListener("open", () => finish(), { once: true });
    ws.addEventListener("error", () => finish("CDP_CONNECTION_FAILED"), { once: true });
    ws.addEventListener("close", () => finish("CDP_CONNECTION_CLOSED_BEFORE_OPEN"), { once: true });
  });
const failureCodes = new Set([
  "MODE_INVALID",
  "BASELINE_COMMIT_MISMATCH",
  "LOCAL_BROWSER_OR_TLS_TOOL_UNAVAILABLE",
  "LOCAL_BROWSER_START_FAILED",
  "LOCAL_BROWSER_CONNECTION_TIMEOUT",
  "CDP_CONNECTION_FAILED",
  "CDP_CONNECTION_TIMEOUT",
  "CDP_CONNECTION_CLOSED_BEFORE_OPEN",
  "CDP_REQUEST_FAILED",
  "CDP_REQUEST_TIMEOUT",
  "BROWSER_SCRIPT_FAILED",
  "LOCAL_BROWSER_TARGET_INVALID",
  "LOADER_RENDER_TIMEOUT",
  "FRAME_READY_TIMEOUT",
  "LOCAL_FRAME_MISSING",
  "BEFORE_EXPIRED_NOT_REPRODUCED",
  "AFTER_REPLY_NOT_RENDERED",
  "TEMP_CLEANUP_SCOPE_INVALID",
  "ERR_ASSERTION",
  "EPERM",
  "EBUSY",
  "ENOTEMPTY",
  "EACCES",
  "EADDRINUSE",
  "ETIMEDOUT",
  "ENOENT",
  "EPIPE",
  "ENOSPC",
  "ENOMEM",
  "ECONNRESET",
]);
const stages = new Set([
  "configuration",
  "tls_fixture",
  "chrome_start",
  "chrome_connect",
  "baseline_source",
  "local_servers",
  "browser_target",
  "loader_ready",
  "frame_ready",
  "browser_submit",
  "browser_outcome",
  "assert_post",
  "assert_get_headers",
  "assert_get_status",
  "assert_forwarded_origin",
  "browser_assertions_passed",
  "target_cleanup",
  "server_cleanup",
  "browser_cleanup",
  "temporary_cleanup",
]);
const failureFields = (error, stage) => ({
  code: failureCodes.has(error?.code) ? error.code : "LOCAL_BROWSER_ASSERTION_OR_TOOLING_FAILED",
  stage: stages.has(stage) ? stage : "configuration",
  error_type: ["Error", "AssertionError", "TypeError", "SystemError"].includes(error?.name)
    ? error.name
    : null,
  ...(error?.code === "ERR_ASSERTION"
    ? {
        actual:
          typeof error.actual === "boolean" ||
          (Number.isInteger(error.actual) && error.actual >= 0 && error.actual <= 599)
            ? error.actual
            : null,
        expected:
          typeof error.expected === "boolean" ||
          (Number.isInteger(error.expected) && error.expected >= 0 && error.expected <= 599)
            ? error.expected
            : null,
      }
    : {}),
});
export const formatBrowserFailure = (error, stage = "configuration") => ({
  ...failureFields(error, stage),
  ...(error?.cleanupFailure
    ? { cleanup_failure: failureFields(error.cleanupFailure.error, error.cleanupFailure.stage) }
    : {}),
});
export const preserveCleanupFailure = async (
  cleanup,
  primary = null,
  readStage = () => "temporary_cleanup",
) => {
  try {
    await cleanup();
  } catch (error) {
    if (primary) {
      primary.cleanupFailure = { error, stage: readStage() };
      throw primary;
    }
    error.safeStage = readStage();
    throw error;
  }
};
const createCdp = async (endpoint) => {
  const ws = new WebSocket(endpoint);
  const pending = new Map();
  let nextId = 0;
  await waitForCdpOpen(ws);
  ws.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    const call = pending.get(value.id);
    if (!call) return;
    pending.delete(value.id);
    clearTimeout(call.timer);
    if (value.error) call.reject(safeError("CDP_REQUEST_FAILED"));
    else call.done(value.result);
  });
  return {
    send: (method, params = {}) =>
      new Promise((done, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(safeError("CDP_REQUEST_TIMEOUT"));
        }, 5000);
        pending.set(id, { done, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => {
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(safeError("CDP_CLOSED"));
      }
      pending.clear();
      ws.close();
    },
  };
};
const evaluate = async (cdp, expression, contextId = undefined) => {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    ...(contextId === undefined ? {} : { contextId }),
  });
  if (result.exceptionDetails) throw safeError("BROWSER_SCRIPT_FAILED");
  return result.result.value;
};

export const runOriginBrowser = async (modes = ["before", "after"], report = () => {}) => {
  if (
    !Array.isArray(modes) ||
    modes.length < 1 ||
    modes.some((mode) => !["before", "after"].includes(mode))
  )
    throw safeError("MODE_INVALID");
  if (!existsSync(chromeBinary) || !existsSync(opensslBinary))
    throw safeError("LOCAL_BROWSER_OR_TLS_TOOL_UNAVAILABLE");
  const dir = await mkdtemp(join(tmpdir(), "s22-widget-origin-browser-"));
  let chrome, browserCdp;
  const servers = [];
  let stage = "configuration",
    currentMode = null,
    mainError = null;
  const mark = (next) => {
    stage = next;
    report({ operation: "s22_widget_origin_browser", outcome: "STAGE", stage, mode: currentMode });
  };
  try {
    // Prepare immutable source before Chrome starts competing for local resources.
    mark("baseline_source");
    const baselineEvidence = readPinnedBaseline();
    const beforeModule = await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(baselineEvidence.source)).toString("base64")}`
    );
    mark("tls_fixture");
    const certPath = join(dir, "certificate.pem"),
      keyPath = join(dir, "private-key.pem");
    execFileSync(
      opensslBinary,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { cwd: dir, windowsHide: true, stdio: "ignore", timeout: 15000 },
    );
    const cert = await readFile(certPath),
      key = await readFile(keyPath);
    const spki = createHash("sha256")
      .update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" }))
      .digest("base64");
    const profile = join(dir, "chrome-profile");
    await mkdir(profile);
    mark("chrome_start");
    chrome = spawn(
      chromeBinary,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        `--user-data-dir=${profile}`,
        `--ignore-certificate-errors-spki-list=${spki}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-component-update",
        "--metrics-recording-only",
        "--no-proxy-server",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    mark("chrome_connect");
    const connection = await until(async () => {
      if (chrome.exitCode !== null) throw safeError("LOCAL_BROWSER_START_FAILED");
      try {
        const data = (await readFile(join(profile, "DevToolsActivePort"), "utf8"))
          .trim()
          .split(/\r?\n/u);
        if (!/^\d+$/u.test(data[0]) || !data[1]?.startsWith("/devtools/browser/")) return null;
        return { port: Number(data[0]), endpoint: `ws://127.0.0.1:${data[0]}${data[1]}` };
      } catch {
        return null;
      }
    }, "LOCAL_BROWSER_CONNECTION_TIMEOUT");
    browserCdp = await createCdp(connection.endpoint);
    const version = await browserCdp.send("Browser.getVersion");
    const results = [];
    for (const mode of modes) {
      currentMode = mode;
      mark("local_servers");
      const proxy = mode === "before" ? beforeModule.proxyApiRequest : proxyApiRequest;
      const bearer = randomBytes(64).toString("base64url"),
        nextBearer = randomBytes(64).toString("base64url");
      const grant = `wex1.${randomBytes(32).toString("base64url")}.${randomBytes(32).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
      const keyFixture = randomBytes(32).toString("base64url");
      const observation = [],
        forwarded = [];
      let appOrigin, hostOrigin;
      const upstream = createHttpServer(async (request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname;
        const headers = {
          "access-control-allow-origin":
            path === "/v1/widget/embed-grants" ? hostOrigin : appOrigin,
          "access-control-allow-methods": "POST, GET, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, idempotency-key",
        };
        if (request.method === "OPTIONS") {
          response.writeHead(204, headers);
          response.end();
          return;
        }
        const approvedOrigin = path === "/v1/widget/embed-grants" ? hostOrigin : appOrigin;
        const originMatches = request.headers.origin === approvedOrigin;
        forwarded.push({
          method: request.method,
          path: normalizeFixturePath(path),
          origin_matches: originMatches,
        });
        if (!originMatches) {
          replyJson(response, 403, { code: "authorization_denied" }, headers);
          return;
        }
        if (path === "/v1/widget/embed-grants") {
          replyJson(
            response,
            201,
            {
              data: {
                exchange_grant: grant,
                iframe_url: appOrigin + "/widget/frame",
                iframe_origin: appOrigin,
              },
            },
            headers,
          );
        } else if (path === "/v1/widget/embed-sessions/redeem") {
          replyJson(
            response,
            200,
            {
              data: {
                bearer_token: bearer,
                expires_at: new Date(Date.now() + 120000).toISOString(),
              },
            },
            headers,
          );
        } else if (
          path === "/v1/widget/conversations" &&
          request.method === "POST" &&
          request.headers.authorization === `Bearer ${bearer}`
        ) {
          replyJson(
            response,
            201,
            {
              data: {
                bearer_token: nextBearer,
                expires_at: new Date(Date.now() + 120000).toISOString(),
                conversation: { id: conversation },
                message: { id: message, sequence_no: 1 },
              },
            },
            headers,
          );
        } else if (
          path === `/v1/widget/conversations/${conversation}/messages` &&
          request.method === "GET" &&
          request.headers.authorization === `Bearer ${nextBearer}`
        ) {
          replyJson(
            response,
            200,
            {
              data: [{ id: reply, sequence_no: 2, direction: "outbound", body_text: fixtureText }],
            },
            headers,
          );
        } else if (
          path === "/v1/widget/telemetry" &&
          request.headers.authorization === `Bearer ${nextBearer}`
        ) {
          replyJson(response, 200, { data: {} }, headers);
        } else replyJson(response, 401, { code: "token_invalid" }, headers);
      });
      servers.push(upstream);
      const upstreamOrigin = `http://127.0.0.1:${await listen(upstream)}`;
      const app = createHttpsServer({ cert, key }, async (request, response) => {
        try {
          const url = new URL(request.url, appOrigin);
          if (url.pathname === "/embed/widget.js") {
            response.writeHead(200, {
              "content-type": "text/javascript",
              "cache-control": "no-store",
            });
            response.end(buildWidgetLoader(appOrigin));
            return;
          }
          if (url.pathname === "/widget/frame" && request.method === "POST") {
            const incoming = await toRequest(request, appOrigin),
              form = await incoming.formData();
            const instance = form.get("instance");
            if (form.get("exchange_grant") !== grant) throw safeError("FIXTURE_GRANT_INVALID");
            response.writeHead(200, {
              "content-type": "text/html",
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            });
            response.end(
              buildWidgetFrameDocument({
                apiOrigin: appOrigin,
                embeddingOrigin: hostOrigin,
                exchangeGrant: grant,
                instance,
                nonce: randomBytes(24).toString("base64url"),
              }),
            );
            return;
          }
          if (!url.pathname.startsWith("/v1/widget/")) {
            response.writeHead(404);
            response.end();
            return;
          }
          const incoming = await toRequest(request, appOrigin);
          const outgoing = await proxy(incoming, {
            upstreamOrigin,
            widgetPlatformOrigin: appOrigin,
            report: () => {},
            fetchImpl: (target, options) => {
              if (!isFixtureUrl(String(target), [upstreamOrigin]))
                throw safeError("NON_LOOPBACK_UPSTREAM_FORBIDDEN");
              return fetch(target, options);
            },
          });
          observation.push({
            method: incoming.method,
            path: normalizeFixturePath(url.pathname),
            browser_origin_present: incoming.headers.has("origin"),
            browser_sec_fetch_site: incoming.headers.get("sec-fetch-site"),
            status: outgoing.status,
          });
          response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
          response.end(Buffer.from(await outgoing.arrayBuffer()));
        } catch {
          response.writeHead(500);
          response.end("Local fixture unavailable.");
        }
      });
      servers.push(app);
      appOrigin = `https://127.0.0.1:${await listen(app)}`;
      const host = createHttpsServer({ cert, key }, (_request, response) => {
        response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
        response.end(
          `<!doctype html><html><body><script>window.fixtureReady=false;window.fixtureExpired=false;addEventListener('message',e=>{if(e.origin!==${JSON.stringify(appOrigin)})return;if(e.data?.type==='READY')window.fixtureReady=true;if(e.data?.type==='EXPIRED')window.fixtureExpired=true;});</script><script async src="${appOrigin}/embed/widget.js" data-widget-key="${keyFixture}"></script></body></html>`,
        );
      });
      servers.push(host);
      hostOrigin = `https://127.0.0.1:${await listen(host)}`;
      mark("browser_target");
      const target = await browserCdp.send("Target.createTarget", { url: hostOrigin });
      const pages = await (
        await fetch(`http://127.0.0.1:${connection.port}/json/list`, {
          signal: AbortSignal.timeout(3000),
        })
      ).json();
      const page = pages.find((candidate) => candidate.id === target.targetId);
      if (!page || !isFixtureUrl(page.webSocketDebuggerUrl, [`ws://127.0.0.1:${connection.port}`]))
        throw safeError("LOCAL_BROWSER_TARGET_INVALID");
      const cdp = await createCdp(page.webSocketDebuggerUrl);
      let targetError = null;
      try {
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        mark("loader_ready");
        await until(
          () => evaluate(cdp, "Boolean(document.querySelector('button'))"),
          "LOADER_RENDER_TIMEOUT",
        );
        await evaluate(cdp, "document.querySelector('button').click();true");
        mark("frame_ready");
        await until(() => evaluate(cdp, "window.fixtureReady===true"), "FRAME_READY_TIMEOUT");
        const frames = await cdp.send("Page.getFrameTree");
        const childFrame = frames.frameTree.childFrames?.[0]?.frame.id;
        if (!childFrame) throw safeError("LOCAL_FRAME_MISSING");
        const context = await cdp.send("Page.createIsolatedWorld", {
          frameId: childFrame,
          worldName: "s22-local-regression",
        });
        mark("browser_submit");
        await evaluate(
          cdp,
          "document.querySelector('.input').focus();true",
          context.executionContextId,
        );
        await cdp.send("Input.insertText", { text: fixtureText });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
        mark("browser_outcome");
        if (mode === "before")
          await until(
            () =>
              evaluate(
                cdp,
                "window.fixtureExpired===true && !document.querySelector('iframe') && document.querySelector('button').textContent==='Start a new chat'",
              ),
            "BEFORE_EXPIRED_NOT_REPRODUCED",
          );
        else
          await until(
            () =>
              evaluate(
                cdp,
                `Boolean(document.querySelector('.business')?.textContent.includes(${JSON.stringify(fixtureText)})) && !document.querySelector('.input').disabled`,
                context.executionContextId,
              ),
            "AFTER_REPLY_NOT_RENDERED",
          );
        const post = observation.find(
          (row) => row.path === "/v1/widget/conversations" && row.method === "POST",
        );
        const get = observation.find(
          (row) =>
            row.path === "/v1/widget/conversations/:fixture/messages" && row.method === "GET",
        );
        mark("assert_post");
        assert.equal(post?.status, 201);
        assert.equal(post.browser_origin_present, true);
        mark("assert_get_headers");
        assert.equal(get?.browser_origin_present, false);
        assert.equal(get.browser_sec_fetch_site, "same-origin");
        mark("assert_get_status");
        assert.equal(get.status, mode === "before" ? 403 : 200);
        const getForwarded = forwarded.find(
          (row) =>
            row.path === "/v1/widget/conversations/:fixture/messages" && row.method === "GET",
        );
        mark("assert_forwarded_origin");
        assert.equal(getForwarded?.origin_matches, mode === "after");
        mark("browser_assertions_passed");
        results.push({
          mode,
          outcome: "PASS",
          evidence: "real Chrome / local HTTPS / strict mocked upstream",
          baseline_commit: baselineEvidence.commit,
          baseline_source_sha256: baselineEvidence.hash,
          browser_version: /^Chrome\/[0-9.]+$/u.test(version.product)
            ? version.product
            : "Chromium",
          post,
          get,
          forwarded_get_origin_matches: getForwarded.origin_matches,
          expired_frame_and_restart_label: mode === "before",
          retained_frame_and_synthetic_reply: mode === "after",
          no_live_db_provider_or_owner_profile: true,
        });
      } catch (error) {
        targetError = error;
        error.safeStage = stage;
        report({
          operation: "s22_widget_origin_browser",
          outcome: "FAIL",
          mode: currentMode,
          ...formatBrowserFailure(error, stage),
        });
        throw error;
      } finally {
        mark("target_cleanup");
        cdp.close();
        await preserveCleanupFailure(
          () => browserCdp.send("Target.closeTarget", { targetId: target.targetId }),
          targetError,
          () => stage,
        );
      }
      mark("server_cleanup");
      for (const server of servers.splice(0)) await closeServer(server);
    }
    return results;
  } catch (error) {
    mainError = error;
    error.safeStage = stages.has(error.safeStage) ? error.safeStage : stage;
    report({
      operation: "s22_widget_origin_browser",
      outcome: "FAIL",
      mode: currentMode,
      ...formatBrowserFailure(error, error.safeStage),
    });
    throw error;
  } finally {
    await preserveCleanupFailure(
      async () => {
        mark("server_cleanup");
        for (const server of servers) await closeServer(server);
        mark("browser_cleanup");
        if (browserCdp) {
          try {
            await browserCdp.send("Browser.close");
          } catch {
            // Browser.close may close its transport before replying; own-child cleanup still runs below.
          }
          browserCdp.close();
        }
        if (chrome && chrome.exitCode === null) {
          await Promise.race([new Promise((done) => chrome.once("exit", done)), delay(2000)]);
          if (chrome.exitCode === null) chrome.kill();
        }
        mark("temporary_cleanup");
        await removeFixtureDirectory(dir);
      },
      mainError,
      () => stage,
    );
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => !["before", "after", "both"].includes(arg)))
      throw safeError("MODE_INVALID");
    const result = await runOriginBrowser(
      !args[0] || args[0] === "both" ? ["before", "after"] : args,
      (row) => console.log(JSON.stringify(row)),
    );
    for (const row of result) console.log(JSON.stringify(row));
  } catch (error) {
    console.log(
      JSON.stringify({
        operation: "s22_widget_origin_browser",
        outcome: "FAIL",
        ...formatBrowserFailure(error, error?.safeStage),
      }),
    );
    process.exitCode = 1;
  }
}
