import {
  canonicalUtc,
  connectionFaultSlot,
  runtimeProfileJson,
  validateConnectionFaultProfile,
} from "./s22-connection-fault-profile.mjs";

export const connectionFaultStaffOrigin = "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app";
const path = "/v1/staff/auth/session";
const header = "x-s22-connection-fault";
const safe = (condition) => {
  if (!condition) throw new Error("S22_CONNECTION_FAULT_BROWSER_DENIED");
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const exact = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const sessionKeys = [
  "absolute_expires_at",
  "assurance",
  "assurance_fresh",
  "authenticated",
  "idle_expires_at",
  "session_id",
  "user_id",
];

async function sessionBinding(text, digest, now) {
  safe(typeof text === "string" && new TextEncoder().encode(text).length <= 4096);
  const value = JSON.parse(text);
  safe(
    exact(value, sessionKeys) &&
      value.authenticated === true &&
      uuid.test(value.session_id) &&
      uuid.test(value.user_id),
  );
  safe(
    typeof value.assurance === "string" &&
      value.assurance.length > 0 &&
      value.assurance.length <= 32 &&
      typeof value.assurance_fresh === "boolean",
  );
  const absoluteExpiry = canonicalUtc(value.absolute_expires_at);
  const idleExpiry = canonicalUtc(value.idle_expires_at);
  safe(absoluteExpiry > now && idleExpiry > now);
  const sessionDigest = await digest(value.session_id);
  safe(typeof sessionDigest === "string" && /^[a-f0-9]{64}$/u.test(sessionDigest));
  // No raw response, user ID or application session ID escapes this function.
  return Object.freeze({ sessionDigest, absoluteExpiry, idleExpiry });
}

/** Explicitly constructed adapter; importing this file performs no requests.
 * Browser cookies remain HttpOnly; fetch supplies credentials normally. No URL,
 * method, cookie, organization or custom authentication input is accepted.
 */
export function createConnectionFaultBrowserAdapter(browser) {
  safe(
    browser.window === browser &&
      browser.top === browser &&
      browser.location.origin === connectionFaultStaffOrigin &&
      browser.location.pathname === "/staff",
  );
  safe(browser.isSecureContext === true && browser.document.visibilityState === "visible");
  const requireContext = () =>
    safe(
      browser.location.origin === connectionFaultStaffOrigin &&
        browser.location.pathname === "/staff" &&
        browser.document.visibilityState === "visible",
    );
  return Object.freeze({
    wall: () => browser.Date.now(),
    monotonic: () => browser.performance.now(),
    setTimer: (callback, delay) => browser.setTimeout(callback, delay),
    clearTimer: (timer) => browser.clearTimeout(timer),
    digest: async (text) =>
      [
        ...new Uint8Array(
          await browser.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    request: async ({ wire, signal }) => {
      requireContext();
      const response = await browser.fetch(path, {
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
        headers: wire === null ? {} : { [header]: wire },
      });
      safe(!response.redirected && response.url === connectionFaultStaffOrigin + path);
      requireContext();
      const metadata = response.headers.get(header);
      safe(metadata === null || metadata.length <= 256);
      // Fault/error bodies can contain internal error text. Do not parse or retain them.
      if (response.status !== 200) {
        await response.body?.cancel();
        return { status: response.status, metadata, body: null };
      }
      safe(response.headers.get("content-type")?.startsWith("application/json"));
      const reader = response.body?.getReader();
      safe(reader !== undefined);
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          safe(length <= 4096);
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return {
        status: response.status,
        metadata,
        body: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      };
    },
  });
}

// The setup helper and run controller share this one-shot context. A setup/run
// failure cannot silently make another setup GET; constructing a new run is not
// an automatic recovery path and never shifts the fixed profile window.
export function createConnectionFaultBrowserController(adapter) {
  const { wall, monotonic, setTimer, clearTimer, digest, request } = adapter;
  let setupUsed = false;
  let runUsed = false;
  let binding = null;
  let stopRequested = false;
  let abortRequested = false;
  let activeCancel = null;
  let wake = null;
  let nonce = "-";
  let requestCount = 0;
  const originWall = wall();
  const originMono = monotonic();
  let lastWall = originWall;
  let lastMono = originMono;
  const sample = () => {
    const current = wall();
    const mono = monotonic();
    safe(
      Number.isFinite(current) &&
        Number.isFinite(mono) &&
        current >= lastWall &&
        mono >= lastMono &&
        Math.abs(current - originWall - (mono - originMono)) <= 2000,
    );
    lastWall = current;
    lastMono = mono;
    return current;
  };
  const deadlineTask = async (operation, deadline) => {
    safe(activeCancel === null);
    const abort = new AbortController();
    activeCancel = () => abort.abort();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          safe(!abort.signal.aborted);
          return operation(abort.signal);
        }),
        new Promise((_, reject) => {
          const rejectStopped = () => {
            abort.abort();
            reject(new Error("S22_CONNECTION_FAULT_REQUEST_STOPPED"));
          };
          timer = setTimer(rejectStopped, Math.max(0, deadline - sample()));
          abort.signal.addEventListener(
            "abort",
            () => reject(new Error("S22_CONNECTION_FAULT_REQUEST_STOPPED")),
            { once: true },
          );
        }),
      ]);
    } finally {
      clearTimer(timer);
      abort.abort();
      activeCancel = null;
    }
  };
  const bounded = (wire, deadline, consume) => {
    safe(requestCount < 44);
    requestCount++;
    return deadlineTask(async (signal) => consume(await request({ wire, signal })), deadline);
  };
  const wait = async (at) => {
    const delay = at - sample();
    safe(delay >= 0);
    if (delay > 0)
      await new Promise((resolve) => {
        const timer = setTimer(() => {
          wake = null;
          resolve();
        }, delay);
        wake = () => {
          clearTimer(timer);
          wake = null;
          resolve();
        };
      });
    safe(!stopRequested);
    // Timer delay is a missed slot, not permission to catch up. Allow only the
    // same two-second clock tolerance as the server, never its whole 15s slot.
    const now = sample();
    safe(now >= at && now - at <= 2000);
  };
  const controller = {
    setup: async () => {
      safe(!setupUsed && !runUsed && !stopRequested);
      setupUsed = true;
      try {
        const deadline = sample() + 15_000;
        binding = await bounded(null, deadline, async (result) => {
          safe(sample() < deadline && result.status === 200 && result.metadata === null);
          return sessionBinding(result.body, digest, sample());
        });
        safe(sample() < deadline && !stopRequested);
        return binding;
      } catch {
        binding = null;
        throw new Error("S22_CONNECTION_FAULT_SETUP_STOPPED");
      }
    },
    stop: () => {
      stopRequested = true;
      activeCancel?.();
      wake?.();
    },
    // An operator-requested abort consumes the next ORIGINAL scheduled slot.
    // It does not add traffic or interrupt a current DB operation as proof.
    requestAbort: () => {
      abortRequested = true;
    },
    run: async (rawProfile) => {
      safe(!runUsed);
      runUsed = true;
      const evidence = [];
      let profileReceipt = {};
      let counts = { baseline: 0, fault: 0, recovery: 0, abort: 0 };
      let conclusion = "stopped";
      let healthy = 0;
      try {
        safe(binding !== null && !stopRequested);
        const profile = validateConnectionFaultProfile(rawProfile, sample());
        safe(
          binding.sessionDigest === profile.sessionDigest &&
            Math.min(binding.absoluteExpiry, binding.idleExpiry) > profile.expiresAt + 465_000,
        );
        profileReceipt = await deadlineTask(
          async () => ({
            exercise_id: profile.exerciseId,
            source_sha: profile.sourceSha,
            configuration_sha256: await digest(rawProfile),
            runtime_profile_sha256: await digest(runtimeProfileJson(profile)),
          }),
          Math.min(sample() + 15_000, profile.baselineAt),
        );
        for (let sequence = 1; sequence <= 43; sequence++) {
          const slot = connectionFaultSlot(profile, sequence);
          await wait(slot.at);
          const phase = abortRequested ? "abort" : slot.phase;
          const started = sample();
          const deadline = Math.min(started + 15_000, slot.at + 15_000);
          const metadata = await bounded(
            `${profile.exerciseId}:${sequence}:${nonce}:${phase === "abort" ? "abort" : "read"}`,
            deadline,
            async (response) => {
              safe(sample() < deadline && !stopRequested);
              safe(typeof response.metadata === "string" && response.metadata.length <= 256);
              const metadata = JSON.parse(response.metadata);
              safe(
                exact(metadata, ["phase", "sequence", "nonce", "state"]) &&
                  metadata.phase === phase &&
                  metadata.sequence === sequence,
              );
              safe(
                typeof metadata.nonce === "string" && /^[A-Za-z0-9_-]{32}$/u.test(metadata.nonce),
              );
              if (sequence === 1) nonce = metadata.nonce;
              else safe(metadata.nonce === nonce);
              let valid = false;
              if (phase === "abort") {
                valid = metadata.state === "retired" && response.status === 200;
                if (valid)
                  safe(
                    (await sessionBinding(response.body, digest, sample())).sessionDigest ===
                      binding.sessionDigest,
                  );
              } else if (phase === "fault") {
                valid = response.status === 500 && metadata.state === "dependency_failure";
              } else if (response.status === 200) {
                const current = await sessionBinding(response.body, digest, sample());
                safe(current.sessionDigest === binding.sessionDigest);
                const state =
                  phase === "baseline"
                    ? sequence === 4
                      ? "admitted"
                      : "healthy"
                    : healthy === 1
                      ? "recovered"
                      : "healthy";
                valid = metadata.state === state;
                if (phase === "recovery") healthy++;
              } else if (phase === "recovery") {
                valid = response.status === 500 && metadata.state === "dependency_failure";
                healthy = 0;
              }
              safe(valid);
              return metadata;
            },
          );
          // Hashing/parsing time is included in the finite slot deadline too.
          safe(sample() < deadline && !stopRequested);
          counts[phase]++;
          evidence.push(
            Object.freeze({
              at: new Date(started).toISOString(),
              duration_ms: Math.max(0, Math.round(sample() - started)),
              phase,
              sequence,
              state: metadata.state,
              intended_cut: phase === "fault",
            }),
          );
          if (phase === "abort") {
            conclusion = "aborted";
            break;
          }
          if (phase === "recovery" && healthy === 2) {
            conclusion = "client_recovered_server_evidence_required";
            break;
          }
        }
      } catch {
        // No response/parser/provider exception reaches evidence or Console.
        conclusion = "stopped";
      } finally {
        nonce = "-";
        binding = null;
        activeCancel?.();
        wake?.();
      }
      return Object.freeze({
        ...profileReceipt,
        conclusion,
        request_count: requestCount,
        counts: Object.freeze(counts),
        observations: Object.freeze(evidence),
        transport_cut_proven: false,
        notification_delivery_proven: false,
      });
    },
  };
  return Object.freeze(controller);
}
