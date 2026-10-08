import { describe, expect, it, vi } from "vitest";

import {
  proxyApiRequest,
  requireApiUpstreamOrigin,
  type WidgetReadObservation,
} from "./api-gateway.js";

const WIDGET_PLATFORM = "https://web.example.test";
const WIDGET_ID = "01a11b7d-ddbf-759e-b4e3-1602d9e22380";
const WIDGET_PATH = `/v1/widget/conversations/${WIDGET_ID}/messages`;
const WIDGET_BEARER = `Bearer ${"a".repeat(80)}`;
const widgetReadHeaders = () =>
  new Headers({
    authorization: WIDGET_BEARER,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  });

describe("S22 same-origin API gateway", () => {
  it("keeps the first Widget message readable after browser POST succeeds and same-origin GET omits Origin", async () => {
    const platform = "https://web.example.test";
    const id = "01a11b7d-ddbf-759e-b4e3-1602d9e22380";
    const origins: (string | null)[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      const origin = new Headers(init?.headers).get("origin");
      origins.push(origin);
      return Promise.resolve(
        new Response(null, {
          status: origin === platform ? (init?.method === "POST" ? 201 : 200) : 403,
        }),
      );
    });
    const post = await proxyApiRequest(
      new Request(`${platform}/v1/widget/conversations`, {
        method: "POST",
        body: "{}",
        headers: { origin: platform, authorization: `Bearer ${"a".repeat(80)}` },
      }),
      { fetchImpl, upstreamOrigin: "https://api.example.test" },
    );
    expect(post.status).toBe(201);
    const get = await proxyApiRequest(
      new Request(`https://0.0.0.0:8080/v1/widget/conversations/${id}/messages?after=1&limit=100`, {
        headers: {
          authorization: `Bearer ${"a".repeat(80)}`,
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
        },
      }),
      {
        fetchImpl,
        upstreamOrigin: "https://api.example.test",
        widgetPlatformOrigin: platform,
        report: () => undefined,
      },
    );
    expect(get.status).toBe(200);
    expect(origins).toEqual([platform, platform]);
  });

  it("forwards a versioned request byte-for-byte to only the configured upstream", async () => {
    const payload = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const inputUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(inputUrl).toBe("https://api.example.test/v1/webhooks/instagram?hub.mode=x");
      expect(init?.method).toBe("POST");
      expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(payload);
      const headers = new Headers(init?.headers);
      expect(headers.get("x-hub-signature-256")).toBe("sha256=proof");
      expect(headers.get("content-type")).toBe("application/octet-stream");
      expect(headers.has("x-forwarded-host")).toBe(false);
      expect(headers.has("forwarded")).toBe(false);
      return Promise.resolve(new Response("accepted", { status: 202 }));
    });
    const response = await proxyApiRequest(
      new Request("https://web.example.test/v1/webhooks/instagram?hub.mode=x", {
        body: payload,
        headers: {
          "content-type": "application/octet-stream",
          forwarded: "host=evil.example",
          "x-forwarded-host": "evil.example",
          "x-hub-signature-256": "sha256=proof",
        },
        method: "POST",
      }),
      { fetchImpl, upstreamOrigin: "https://api.example.test" },
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("accepted");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("preserves redirects and security cookies without following them", async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const inputUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(inputUrl).toBe(
        "https://api.example.test/v1/staff/auth/callback?code=a%2Bb%2Fc&state=s%2B1%2F2",
      );
      expect(init?.redirect).toBe("manual");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("cookie")).toBe(
        "__Host-lead-auth-transaction=sealed-transaction",
      );
      const headers = new Headers({ location: "/staff", "cache-control": "no-store" });
      headers.append(
        "set-cookie",
        "__Host-lead-session=sealed; Path=/; Secure; HttpOnly; SameSite=Lax",
      );
      headers.append("set-cookie", "__Host-lead-csrf=proof; Path=/; Secure; SameSite=Lax");
      return Promise.resolve(new Response(null, { headers, status: 303 }));
    });
    const response = await proxyApiRequest(
      new Request(
        "https://web.example.test/v1/staff/auth/callback?code=a%2Bb%2Fc&state=s%2B1%2F2",
        { headers: { cookie: "__Host-lead-auth-transaction=sealed-transaction" } },
      ),
      { fetchImpl, upstreamOrigin: "https://api.example.test" },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/staff");
    expect(response.headers.get("set-cookie")).toContain("__Host-lead-session");
    expect(response.headers.get("set-cookie")).toContain("__Host-lead-csrf");
  });

  it("rejects oversized bodies before contacting the API", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await proxyApiRequest(
      new Request("https://web.example.test/v2/staff/action", {
        body: "12345",
        method: "POST",
      }),
      { fetchImpl, maximumRequestBytes: 4, upstreamOrigin: "https://api.example.test" },
    );
    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects arbitrary upstream configuration and non-versioned paths", async () => {
    expect(() => requireApiUpstreamOrigin("https://api.example.test/path")).toThrow();
    expect(() => requireApiUpstreamOrigin("https://user:pass@api.example.test")).toThrow();
    expect(() => requireApiUpstreamOrigin("http://api.example.test")).toThrow();
    const response = await proxyApiRequest(new Request("https://web.example.test/staff"), {
      upstreamOrigin: "https://api.example.test",
    });
    expect(response.status).toBe(500);
  });
});

describe("isolated same-origin Widget read normalization", () => {
  it.each([
    [`/v1/widget/conversations/${WIDGET_ID}`, "cors", "conversation"],
    [WIDGET_PATH, "cors", "messages"],
    [WIDGET_PATH, "same-origin", "messages"],
  ])("uses trusted platform configuration for %s (%s)", async (path, mode, route) => {
    const headers = widgetReadHeaders();
    headers.set("sec-fetch-mode", mode);
    headers.set("host", "attacker.invalid");
    headers.set("forwarded", "host=attacker.invalid;proto=https");
    headers.set("x-forwarded-host", "attacker.invalid");
    headers.set("x-forwarded-proto", "https");
    headers.set("referer", "https://attacker.invalid/untrusted");
    const observations: WidgetReadObservation[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe(`https://api.example.test${path}?after=1&limit=100`);
      const forwarded = new Headers(init?.headers);
      expect(forwarded.get("origin")).toBe(WIDGET_PLATFORM);
      expect(forwarded.get("authorization")).toBe(WIDGET_BEARER);
      expect(forwarded.has("host")).toBe(false);
      expect(forwarded.has("forwarded")).toBe(false);
      expect(forwarded.has("x-forwarded-host")).toBe(false);
      return Promise.resolve(new Response("read", { status: 200 }));
    });
    const result = await proxyApiRequest(
      new Request(`https://0.0.0.0:8080${path}?after=1&limit=100`, { headers }),
      {
        fetchImpl,
        upstreamOrigin: "https://api.example.test",
        widgetPlatformOrigin: WIDGET_PLATFORM,
        report: (event) => observations.push(event),
      },
    );
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("read");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(observations).toMatchObject([
      { route, origin_present: false, origin_normalized: true, code: "forwarded", status: 200 },
    ]);
  });

  it.each([
    ["sec-fetch-site", "cross-site"],
    ["sec-fetch-site", "same-site"],
    ["sec-fetch-site", "none"],
    ["sec-fetch-site", null],
    ["sec-fetch-mode", "navigate"],
    ["sec-fetch-mode", "no-cors"],
    ["sec-fetch-mode", null],
    ["sec-fetch-dest", "iframe"],
    ["sec-fetch-dest", "document"],
    ["sec-fetch-dest", null],
    ["authorization", null],
    ["authorization", "Bearer short"],
    ["authorization", `bearer ${"a".repeat(80)}`],
    ["authorization", `Bearer ${"a".repeat(4097)}`],
    ["authorization", `Bearer ${"!".repeat(80)}`],
  ])(
    "preserves absent Origin when %s does not prove the isolated frame read (case %#)",
    async (name, value) => {
      const headers = widgetReadHeaders();
      if (value === null) headers.delete(name);
      else headers.set(name, value);
      const observations: WidgetReadObservation[] = [];
      const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
        expect(new Headers(init?.headers).has("origin")).toBe(false);
        return Promise.resolve(new Response(null, { status: 403 }));
      });
      const result = await proxyApiRequest(
        new Request(`https://web.example.test${WIDGET_PATH}`, { headers }),
        {
          fetchImpl,
          upstreamOrigin: "https://api.example.test",
          widgetPlatformOrigin: WIDGET_PLATFORM,
          report: (event) => observations.push(event),
        },
      );
      expect(result.status).toBe(403);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(observations).toMatchObject([
        { origin_present: false, origin_normalized: false, status: 403 },
      ]);
    },
  );

  it.each(["", "null", "https://foreign.example.test", WIDGET_PLATFORM])(
    "does not replace a present Origin %s",
    async (origin) => {
      const headers = widgetReadHeaders();
      headers.set("origin", origin);
      const observations: WidgetReadObservation[] = [];
      const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
        expect(new Headers(init?.headers).get("origin")).toBe(origin);
        return Promise.resolve(
          new Response(null, { status: origin === WIDGET_PLATFORM ? 200 : 403 }),
        );
      });
      const result = await proxyApiRequest(
        new Request(`https://web.example.test${WIDGET_PATH}`, { headers }),
        {
          fetchImpl,
          upstreamOrigin: "https://api.example.test",
          widgetPlatformOrigin: "invalid",
          report: (event) => observations.push(event),
        },
      );
      expect(result.status).toBe(origin === WIDGET_PLATFORM ? 200 : 403);
      expect(observations).toMatchObject([{ origin_present: true, origin_normalized: false }]);
    },
  );

  it.each([
    "/v1/widget/conversations",
    "/v1/widget/sessions",
    "/v1/widget/embed-grants",
    "/v1/widget/embed-sessions/redeem",
    "/v1/widget/telemetry",
    "/v1/staff/inbox",
    "/v2/staff/inbox",
    `${WIDGET_PATH}/`,
    `/v1/widget/conversations/${WIDGET_ID}/other`,
    "/v1/widget/conversations/12345678-1234-4234-8234-123456789012/messages",
  ])("does not normalize another route %s", async (path) => {
    const observations: WidgetReadObservation[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      expect(new Headers(init?.headers).has("origin")).toBe(false);
      return Promise.resolve(new Response(null, { status: 403 }));
    });
    const result = await proxyApiRequest(
      new Request(`https://web.example.test${path}`, { headers: widgetReadHeaders() }),
      {
        fetchImpl,
        upstreamOrigin: "https://api.example.test",
        widgetPlatformOrigin: WIDGET_PLATFORM,
        report: (event) => observations.push(event),
      },
    );
    expect(result.status).toBe(403);
    expect(observations).toEqual([]);
  });

  it.each(["POST", "HEAD", "OPTIONS", "PATCH", "PUT", "DELETE"])(
    "does not normalize %s mutations or preflight",
    async (method) => {
      const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
        expect(init?.method).toBe(method);
        expect(new Headers(init?.headers).has("origin")).toBe(false);
        return Promise.resolve(new Response(null, { status: 403 }));
      });
      const observations: WidgetReadObservation[] = [];
      const result = await proxyApiRequest(
        new Request(`https://web.example.test${WIDGET_PATH}`, {
          method,
          headers: widgetReadHeaders(),
          ...(method === "POST" ? { body: "{}" } : {}),
        }),
        {
          fetchImpl,
          upstreamOrigin: "https://api.example.test",
          widgetPlatformOrigin: WIDGET_PLATFORM,
          report: (event) => observations.push(event),
        },
      );
      expect(result.status).toBe(403);
      expect(observations).toEqual([]);
    },
  );

  it.each([
    "",
    "not-an-origin",
    "http://web.example.test",
    "https://web.example.test/",
    "https://web.example.test/path",
    "https://user:pass@web.example.test",
    "https://web.example.test?secret=private",
    "https://web.example.test#private",
    "https://WEB.example.test",
  ])(
    "fails closed before upstream when trusted platform configuration is invalid: %s",
    async (platform) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const observations: WidgetReadObservation[] = [];
      const result = await proxyApiRequest(
        new Request(`https://web.example.test${WIDGET_PATH}`, { headers: widgetReadHeaders() }),
        {
          fetchImpl,
          upstreamOrigin: "https://api.example.test",
          widgetPlatformOrigin: platform,
          report: (event) => observations.push(event),
        },
      );
      expect(result.status).toBe(500);
      expect(await result.json()).toMatchObject({ code: "gateway_configuration_invalid" });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(observations).toMatchObject([
        { code: "platform_configuration_invalid", origin_normalized: false, status: 500 },
      ]);
      if (platform.length > 0) expect(JSON.stringify(observations)).not.toContain(platform);
    },
  );

  it("fails closed when trusted platform configuration is missing", async () => {
    vi.stubEnv("WIDGET_PLATFORM_ORIGIN", undefined);
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      const result = await proxyApiRequest(
        new Request(`https://web.example.test${WIDGET_PATH}`, { headers: widgetReadHeaders() }),
        {
          fetchImpl,
          upstreamOrigin: "https://api.example.test",
          report: () => undefined,
        },
      );
      expect(result.status).toBe(500);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([401, 403, 404])(
    "leaves upstream tenant/token/session rejection %s authoritative",
    async (status) => {
      const result = await proxyApiRequest(
        new Request(`https://web.example.test${WIDGET_PATH}`, { headers: widgetReadHeaders() }),
        {
          fetchImpl: () => Promise.resolve(new Response(null, { status })),
          upstreamOrigin: "https://api.example.test",
          widgetPlatformOrigin: WIDGET_PLATFORM,
          report: () => undefined,
        },
      );
      expect(result.status).toBe(status);
    },
  );

  it("records only allowlisted Widget routing/outcome metadata, never bearer, query or cookies", async () => {
    const observations: WidgetReadObservation[] = [];
    const headers = widgetReadHeaders();
    headers.set("cookie", "PRIVATE_COOKIE_VALUE");
    headers.set("x-request-id", "PRIVATE_BROWSER_REQUEST_ID");
    const result = await proxyApiRequest(
      new Request(`https://0.0.0.0:8080${WIDGET_PATH}?after=1&token=PRIVATE_QUERY_VALUE`, {
        headers,
      }),
      {
        fetchImpl: () => Promise.resolve(new Response(null, { status: 403 })),
        upstreamOrigin: "https://api.example.test",
        widgetPlatformOrigin: WIDGET_PLATFORM,
        report: (event) => observations.push(event),
      },
    );
    expect(result.status).toBe(403);
    expect(observations).toHaveLength(1);
    expect(Object.keys(observations[0] ?? {}).sort()).toEqual(
      [
        "operation",
        "request_id",
        "conversation_id",
        "route",
        "origin_present",
        "origin_normalized",
        "code",
        "status",
      ].sort(),
    );
    expect(observations[0]).toMatchObject({
      operation: "widget_gateway_read",
      conversation_id: WIDGET_ID,
      route: "messages",
      code: "forwarded",
      status: 403,
    });
    expect(observations[0]?.request_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.stringify(observations)).not.toMatch(/PRIVATE|Bearer|after=|token=|0\.0\.0\.0/u);
  });

  it("records a sanitized upstream failure without masking its status", async () => {
    const observations: WidgetReadObservation[] = [];
    const result = await proxyApiRequest(
      new Request(`https://web.example.test${WIDGET_PATH}`, { headers: widgetReadHeaders() }),
      {
        fetchImpl: () => Promise.reject(new Error("PRIVATE_UPSTREAM_DETAIL")),
        upstreamOrigin: "https://api.example.test",
        widgetPlatformOrigin: WIDGET_PLATFORM,
        report: (event) => observations.push(event),
      },
    );
    expect(result.status).toBe(502);
    expect(observations).toMatchObject([
      { code: "upstream_request_failed", origin_normalized: true, status: 502 },
    ]);
    expect(JSON.stringify(observations)).not.toContain("PRIVATE_UPSTREAM_DETAIL");
  });

  it.each([
    { name: "upstream success", status: 200, failure: null },
    { name: "authoritative upstream rejection", status: 403, failure: null },
    { name: "upstream transport failure", status: 502, failure: "transport" },
    { name: "upstream timeout", status: 504, failure: "timeout" },
  ])(
    "a throwing observer cannot change $name or cause duplicate observation",
    async ({ status, failure }) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const reporter = vi.fn(() => {
        throw new Error("PRIVATE_OBSERVER_DETAIL");
      });
      const fetchImpl = vi.fn<typeof fetch>(() =>
        failure === null
          ? Promise.resolve(new Response("PRIVATE_RESPONSE_BODY", { status }))
          : Promise.reject(
              failure === "timeout"
                ? new DOMException("PRIVATE_UPSTREAM_DETAIL", "AbortError")
                : new Error("PRIVATE_UPSTREAM_DETAIL"),
            ),
      );
      try {
        const response = await proxyApiRequest(
          new Request(`https://web.example.test${WIDGET_PATH}`, { headers: widgetReadHeaders() }),
          {
            fetchImpl,
            upstreamOrigin: "https://api.example.test",
            widgetPlatformOrigin: WIDGET_PLATFORM,
            report: reporter,
          },
        );
        expect(response.status).toBe(status);
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(reporter).toHaveBeenCalledOnce();
        if (failure === null) expect(await response.text()).toBe("PRIVATE_RESPONSE_BODY");
        else
          expect(await response.json()).toMatchObject({
            code: failure === "timeout" ? "upstream_timeout" : "upstream_unavailable",
          });
        const emitted = [...info.mock.calls, ...error.mock.calls];
        expect(emitted).toHaveLength(1);
        expect(JSON.stringify(emitted)).not.toMatch(/PRIVATE|Bearer|authorization|cookie/u);
      } finally {
        info.mockRestore();
        error.mockRestore();
      }
    },
  );
});
