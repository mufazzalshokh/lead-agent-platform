import { describe, expect, it, vi } from "vitest";
import { createApi, STAFF_AUTH_LOG_REDACTION_PATHS } from "../../apps/api/src/auth/plugin.js";
import { S22_CONNECTION_FAULT_HEADER } from "../../apps/api/src/diagnostics/s22-connection-fault-admission.js";
import { staffFixture } from "../instagram/staff-fixtures.js";
import { staffSession } from "../telegram/fixtures.js";
import { SessionAuthenticationRequiredError } from "../../packages/security/src/index.js";

const fixture = () => {
  const f = staffFixture();
  const resolveSession = vi.fn(
    async (
      _header: unknown,
      token: string,
      normal: (value: string) => Promise<typeof staffSession>,
    ) => normal(token),
  );
  const api = createApi({
    staffAuth: { ...f.staffAuth, sessionConnectionProbe: { resolveSession } },
  });
  const headers = {
    ...f.headers,
    "sec-fetch-site": "same-origin",
    [S22_CONNECTION_FAULT_HEADER]: "synthetic-context",
  };
  return { ...f, api, probe: resolveSession, headers };
};
describe("S22 request-local connection probe security", () => {
  it("passes only a validated credential to the scoped resolver and preserves the response contract", async () => {
    const f = fixture();
    try {
      const result = await f.api.inject({
        method: "GET",
        url: "/v1/staff/auth/session",
        headers: f.headers,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json<unknown>()).toMatchObject({
        authenticated: true,
        session_id: staffSession.sessionId,
      });
      expect(f.probe).toHaveBeenCalledOnce();
      expect(f.resolveSession).toHaveBeenCalledOnce();
      expect(result.headers["set-cookie"]).toBeUndefined();
    } finally {
      await f.api.close();
    }
  });
  it.each([
    { cookie: "__Host-lead-session=invalid" },
    { cookie: "" },
    { origin: "https://attacker.invalid" },
  ])(
    "never lets a probe header authenticate invalid or cross-site browser input (%j)",
    async (overrides) => {
      const f = fixture();
      try {
        const result = await f.api.inject({
          method: "GET",
          url: "/v1/staff/auth/session",
          headers: { ...f.headers, ...overrides },
        });
        expect([401, 403]).toContain(result.statusCode);
        expect(f.probe).not.toHaveBeenCalled();
      } finally {
        await f.api.close();
      }
    },
  );
  it.each(["same-site", "cross-site"])(
    "requires exact same-origin probe context, while ordinary GET authentication remains unchanged (%s)",
    async (site) => {
      const f = fixture();
      try {
        expect(
          (
            await f.api.inject({
              method: "GET",
              url: "/v1/staff/auth/session",
              headers: { ...f.headers, "sec-fetch-site": site },
            })
          ).statusCode,
        ).toBe(200);
        expect(f.probe).not.toHaveBeenCalled();
        expect(f.resolveSession).toHaveBeenCalledOnce();
      } finally {
        await f.api.close();
      }
    },
  );
  it("does not install the resolver on another protected route or bypass tenant authorization", async () => {
    const f = fixture();
    try {
      expect(
        (await f.api.inject({ method: "GET", url: "/v1/staff/me", headers: f.headers })).statusCode,
      ).toBe(200);
      expect(
        (
          await f.api.inject({
            method: "GET",
            url: "/v1/staff/me",
            headers: {
              ...f.headers,
              "x-organization-context": "0193f1a8-7f65-7c28-a434-000000000002",
            },
          })
        ).statusCode,
      ).toBe(403);
      expect(f.probe).not.toHaveBeenCalled();
    } finally {
      await f.api.close();
    }
  });
  it("keeps live revocation authoritative on all ordinary routes", async () => {
    const f = fixture();
    f.resolveSession.mockRejectedValue(new SessionAuthenticationRequiredError());
    try {
      expect(
        (await f.api.inject({ method: "GET", url: "/v1/staff/me", headers: f.headers })).statusCode,
      ).toBe(401);
      expect(f.probe).not.toHaveBeenCalled();
    } finally {
      await f.api.close();
    }
  });
  it("redacts both directions of probe metadata", () => {
    expect(STAFF_AUTH_LOG_REDACTION_PATHS).toContain("req.headers.x-s22-connection-fault");
    expect(STAFF_AUTH_LOG_REDACTION_PATHS).toContain("res.headers.x-s22-connection-fault");
  });
  it("admits the real browser GET shape without an Origin header, but not incomplete metadata", async () => {
    const f = fixture();
    const headers: Record<string, string> = {
      ...f.headers,
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    };
    delete headers["origin"];
    try {
      expect(
        (await f.api.inject({ method: "GET", url: "/v1/staff/auth/session", headers })).statusCode,
      ).toBe(200);
      expect(f.probe).toHaveBeenCalledOnce();
      f.probe.mockClear();
      delete headers["sec-fetch-dest"];
      expect(
        (await f.api.inject({ method: "GET", url: "/v1/staff/auth/session", headers })).statusCode,
      ).toBe(200);
      expect(f.probe).not.toHaveBeenCalled();
    } finally {
      await f.api.close();
    }
  });
});
