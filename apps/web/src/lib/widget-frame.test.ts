import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import NextNodeServer from "next/dist/server/next-server.js";
import { NodeNextRequest } from "next/dist/server/base-http/node.js";
import { NextRequestAdapter } from "next/dist/server/web/spec-extension/adapters/next-request.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { renderWidgetFrame } from "./widget-frame.js";

const PLATFORM = "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app";
const HOST = "https://8080-synthetic-preview.example";
const GRANT = `wex1.${"a".repeat(64)}.${"b".repeat(64)}.${"c".repeat(32)}`;
const INSTANCE = "synthetic_instance_1234567890";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

const form = (grant = GRANT, instance = INSTANCE): URLSearchParams =>
  new URLSearchParams({ exchange_grant: grant, instance });
const request = (grant = GRANT, instance = INSTANCE): Request =>
  new Request(`${PLATFORM}/widget/frame`, { body: form(grant, instance), method: "POST" });
const policy = (iframe = PLATFORM): Response =>
  Response.json({
    data: { embedding_origin: HOST, iframe_origin: iframe },
    meta: { request_id: "request:req-policy-1" },
  });

const adaptedProxyRequest = (): Request => {
  // Run the installed standalone framework's actual URL construction and adapter.
  // No listener/socket connection is opened and no real grant is requested.
  const incoming = new IncomingMessage(new Socket());
  incoming.method = "POST";
  incoming.url = "/widget/frame";
  incoming.headers = {
    host: new URL(PLATFORM).host,
    "x-forwarded-host": new URL(PLATFORM).host,
    "x-forwarded-proto": "https",
    "content-type": "application/x-www-form-urlencoded",
  };
  incoming.push(Buffer.from(form().toString()));
  incoming.push(null);
  const nodeRequest = new NodeNextRequest(incoming);
  const attach: unknown = Reflect.get(NextNodeServer.prototype, "attachRequestMeta");
  if (typeof attach !== "function") throw new TypeError("Installed Next metadata hook missing");
  Reflect.apply(
    attach,
    {
      fetchHostname: "0.0.0.0",
      port: 8080,
      nextConfig: { experimental: { trustHostHeader: false } },
    },
    [nodeRequest, { query: {} }, false],
  );
  return NextRequestAdapter.fromNodeNextRequest(nodeRequest, new AbortController().signal);
};

type Options = Parameters<typeof renderWidgetFrame>[1];
const render = async (input: Request, options: Options): Promise<Response> =>
  (await import("./widget-frame.js")).renderWidgetFrame(input, options);
const options = (fetchImpl: typeof fetch): Options => ({
  apiOrigin: PLATFORM,
  platformOrigin: PLATFORM,
  fetchImpl,
  report: () => undefined,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Widget frame proxy context and failure diagnostics", () => {
  it("original standalone frame route renders a valid public policy instead of rejecting its internal URL", async () => {
    const input = adaptedProxyRequest();
    expect(new URL(input.url).origin).toBe("https://0.0.0.0:8080");
    expect(input.headers.get("host")).toBe(new URL(PLATFORM).host);
    vi.stubEnv("WIDGET_PUBLIC_API_ORIGIN", PLATFORM);
    vi.stubEnv("WIDGET_PLATFORM_ORIGIN", PLATFORM);
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(policy()));
    vi.stubGlobal("fetch", fetchImpl);
    const { POST } = await import("../app/widget/frame/route.js");
    const response = await POST(input);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("renders the actual installed Next internal-origin context using only trusted configured platform policy", async () => {
    const input = adaptedProxyRequest();
    expect(new URL(input.url).origin).not.toBe(PLATFORM);
    const fetchImpl = vi.fn<typeof fetch>((url, init) => {
      expect(url).toBe(`${PLATFORM}/v1/widget/embed-policy`);
      expect(init?.method).toBe("POST");
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      if (typeof init?.body !== "string") throw new TypeError("Expected policy JSON text");
      const policyInput: unknown = JSON.parse(init.body);
      expect(policyInput).toEqual({ exchange_grant: GRANT });
      expect(new Headers(init?.headers).get("x-request-id")).toMatch(UUID);
      return Promise.resolve(policy());
    });
    const events: unknown[] = [];
    const response = await render(input, {
      ...options(fetchImpl),
      report: (event) => events.push(event),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`frame-ancestors ${HOST}`);
    expect(csp).toContain(`connect-src ${PLATFORM}`);
    expect(csp).not.toContain("*");
    expect(await response.text()).toContain("/v1/widget/embed-sessions/redeem");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: "widget_frame_bootstrap",
      outcome: "ready",
      request_id: response.headers.get("x-request-id"),
    });
    expect(JSON.stringify(events)).not.toContain(GRANT);
  });

  it.each([
    ["malformed grant", "invalid", INSTANCE],
    ["short grant", "wex1.a.b.c", INSTANCE],
    ["malformed instance", GRANT, "<unsafe>"],
    ["short instance", GRANT, "short"],
  ])("fails before policy fetch for %s", async (_name, grant, instance) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await render(request(grant, instance), options(fetchImpl));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Chat is temporarily unavailable.");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("rejects unparseable form input before policy fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await render(
      new Request(`${PLATFORM}/widget/frame`, { body: "not a form", method: "POST" }),
      options(fetchImpl),
    );
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, PLATFORM],
    [PLATFORM, undefined],
    ["http://api.example", PLATFORM],
    [PLATFORM, "https://platform.example/path"],
    ["https://user:private@api.example", PLATFORM],
  ])(
    "fails closed on missing or invalid trusted origins (%s, %s)",
    async (apiOrigin, platformOrigin) => {
      vi.stubEnv("WIDGET_PUBLIC_API_ORIGIN", "");
      vi.stubEnv("WIDGET_PLATFORM_ORIGIN", "");
      const fetchImpl = vi.fn<typeof fetch>();
      const response = await render(request(), {
        ...(apiOrigin === undefined ? {} : { apiOrigin }),
        ...(platformOrigin === undefined ? {} : { platformOrigin }),
        fetchImpl,
        report: () => undefined,
      });
      expect(response.status).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("does not authorize a foreign policy origin from spoofed request/forwarded headers", async () => {
    const foreign = "https://attacker.example";
    const input = new Request(`${foreign}/widget/frame`, {
      body: form(),
      method: "POST",
      headers: {
        host: "attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
        forwarded: "host=attacker.example;proto=https",
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(policy(foreign)));
    const response = await render(input, options(fetchImpl));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Chat is temporarily unavailable.");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    "not-json",
    JSON.stringify({ data: null }),
    JSON.stringify({
      data: { embedding_origin: "http://invalid.example", iframe_origin: PLATFORM },
    }),
    JSON.stringify({ data: { embedding_origin: HOST, iframe_origin: `${PLATFORM}/path` } }),
  ])("fails safely for malformed policy response %s", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(body)));
    const response = await render(request(), options(fetchImpl));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Chat is temporarily unavailable.");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports only allowlisted correlation and policy metadata without leaking credentials or payloads", async () => {
    const privateMarker = "private-credential-must-not-leak";
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            code: "token_invalid",
            request_id: "request:req-policy-safe",
            detail: privateMarker,
            provider_payload: privateMarker,
          },
          { status: 401 },
        ),
      ),
    );
    const events: unknown[] = [];
    const response = await render(request(), {
      ...options(fetchImpl),
      report: (event) => events.push(event),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: "widget_frame_bootstrap",
      outcome: "unavailable",
      request_id: response.headers.get("x-request-id"),
      policy_status: 401,
      policy_code: "token_invalid",
      policy_request_id: "request:req-policy-safe",
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(GRANT);
    expect(serialized).not.toContain(privateMarker);
    expect(serialized).not.toContain("provider_payload");
    expect(await response.text()).toBe("Chat is temporarily unavailable.");
  });

  it("rejects arbitrary dependency codes/request IDs from sanitized telemetry", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            code: "private-secret-unrecognized",
            request_id: `private-secret-${GRANT}`,
          },
          { status: 503 },
        ),
      ),
    );
    const events: unknown[] = [];
    const response = await render(request(), {
      ...options(fetchImpl),
      report: (event) => events.push(event),
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(events)).not.toContain("private-secret");
    expect(JSON.stringify(events)).not.toContain(GRANT);
  });

  it("bounds rejected dependencies with safe diagnostics and no retry or redeem", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error(`private-url/${GRANT}`)));
    const events: unknown[] = [];
    const response = await render(request(), {
      ...options(fetchImpl),
      report: (event) => events.push(event),
    });
    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).not.toContain("private-url");
    expect(JSON.stringify(events)).not.toContain(GRANT);
  });

  it("times out the policy dependency without repeating it or redeeming the grant", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const events: unknown[] = [];
    const response = await render(request(), {
      ...options(fetchImpl),
      timeoutMilliseconds: 5,
      report: (event) => events.push(event),
    });
    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "unavailable", code: "policy_timeout" });
  });

  it("reports a policy-body timeout as timeout, not malformed JSON, without retries", async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), {
            once: true,
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const events: unknown[] = [];
    const response = await render(request(), {
      ...options(fetchImpl),
      timeoutMilliseconds: 5,
      report: (event) => events.push(event),
    });
    expect(response.status).toBe(400);
    expect(events[0]).toMatchObject({
      outcome: "unavailable",
      code: "policy_timeout",
      policy_status: 200,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 15_001, Number.NaN])(
    "rejects invalid timeout %s before contacting dependency",
    async (timeoutMilliseconds) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const response = await render(request(), { ...options(fetchImpl), timeoutMilliseconds });
      expect(response.status).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
