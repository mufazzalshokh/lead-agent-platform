import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createS22ConnectionFaultAdmission } from "../../apps/api/src/diagnostics/s22-connection-fault-admission.ts";
import {
  createConnectionFaultBrowserAdapter,
  createConnectionFaultBrowserController,
  connectionFaultStaffOrigin,
} from "./s22-connection-fault-browser.mjs";
import {
  connectionFaultSlot,
  validateConnectionFaultProfile,
} from "./s22-connection-fault-profile.mjs";
import {
  fakeBrowser,
  hash,
  sessionBody,
  syntheticNow,
  syntheticRawProfile,
  syntheticSession,
} from "./s22-connection-fault-test-fixtures.mjs";

const prepared = async () => {
  const adapter = fakeBrowser();
  const controller = createConnectionFaultBrowserController(adapter);
  const binding = await controller.setup();
  return { adapter, controller, binding };
};
const run = async (f) => f.adapter.drive(f.controller.run(syntheticRawProfile()));
test("import and construction never make a request; setup is one-shot and exports only local binding", async () => {
  const adapter = fakeBrowser();
  const controller = createConnectionFaultBrowserController(adapter);
  assert.equal(adapter.calls.length, 0);
  const binding = await controller.setup();
  assert.deepEqual(Object.keys(binding).sort(), ["absoluteExpiry", "idleExpiry", "sessionDigest"]);
  assert.equal(binding.sessionDigest, hash(syntheticSession));
  assert.equal(JSON.stringify(binding).includes(syntheticSession), false);
  await assert.rejects(controller.setup());
  assert.equal(adapter.calls.length, 1);
});
test("exact baseline/fault/recovery schedule, two real healthy client reads, finite content-free evidence", async () => {
  const f = await prepared();
  const result = await run(f);
  assert.equal(result.conclusion, "client_recovered_server_evidence_required");
  assert.deepEqual(result.counts, { baseline: 4, fault: 23, recovery: 2, abort: 0 });
  assert.equal(result.request_count, 30);
  assert.equal(f.adapter.calls.length, 30);
  const profile = validateConnectionFaultProfile(syntheticRawProfile());
  for (const [index, call] of f.adapter.calls.slice(1).entries()) {
    assert.equal(call.at, connectionFaultSlot(profile, index + 1).at);
    assert.equal(
      call.wire,
      `${profile.exerciseId}:${index + 1}:${index === 0 ? "-" : "n".repeat(32)}:read`,
    );
  }
  assert.equal(result.transport_cut_proven, false);
  assert.equal(result.notification_delivery_proven, false);
  const text = JSON.stringify(result);
  for (const privateValue of [
    syntheticSession,
    "n".repeat(32),
    profile.sessionDigest,
    "user_id",
    "body",
    "cookie",
  ])
    assert.equal(text.includes(privateValue), false);
  assert.equal(f.adapter.timers.size, 0);
  await assert.rejects(f.controller.run(syntheticRawProfile()));
});
test("44 total GET maximum; recovery failures never extend the fixed 16 slots", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  adapter.request = async (input) => {
    const result = await original(input);
    if (input.wire !== null && Number(input.wire.split(":")[1]) >= 28)
      return {
        status: 500,
        metadata: result.metadata.replace(/"state":"[^"]+"/u, '"state":"dependency_failure"'),
        body: null,
      };
    return result;
  };
  const controller = createConnectionFaultBrowserController(adapter);
  await controller.setup();
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(result.request_count, 44);
  assert.deepEqual(result.counts, { baseline: 4, fault: 23, recovery: 16, abort: 0 });
  assert.equal(result.conclusion, "stopped");
  assert.equal(adapter.timers.size, 0);
});
for (const [name, mutate] of [
  [
    "missing metadata / cold start",
    (r) => {
      r.metadata = null;
    },
  ],
  [
    "oversized metadata",
    (r) => {
      r.metadata = "x".repeat(257);
    },
  ],
  [
    "malformed metadata",
    (r) => {
      r.metadata = "private {";
    },
  ],
  [
    "foreign phase",
    (r) => {
      r.metadata = r.metadata.replace("baseline", "fault");
    },
  ],
  [
    "foreign sequence",
    (r) => {
      r.metadata = r.metadata.replace('"sequence":1', '"sequence":2');
    },
  ],
  [
    "retired / rotation-due",
    (r) => {
      r.metadata = r.metadata.replace('"state":"healthy"', '"state":"retired"');
    },
  ],
  [
    "changed session",
    (r) => {
      r.body = sessionBody("0193f1a8-7f65-7c28-a434-000000000003");
    },
  ],
  [
    "redirect/auth failure",
    (r) => {
      r.status = 401;
    },
  ],
  [
    "additional metadata field",
    (r) => {
      r.metadata = r.metadata.replace("}", ',"private":"no"}');
    },
  ],
  [
    "bad nonce",
    (r) => {
      r.metadata = r.metadata.replace("n".repeat(32), "bad");
    },
  ],
])
  test(`stop with no retry on ${name}`, async () => {
    const adapter = fakeBrowser();
    const original = adapter.request;
    adapter.request = async (input) => {
      const result = await original(input);
      if (input.wire !== null) mutate(result);
      return result;
    };
    const controller = createConnectionFaultBrowserController(adapter);
    await controller.setup();
    const result = await adapter.drive(controller.run(syntheticRawProfile()));
    assert.equal(result.conclusion, "stopped");
    assert.equal(result.request_count, 2);
    assert.equal(adapter.calls.length, 2);
    assert.equal(adapter.timers.size, 0);
  });
test("nonce change on second response stops instead of adopting another process", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  adapter.request = async (input) => {
    const r = await original(input);
    if (input.wire?.split(":")[1] === "2")
      r.metadata = r.metadata.replace("n".repeat(32), "m".repeat(32));
    return r;
  };
  const controller = createConnectionFaultBrowserController(adapter);
  await controller.setup();
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(result.request_count, 3);
  assert.equal(result.conclusion, "stopped");
});
test("fault HTTP 500 without expected metadata is not accepted as a cut", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  adapter.request = async (input) => {
    const r = await original(input);
    if (input.wire?.split(":")[1] === "5") r.metadata = null;
    return r;
  };
  const controller = createConnectionFaultBrowserController(adapter);
  await controller.setup();
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(result.request_count, 6);
  assert.equal(result.counts.fault, 0);
});
test("fourth baseline must explicitly admit; an ordinary healthy response is insufficient", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  adapter.request = async (input) => {
    const r = await original(input);
    if (input.wire?.split(":")[1] === "4") r.metadata = r.metadata.replace("admitted", "healthy");
    return r;
  };
  const controller = createConnectionFaultBrowserController(adapter);
  await controller.setup();
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(result.request_count, 5);
  assert.equal(result.counts.fault, 0);
});
test("delayed callback misses its slot and cannot catch up", async () => {
  const f = await prepared();
  const result = await f.adapter.drive(f.controller.run(syntheticRawProfile()), 2001);
  assert.equal(result.request_count, 1);
  assert.equal(result.conclusion, "stopped");
});
for (const [name, monoDelta, at] of [
  ["forward wall skew", 0, syntheticNow + 60_000],
  ["backward wall", 1, syntheticNow - 1],
  ["backward monotonic", -1, syntheticNow + 60_000],
])
  test(`stop on ${name}`, async () => {
    const f = await prepared();
    f.adapter.advance(at, monoDelta);
    const result = await f.adapter.drive(f.controller.run(syntheticRawProfile()));
    assert.equal(result.conclusion, "stopped");
    assert.equal(result.request_count, 1);
  });
test("missing response has a 15-second deadline, aborts locally, and creates no next GET", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  let hangingSignal;
  adapter.request = async (input) => {
    if (input.wire === null) return original(input);
    hangingSignal = input.signal;
    return new Promise(() => {});
  };
  const controller = createConnectionFaultBrowserController(adapter);
  await controller.setup();
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(result.request_count, 2);
  assert.equal(hangingSignal.aborted, true);
  assert.equal(result.conclusion, "stopped");
  assert.equal(adapter.timers.size, 0);
});
test("setup processing is bounded too; a hung digest cannot leave the controller pending", async () => {
  const adapter = fakeBrowser();
  adapter.digest = async () => new Promise(() => {});
  const controller = createConnectionFaultBrowserController(adapter);
  await assert.rejects(adapter.drive(controller.setup()), {
    message: "S22_CONNECTION_FAULT_SETUP_STOPPED",
  });
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.timers.size, 0);
});
test("explicit abort uses the next scheduled slot, then stops without rearming", async () => {
  const f = await prepared();
  f.controller.requestAbort();
  const result = await run(f);
  assert.equal(result.conclusion, "aborted");
  assert.equal(result.request_count, 2);
  assert.equal(f.adapter.calls[1].at, syntheticNow + 60_000);
  assert.match(f.adapter.calls[1].wire, /:1:-:abort$/u);
});
test("operator stop cancels a waiting run with no extra abort request", async () => {
  const f = await prepared();
  const done = f.controller.run(syntheticRawProfile());
  await f.adapter.flush();
  f.controller.stop();
  const result = await done;
  assert.equal(result.request_count, 1);
  assert.equal(result.conclusion, "stopped");
  assert.equal(f.adapter.timers.size, 0);
});
test("requests never overlap, even when each response takes time", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  let active = 0;
  let maxActive = 0;
  adapter.request = async (input) => {
    active++;
    maxActive = Math.max(maxActive, active);
    const result = await original(input);
    await new Promise((resolve) => adapter.setTimer(resolve, 1000));
    active--;
    return result;
  };
  const controller = createConnectionFaultBrowserController(adapter);
  await adapter.drive(controller.setup());
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
  assert.equal(result.conclusion, "client_recovered_server_evidence_required");
});
test("lost abort response consumes its slot and makes no replacement request", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  adapter.request = async (input) =>
    input.wire?.endsWith(":abort") ? new Promise(() => {}) : original(input);
  const controller = createConnectionFaultBrowserController(adapter);
  await controller.setup();
  controller.requestAbort();
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(result.request_count, 2);
  assert.equal(result.conclusion, "stopped");
});
test("actual deployed admission state machine accepts the controller wire contract", async () => {
  const adapter = fakeBrowser();
  const original = adapter.request;
  const admission = createS22ConnectionFaultAdmission(
    validateConnectionFaultProfile(syntheticRawProfile()),
    { wall: adapter.wall, monotonic: adapter.monotonic },
  );
  adapter.request = async (input) => {
    const response = await original(input);
    if (input.wire === null) return response;
    const attempt = admission.begin(input.wire, "synthetic-private-credential");
    assert.notEqual(attempt, null);
    const session =
      attempt.phase === "fault" ? null : { rotationDue: false, sessionId: syntheticSession };
    return { ...response, metadata: JSON.stringify(attempt.finish(session)) };
  };
  const controller = createConnectionFaultBrowserController(adapter);
  await controller.setup();
  const result = await adapter.drive(controller.run(syntheticRawProfile()));
  assert.equal(result.conclusion, "client_recovered_server_evidence_required");
  assert.equal(admission.isRetired(), true);
  assert.equal(result.transport_cut_proven, false);
});
test("no run without setup, no late startup, no foreign digest or unknown rotation deadline claim", async () => {
  const adapter = fakeBrowser();
  const controller = createConnectionFaultBrowserController(adapter);
  assert.equal((await controller.run(syntheticRawProfile())).request_count, 0);
  const f = await prepared();
  const p = JSON.parse(syntheticRawProfile());
  p.sessionDigest = "0".repeat(64);
  assert.equal((await f.controller.run(JSON.stringify(p))).request_count, 1);
  const later = await prepared();
  later.adapter.advance(syntheticNow + 60_000);
  assert.equal((await later.controller.run(syntheticRawProfile())).request_count, 1);
});
const browserFixture = () => {
  const calls = [];
  const browser = {
    location: { origin: connectionFaultStaffOrigin, pathname: "/staff" },
    isSecureContext: true,
    document: { visibilityState: "visible" },
    Date,
    performance,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    fetch: async (...args) => {
      calls.push(args);
      const response = new Response(sessionBody(), {
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(response, "url", {
        value: connectionFaultStaffOrigin + "/v1/staff/auth/session",
      });
      return response;
    },
  };
  browser.window = browser;
  browser.top = browser;
  return { browser, calls };
};
test("browser adapter uses only fixed same-origin staff GET with ordinary credentials", async () => {
  const f = browserFixture();
  const adapter = createConnectionFaultBrowserAdapter(f.browser);
  assert.equal(f.calls.length, 0);
  await adapter.request({ wire: null, signal: new AbortController().signal });
  assert.equal(f.calls[0][0], "/v1/staff/auth/session");
  assert.deepEqual(f.calls[0][1].headers, {});
  assert.equal(f.calls[0][1].method, "GET");
  assert.equal(f.calls[0][1].credentials, "same-origin");
  assert.equal(f.calls[0][1].redirect, "error");
});
for (const change of [
  (b) => {
    b.location.origin = "https://foreign.invalid";
  },
  (b) => {
    b.location.pathname = "/embed";
  },
  (b) => {
    b.top = {};
  },
  (b) => {
    b.document.visibilityState = "hidden";
  },
  (b) => {
    b.isSecureContext = false;
  },
])
  test("browser adapter rejects wrong frame/origin/page/context without fetching", () => {
    const f = browserFixture();
    change(f.browser);
    assert.throws(() => createConnectionFaultBrowserAdapter(f.browser));
    assert.equal(f.calls.length, 0);
  });
test("browser adapter rechecks hidden/navigation state before every GET", async () => {
  const f = browserFixture();
  const adapter = createConnectionFaultBrowserAdapter(f.browser);
  f.browser.document.visibilityState = "hidden";
  await assert.rejects(adapter.request({ wire: null, signal: new AbortController().signal }));
  assert.equal(f.calls.length, 0);
});
test("controller module has no storage, cookie export, logging or automatic execution", () => {
  const source = readFileSync(
    new URL("./s22-connection-fault-browser.mjs", import.meta.url),
    "utf8",
  );
  for (const banned of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "console.",
    "setInterval(",
    "XMLHttpRequest",
  ])
    assert.equal(source.includes(banned), false);
});
