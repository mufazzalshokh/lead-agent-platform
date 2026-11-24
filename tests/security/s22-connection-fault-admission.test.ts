import { describe, expect, it } from "vitest";
import { loadS22ConnectionFaultProfile } from "../../packages/config/src/index.js";
import { createS22ConnectionFaultAdmission } from "../../apps/api/src/diagnostics/s22-connection-fault-admission.js";
import {
  probeEnvironment,
  probeProfile,
  probeProfileValue,
} from "./s22-connection-fault-fixtures.js";
import { NOW, staffSession } from "../telegram/fixtures.js";

const fixture = () => {
  const profile = probeProfile();
  const clock = { now: NOW.getTime(), mono: 0 };
  const create = () =>
    createS22ConnectionFaultAdmission(profile, {
      wall: () => clock.now,
      monotonic: () => clock.mono,
    });
  const admission = create();
  let nonce = "-";
  const at = (milliseconds: number) => {
    clock.now = profile.baselineAt + milliseconds;
    clock.mono = clock.now - NOW.getTime();
  };
  const begin = (sequence: number, token = "t".repeat(43), action = "read") => {
    const attempt = admission.begin(`${profile.exerciseId}:${sequence}:${nonce}:${action}`, token);
    if (attempt !== null) nonce = attempt.nonce;
    return attempt;
  };
  const arm = () => {
    for (let sequence = 1; sequence <= 4; sequence++) {
      at((sequence - 1) * 15000);
      const attempt = begin(sequence);
      expect(attempt).not.toBeNull();
      expect(attempt?.finish(staffSession).state).toBe(sequence === 4 ? "admitted" : "healthy");
    }
  };
  return { profile, clock, admission, create, at, begin, arm };
};

describe("S22 connection-fault private configuration", () => {
  it("is off by default and keeps staging production-strength auth settings", () => {
    expect(loadS22ConnectionFaultProfile({}, NOW)).toEqual({ state: "off" });
    expect(loadS22ConnectionFaultProfile(probeEnvironment(), NOW).state).toBe("ready");
  });
  it.each([
    { DEPLOYMENT_ENVIRONMENT: "production" },
    { GOOGLE_CLOUD_PROJECT: "foreign" },
    { GOOGLE_CLOUD_REGION: "europe-west4" },
    { K_SERVICE: "lead-agent-staging-worker" },
    { DEPLOYMENT_GIT_SHA: "b".repeat(40) },
    { GOOGLE_CLOUD_PROJECT: undefined },
    { S22_CONNECTION_FAULT_PROFILE: "private-not-json" },
    { S22_CONNECTION_FAULT_PROFILE: "x".repeat(2049) },
  ])(
    "disables foreign, incomplete or malformed profiles without reflecting inputs (%j)",
    (overrides) => {
      expect(loadS22ConnectionFaultProfile({ ...probeEnvironment(), ...overrides }, NOW)).toEqual({
        state: "not_admitted",
      });
    },
  );
  it.each([
    { version: 2 },
    { extra: true },
    { sessionDigest: "x" },
    { faultAt: new Date().toISOString() },
    { expiresAt: "2026-02-30T10:00:00.000Z" },
    { projectId: "production" },
    { baselineAt: "invalid" },
  ])("rejects unknown fields and mutable/wrong bounds (%j)", (overrides) => {
    const env = {
      ...probeEnvironment(),
      S22_CONNECTION_FAULT_PROFILE: JSON.stringify({ ...probeProfileValue(), ...overrides }),
    };
    expect(loadS22ConnectionFaultProfile(env, NOW).state).toBe("not_admitted");
  });
  it("never admits startup at/after the baseline or a schedule more than one hour away", () => {
    expect(
      loadS22ConnectionFaultProfile(probeEnvironment(), new Date(probeProfile().baselineAt)).state,
    ).toBe("not_admitted");
    expect(
      loadS22ConnectionFaultProfile(probeEnvironment(), new Date(NOW.getTime() - 3600000)).state,
    ).toBe("not_admitted");
  });
});

describe("S22 connection-fault admission and irreversible retirement", () => {
  it("requires all four real resolutions, permits 23 cuts, then observes recovery on the normal path", () => {
    const f = fixture();
    f.arm();
    for (let sequence = 5; sequence <= 27; sequence++) {
      f.at(90000 + (sequence - 5) * 15000);
      const attempt = f.begin(sequence);
      expect(attempt?.useRelay()).toBe(true);
      expect(attempt?.shouldCut()).toBe(true);
      expect(attempt?.finish(null).state).toBe("dependency_failure");
    }
    for (let sequence = 28; sequence <= 29; sequence++) {
      f.at(450000 + (sequence - 28) * 30000);
      const attempt = f.begin(sequence);
      expect(attempt?.useRelay()).toBe(false);
      expect(attempt?.shouldCut()).toBe(false);
      expect(attempt?.finish(staffSession).state).toBe(sequence === 29 ? "recovered" : "healthy");
    }
    f.at(510000);
    expect(f.begin(30)).toBeNull();
  });
  it("caps observation at 43 tagged GETs plus the one external setup GET", () => {
    const f = fixture();
    f.arm();
    for (let sequence = 5; sequence <= 43; sequence++) {
      f.at(sequence <= 27 ? 90000 + (sequence - 5) * 15000 : 450000 + (sequence - 28) * 30000);
      expect(f.begin(sequence)?.finish(null).state).toBe("dependency_failure");
    }
    expect(f.begin(44)).toBeNull();
  });
  it("cannot cut with fewer than four baseline successes or a skipped slot", () => {
    const f = fixture();
    f.at(0);
    f.begin(1)?.finish(staffSession);
    f.at(90000);
    expect(f.begin(5)).toBeNull();
    f.at(15000);
    expect(f.begin(2)).toBeNull();
  });
  it.each(["wrong session", "rotation", "failure"])("retires on a baseline %s", (cause) => {
    const f = fixture();
    f.at(0);
    const session =
      cause === "failure"
        ? null
        : {
            ...staffSession,
            sessionId: cause === "wrong session" ? "other-session" : staffSession.sessionId,
            rotationDue: cause === "rotation",
          };
    expect(f.begin(1)?.finish(session).state).toBe("retired");
    f.at(15000);
    expect(f.begin(2)).toBeNull();
  });
  it("rejects changed credentials, replay, malformed contexts and concurrent probes", () => {
    const f = fixture();
    f.arm();
    f.at(90000);
    expect(f.begin(5, "r".repeat(43))).toBeNull();
    const g = fixture();
    g.at(0);
    const first = g.begin(1);
    expect(g.begin(2)).toBeNull();
    expect(first?.finish(staffSession).state).toBe("retired");
    const h = fixture();
    h.at(0);
    expect(h.admission.begin(["hostile"], "token")).toBeNull();
    expect(h.begin(1)).toBeNull();
  });
  it("rejects a credential rotation between baseline reads without granting cached authentication", () => {
    const f = fixture();
    f.at(0);
    f.begin(1)?.finish(staffSession);
    f.at(15000);
    expect(f.begin(2, "r".repeat(43))).toBeNull();
  });
  it("does not turn untagged traffic into a fault or let a new process inherit admission", () => {
    const f = fixture();
    f.arm();
    f.at(90000);
    expect(f.admission.begin(undefined, "t".repeat(43))).toBeNull();
    expect(f.create().begin(`${f.profile.exerciseId}:5:foreign:read`, "t".repeat(43))).toBeNull();
    expect(f.begin(5)?.shouldCut()).toBe(true);
  });
  it("rechecks expiration on socket acceptance without relying on a background timer", () => {
    const f = fixture();
    f.arm();
    f.at(90000);
    const attempt = f.begin(5);
    expect(attempt?.shouldCut()).toBe(true);
    f.at(450000);
    expect(attempt?.shouldCut()).toBe(false);
    expect(attempt?.finish(null).state).toBe("retired");
  });
  it.each(["wall rollback", "monotonic rollback", "divergence", "deadline"])(
    "retires on %s, including late callbacks",
    (kind) => {
      const f = fixture();
      f.at(0);
      const attempt = f.begin(1);
      if (kind === "wall rollback") f.clock.now -= 1;
      else if (kind === "monotonic rollback") f.clock.mono -= 1;
      else if (kind === "divergence") f.clock.now += 2001;
      else f.at(15000);
      expect(attempt?.finish(staffSession).state).toBe("retired");
      f.at(15000);
      expect(f.begin(2)).toBeNull();
    },
  );
  it("consumes an abort slot and never re-arms on replay", () => {
    const f = fixture();
    f.arm();
    f.at(90000);
    const attempt = f.begin(5, "t".repeat(43), "abort");
    expect(attempt?.useRelay()).toBe(false);
    expect(attempt?.finish(staffSession).state).toBe("retired");
    f.at(105000);
    expect(f.begin(6)).toBeNull();
  });
});
