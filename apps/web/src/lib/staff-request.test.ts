import { describe, expect, it, vi } from "vitest";

import { createStaffAuthenticationGuard, createStaffRequest } from "./staff-request.js";

const API_ORIGIN = "https://staff.example.test";
const ORGANIZATION_HEADERS = Object.freeze({ "x-organization-context": "synthetic-organization" });

describe("staff request authentication recovery", () => {
  it("keeps a failure latched before notification and isolates different workspaces", () => {
    const observed: boolean[] = [];
    const guard = createStaffAuthenticationGuard(() => observed.push(guard.isRequired()));
    const another = createStaffAuthenticationGuard(() => undefined);
    expect(guard.isRequired()).toBe(false);
    guard.requireAuthentication();
    guard.requireAuthentication();
    expect(observed).toEqual([true, true]);
    expect(guard.isRequired()).toBe(true);
    expect(another.isRequired()).toBe(false);
  });

  it("a later successful request cannot reset a concurrent authentication failure", async () => {
    const guard = createStaffAuthenticationGuard(vi.fn());
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: {} }));
    const request = createStaffRequest({
      apiOrigin: API_ORIGIN,
      organizationHeaders: ORGANIZATION_HEADERS,
      fetchImpl,
      onAuthenticationRequired: guard.requireAuthentication,
    });
    await request("/v1/staff/integrations/widget");
    expect(guard.isRequired()).toBe(true);
    expect((await request("/v1/staff/analytics")).ok).toBe(true);
    expect(guard.isRequired()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("signals an expired session after a successful read without consuming either response", async () => {
    const authenticated = Response.json({ data: { user_id: "synthetic-user" } });
    const expired = Response.json({ code: "authentication_required" }, { status: 401 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(authenticated)
      .mockResolvedValueOnce(expired);
    const onAuthenticationRequired = vi.fn();
    const request = createStaffRequest({
      apiOrigin: API_ORIGIN,
      organizationHeaders: ORGANIZATION_HEADERS,
      fetchImpl,
      onAuthenticationRequired,
    });

    expect(await request("/v1/staff/me")).toBe(authenticated);
    expect(onAuthenticationRequired).not.toHaveBeenCalled();
    expect(await request("/v1/staff/integrations/widget")).toBe(expired);
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(authenticated.bodyUsed).toBe(false);
    expect(expired.bodyUsed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("signals each concurrent expired integration read without retrying or starting login", async () => {
    const paths = [
      "/v1/staff/integrations/telegram/status",
      "/v1/staff/integrations/instagram/status",
      "/v1/staff/integrations/widget",
    ];
    const expired = new Response(null, { status: 401 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(expired);
    const onAuthenticationRequired = vi.fn();
    const request = createStaffRequest({
      apiOrigin: API_ORIGIN,
      organizationHeaders: ORGANIZATION_HEADERS,
      fetchImpl,
      onAuthenticationRequired,
    });

    expect(await Promise.all(paths.map((path) => request(path)))).toEqual([
      expired,
      expired,
      expired,
    ]);
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(
      paths.map((path) => API_ORIGIN + path),
    );
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it.each([400, 403, 409, 429, 500, 503])(
    "returns HTTP %i without treating a policy or service denial as an expired session",
    async (status) => {
      const response = Response.json({ code: "synthetic-denial" }, { status });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
      const onAuthenticationRequired = vi.fn();
      const request = createStaffRequest({
        apiOrigin: API_ORIGIN,
        organizationHeaders: ORGANIZATION_HEADERS,
        fetchImpl,
        onAuthenticationRequired,
      });

      expect(await request("/v1/staff/integrations/widget")).toBe(response);
      expect(onAuthenticationRequired).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(response.bodyUsed).toBe(false);
    },
  );

  it("preserves the exact URL, organization, CSRF proof, mutation options and cancellation signal", async () => {
    const response = Response.json({ status: "active" }, { status: 201 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const onAuthenticationRequired = vi.fn();
    const request = createStaffRequest({
      apiOrigin: API_ORIGIN,
      organizationHeaders: ORGANIZATION_HEADERS,
      fetchImpl,
      onAuthenticationRequired,
    });
    const controller = new AbortController();
    const headers = Object.freeze({
      "content-type": "application/json",
      "x-csrf-token": "synthetic-session-proof",
      "idempotency-key": "synthetic-request-key",
      "if-match": '"synthetic-version:2"',
    });
    const body = JSON.stringify({ website_origin: "https://synthetic.example.test" });
    const init: RequestInit = {
      body,
      cache: "no-store",
      credentials: "omit",
      headers,
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
    };
    const path = "/v1/staff/integrations/widget/setup?synthetic=a%2Bb";

    expect(await request(path, init)).toBe(response);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0];
    if (call === undefined) throw new Error("Expected a single staff request");
    expect(call[0]).toBe(API_ORIGIN + path);
    expect(call[1]).toEqual({
      ...init,
      credentials: "include",
      headers: new Headers({ ...ORGANIZATION_HEADERS, ...headers }),
    });
    expect(Object.fromEntries(new Headers(call[1]?.headers))).toEqual({
      ...ORGANIZATION_HEADERS,
      ...headers,
    });
    expect(call[1]?.signal).toBe(controller.signal);
    expect(init.credentials).toBe("omit");
    expect(init.headers).toBe(headers);
    expect(onAuthenticationRequired).not.toHaveBeenCalled();
  });

  const headerInputs: readonly Readonly<{ name: string; headers: HeadersInit }>[] = [
    {
      name: "Headers",
      headers: new Headers({ "X-CSRF-Token": "synthetic-session-proof" }),
    },
    {
      name: "tuple",
      headers: [["X-CSRF-Token", "synthetic-session-proof"]],
    },
  ];
  it.each(headerInputs)(
    "preserves $name input without dropping organization context",
    async ({ headers }) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }));
      const request = createStaffRequest({
        apiOrigin: "",
        organizationHeaders: ORGANIZATION_HEADERS,
        fetchImpl,
        onAuthenticationRequired: vi.fn(),
      });

      await request("/v1/staff/action", { headers, method: "POST" });
      const call = fetchImpl.mock.calls[0];
      if (call === undefined) throw new Error("Expected a single staff request");
      expect(call[0]).toBe("/v1/staff/action");
      const sent = new Headers(call[1]?.headers);
      expect(sent.get("x-organization-context")).toBe("synthetic-organization");
      expect(sent.get("x-csrf-token")).toBe("synthetic-session-proof");
      expect(new Headers(headers).has("x-organization-context")).toBe(false);
    },
  );

  it.each([
    new TypeError("synthetic network failure"),
    new DOMException("Cancelled", "AbortError"),
  ])(
    "propagates fetch failures without inferring authentication failure or retrying",
    async (error) => {
      const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
      const onAuthenticationRequired = vi.fn();
      const request = createStaffRequest({
        apiOrigin: API_ORIGIN,
        organizationHeaders: ORGANIZATION_HEADERS,
        fetchImpl,
        onAuthenticationRequired,
      });
      const controller = new AbortController();
      controller.abort();

      await expect(request("/v1/staff/me", { signal: controller.signal })).rejects.toBe(error);
      expect(onAuthenticationRequired).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    },
  );
});
