import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  isFixtureUrl,
  normalizeFixturePath,
  runOriginBrowser,
  waitForCdpOpen,
  formatBrowserFailure,
  preserveCleanupFailure,
  readPinnedBaseline,
} from "./s22-widget-origin-browser.mjs";

test("baseline reads exact immutable source with hidden bounded 15-second Git subprocesses", () => {
  const commit = "833901476b77b5fddfa1a7bbe7688b19ec16d26c";
  const source = "export const proxyApiRequest = () => null;\n";
  const calls = [];
  const result = readPinnedBaseline((command, args, options) => {
    calls.push({ command, args, options });
    return args[0] === "rev-parse" ? `${commit}\n` : source;
  });
  const options = {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  };
  assert.deepEqual(calls, [
    { command: "git", args: ["rev-parse", commit], options },
    { command: "git", args: ["show", `${commit}:apps/web/src/lib/api-gateway.ts`], options },
  ]);
  assert.deepEqual(result, {
    commit,
    source,
    hash: createHash("sha256").update(source).digest("hex"),
  });
});

test("a baseline timeout propagates without replacing it with current runtime source", () => {
  const timeout = Object.assign(new Error("PRIVATE_PATH"), { code: "ETIMEDOUT" });
  let calls = 0;
  assert.throws(
    () =>
      readPinnedBaseline(() => {
        calls += 1;
        throw timeout;
      }),
    (error) => error === timeout,
  );
  assert.equal(calls, 1);
  assert.equal(formatBrowserFailure(timeout, "baseline_source").code, "ETIMEDOUT");
});

test("unexpected resolved baseline is rejected before source retrieval", () => {
  let calls = 0;
  assert.throws(
    () =>
      readPinnedBaseline(() => {
        calls += 1;
        return "0000000000000000000000000000000000000000\n";
      }),
    (error) => {
      assert.equal(error.code, "BASELINE_COMMIT_MISMATCH");
      assert.equal(formatBrowserFailure(error, "baseline_source").code, "BASELINE_COMMIT_MISMATCH");
      return true;
    },
  );
  assert.equal(calls, 1);
});

for (const url of [
  "http://127.0.0.1:41001/fixture",
  "https://127.0.0.1:41002/fixture",
  "ws://127.0.0.1:41003/devtools/page/fixture",
])
  test(`only explicitly registered loopback origins may be accessed: ${new URL(url).protocol}`, () => {
    assert.equal(isFixtureUrl(url, [new URL(url).origin]), true);
    assert.equal(isFixtureUrl(url, []), false);
  });

for (const url of [
  "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app/v1/widget/conversations",
  "http://localhost:41001/fixture",
  "http://127.0.0.2:41001/fixture",
  "http://127.0.0.1:41002/fixture",
  "http://private:credential@127.0.0.1:41001/fixture",
  "file:///fixture",
  "data:text/plain,fixture",
  "not a url",
])
  test("foreign/live/credential-bearing/non-HTTP URLs fail closed", () => {
    assert.equal(isFixtureUrl(url, ["http://127.0.0.1:41001"]), false);
  });

test("safe path projection strips query values and never prints a private fixture identifier", () => {
  assert.equal(
    normalizeFixturePath("/v1/widget/conversations?bearer=PRIVATE_VALUE"),
    "/v1/widget/conversations",
  );
  assert.equal(
    normalizeFixturePath(
      "/v1/widget/conversations/01a11b80-abcd-7123-8b01-0123456789ab/messages?after=1&limit=100&bearer=PRIVATE_VALUE",
    ),
    "/v1/widget/conversations/:fixture/messages",
  );
  assert.equal(normalizeFixturePath("/v1/widget/conversations/foreign/messages"), null);
  assert.equal(normalizeFixturePath("/v1/organizations/foreign/staff"), null);
});

test("invalid modes are rejected before certificate/profile/browser creation", async () => {
  for (const modes of [[], ["staging"], "before", ["before", "external"]])
    await assert.rejects(runOriginBrowser(modes), (error) => error.code === "MODE_INVALID");
});

test("CDP lost open is bounded and closes the owned connection rather than waiting forever", async () => {
  const ws = new EventTarget();
  let closed = false;
  ws.close = () => {
    closed = true;
  };
  await assert.rejects(waitForCdpOpen(ws, 10), (error) => error.code === "CDP_CONNECTION_TIMEOUT");
  assert.equal(closed, true);
});

for (const event of ["open", "error", "close"])
  test(`CDP ${event} settles the startup promise with no dependency on a provider or browser`, async () => {
    const ws = new EventTarget();
    ws.close = () => {};
    const result = waitForCdpOpen(ws, 1000);
    ws.dispatchEvent(new Event(event));
    if (event === "open") await result;
    else
      await assert.rejects(
        result,
        (error) =>
          error.code ===
          (event === "error" ? "CDP_CONNECTION_FAILED" : "CDP_CONNECTION_CLOSED_BEFORE_OPEN"),
      );
  });

test("sanitized failure telemetry distinguishes assertions, baseline timeouts and Windows cleanup locks", () => {
  const failure = Object.assign(new Error("PRIVATE_SECRET"), {
    code: "ERR_ASSERTION",
    actual: 403,
    expected: 200,
  });
  assert.deepEqual(formatBrowserFailure(failure, "assert_get_status"), {
    code: "ERR_ASSERTION",
    stage: "assert_get_status",
    error_type: "Error",
    actual: 403,
    expected: 200,
  });
  assert.equal(
    formatBrowserFailure({ code: "ETIMEDOUT", message: "PRIVATE_SECRET" }, "baseline_source").code,
    "ETIMEDOUT",
  );
  assert.equal(
    formatBrowserFailure({ code: "EBUSY", message: "PRIVATE_SECRET" }, "temporary_cleanup").code,
    "EBUSY",
  );
  const untrusted = formatBrowserFailure(
    {
      code: "PRIVATE_SECRET",
      name: "PRIVATE_SECRET",
      actual: "PRIVATE_SECRET",
      expected: 1234567890123456,
    },
    "PRIVATE_SECRET",
  );
  assert.doesNotMatch(JSON.stringify(untrusted), /PRIVATE_SECRET|1234567890123456/u);
});

test("a cleanup lock remains FAIL and never overwrites a failed browser assertion", async () => {
  const primary = Object.assign(new Error("PRIVATE_BODY"), {
    code: "ERR_ASSERTION",
    actual: false,
    expected: true,
    safeStage: "assert_forwarded_origin",
  });
  const cleanup = Object.assign(new Error("PRIVATE_PATH"), { code: "EBUSY" });
  await assert.rejects(
    preserveCleanupFailure(async () => {
      throw cleanup;
    }, primary),
    (error) => {
      assert.equal(error, primary);
      const safe = formatBrowserFailure(error, error.safeStage);
      assert.equal(safe.code, "ERR_ASSERTION");
      assert.equal(safe.stage, "assert_forwarded_origin");
      assert.equal(safe.cleanup_failure.code, "EBUSY");
      assert.equal(safe.cleanup_failure.stage, "temporary_cleanup");
      assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_BODY|PRIVATE_PATH/u);
      return true;
    },
  );
  await assert.rejects(
    preserveCleanupFailure(async () => {
      throw cleanup;
    }),
    (error) => error.code === "EBUSY" && error.safeStage === "temporary_cleanup",
  );
});
