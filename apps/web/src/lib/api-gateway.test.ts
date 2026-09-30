import { describe, expect, it, vi } from "vitest";

import { proxyApiRequest, requireApiUpstreamOrigin } from "./api-gateway.js";

describe("S22 same-origin API gateway", () => {
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
