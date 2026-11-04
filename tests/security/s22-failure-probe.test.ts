import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { createApi, type StaffAuthDependencies } from "../../apps/api/src/app.js";
import { SessionDatabaseError } from "../../packages/database/src/index.js";
import { staffFixture } from "../instagram/staff-fixtures.js";
import { staffSession } from "../telegram/fixtures.js";

const path = "/v1/staff/auth/session";
const fixture = () => {
  // Reuse only the common auth fixture; no messaging/business use cases are mounted.
  const auth = staffFixture();
  const createSession = vi.spyOn(auth.staffAuth.sessions, "createSession");
  const revokeSession = vi.spyOn(auth.staffAuth.sessions, "revokeSession");
  const revokeUserSessions = vi.spyOn(auth.staffAuth.sessions, "revokeUserSessions");
  const rotateSession = vi.fn<StaffAuthDependencies["sessions"]["rotateSession"]>(() =>
    Promise.resolve({
      csrfSecret: "c".repeat(43),
      evictedSessionCount: 0,
      session: staffSession,
      sessionToken: "r".repeat(43),
    }),
  );
  const api = createApi({
    staffAuth: {
      ...auth.staffAuth,
      sessions: {
        ...auth.staffAuth.sessions,
        createSession,
        revokeSession,
        revokeUserSessions,
        rotateSession,
      },
    },
  });
  return { ...auth, api, createSession, revokeSession, revokeUserSessions, rotateSession };
};

describe("S22 failure-drill probe contract (offline only)", () => {
  it("returns 200 → sanitized 500 → 200 with the same fresh credential and no auth mutation API calls", async () => {
    const f = fixture();
    try {
      expect(
        (await f.api.inject({ method: "GET", url: path, headers: f.headers })).statusCode,
      ).toBe(200);
      f.resolveSession.mockRejectedValueOnce(new SessionDatabaseError());
      const failure = await f.api.inject({ method: "GET", url: path, headers: f.headers });
      expect(failure.statusCode).toBe(500);
      expect(failure.json<unknown>()).toMatchObject({
        code: "internal_error",
        status: 500,
        instance: path,
      });
      expect(failure.body).not.toMatch(
        /SessionDatabaseError|session_database_error|postgres|stack|t{43}/u,
      );
      expect(failure.headers["set-cookie"]).toBeUndefined();
      expect(
        (await f.api.inject({ method: "GET", url: path, headers: f.headers })).statusCode,
      ).toBe(200);
      expect(f.resolveSession).toHaveBeenCalledTimes(3);
      for (const mutation of [
        f.createSession,
        f.revokeSession,
        f.revokeUserSessions,
        f.rotateSession,
      ])
        expect(mutation).not.toHaveBeenCalled();
    } finally {
      await f.api.close();
    }
  });

  it("keeps health at 200 and anonymous session requests at 401 even when the dependency fails", async () => {
    const f = fixture();
    f.resolveSession.mockRejectedValue(new SessionDatabaseError());
    try {
      expect((await f.api.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      expect((await f.api.inject({ method: "GET", url: path })).statusCode).toBe(401);
      expect(f.resolveSession).not.toHaveBeenCalled();
    } finally {
      await f.api.close();
    }
  });

  it("can rotate a due session on GET, so the probe must not be described as write-free", async () => {
    const f = fixture();
    f.resolveSession.mockResolvedValue({ ...staffSession, rotationDue: true });
    try {
      const response = await f.api.inject({ method: "GET", url: path, headers: f.headers });
      expect(response.statusCode).toBe(200);
      expect(f.rotateSession).toHaveBeenCalledOnce();
      expect(response.headers["set-cookie"]).toBeDefined();
    } finally {
      await f.api.close();
    }
  });

  it("does not treat an invalid credential as a database-failure signal", async () => {
    const f = fixture();
    try {
      const response = await f.api.inject({
        method: "GET",
        url: path,
        headers: { ...f.headers, cookie: "__Host-lead-session=invalid" },
      });
      expect(response.statusCode).toBe(401);
      expect(f.resolveSession).not.toHaveBeenCalled();
      expect(f.rotateSession).not.toHaveBeenCalled();
    } finally {
      await f.api.close();
    }
  });

  it("records the deployed resolver's session-metadata writes rather than inferring read-only behavior from SELECT", async () => {
    const sql = await readFile("packages/database/drizzle/0015_s6_session_lifecycle.sql", "utf8");
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION app.resolve_application_session(");
    const end = sql.indexOf("CREATE OR REPLACE FUNCTION app.rotate_application_session(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const resolver = sql.slice(start, end);
    expect(resolver).toContain("VOLATILE");
    expect(resolver).toContain("last_seen_at = GREATEST");
    expect(resolver).toContain("idle_expires_at = LEAST");
    expect([...resolver.matchAll(/UPDATE\s+public\.([a-z_]+)/gu)].map((match) => match[1])).toEqual(
      ["auth_sessions", "auth_sessions", "auth_sessions"],
    );
  });
});
