import { describe, expect, it, vi } from "vitest";
import { classifyTransportFailure, transportDiagnosticFetch } from "./network-diagnostic.js";
import { createOpenAIProvider } from "../../packages/ai/src/providers/openai.js";
import { createGeminiProvider } from "../../packages/ai/src/providers/gemini.js";
import { inputForCase, planScreen } from "./screen.js";

const transportError = (code: string, name = "Error") =>
  new TypeError("synthetic-secret-message", {
    cause: { code, name, request: "synthetic-secret-body" },
  });
describe("S13 evaluation-only safe transport diagnostics", () => {
  it.each([
    ["ENOTFOUND", "DNS"],
    ["EAI_AGAIN", "DNS"],
    ["ECONNREFUSED", "TCP_CONNECT"],
    ["UND_ERR_CONNECT_TIMEOUT", "TCP_CONNECT"],
    ["ECONNRESET", "SOCKET_RESET"],
    ["UND_ERR_SOCKET", "SOCKET_RESET"],
    ["CERT_HAS_EXPIRED", "TLS"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS"],
    ["UND_ERR_HEADERS_TIMEOUT", "CLIENT_TIMEOUT"],
    ["UND_ERR_BODY_TIMEOUT", "CLIENT_TIMEOUT"],
    ["ABORT_ERR", "ABORT"],
  ])("classifies %s without inspecting sensitive error data", (code, classification) => {
    const value = classifyTransportFailure(transportError(code), null, 12.9);
    expect(value).toMatchObject({
      errorClass: "TypeError",
      causeCode: code,
      causeName: "Error",
      classification,
      elapsedMs: 12,
      signalAborted: false,
    });
    expect(JSON.stringify(value)).not.toContain("synthetic-secret");
  });
  it("distinguishes a client deadline from cancellation even when the error is generic", () => {
    const timeout = AbortSignal.abort(new DOMException("synthetic-secret", "TimeoutError"));
    const abort = AbortSignal.abort(new DOMException("synthetic-secret", "AbortError"));
    expect(
      classifyTransportFailure(transportError("UND_ERR_SOCKET"), timeout, 60000),
    ).toMatchObject({
      classification: "CLIENT_TIMEOUT",
      signalAborted: true,
      signalReasonName: "TimeoutError",
    });
    expect(classifyTransportFailure(transportError("UND_ERR_SOCKET"), abort, 10)).toMatchObject({
      classification: "ABORT",
      signalReasonName: "AbortError",
    });
  });
  it("handles bounded AggregateError causes and distinguishes connect ETIMEDOUT", () => {
    const error = new TypeError("fetch failed", {
      cause: new AggregateError(
        [{ code: "ETIMEDOUT", syscall: "connect" }, { code: "ECONNREFUSED" }],
        "synthetic-secret",
      ),
    });
    expect(classifyTransportFailure(error, null, 1000)).toMatchObject({
      causeName: "AggregateError",
      codes: ["ETIMEDOUT", "ECONNREFUSED"],
      classification: "TCP_CONNECT",
    });
    expect(classifyTransportFailure(transportError("ETIMEDOUT"), null, 1000).classification).toBe(
      "UNKNOWN_NETWORK",
    );
  });
  it("masks arbitrary code/name strings and bounds cyclic and getter metadata", () => {
    const error: { name: string; code: string; cause?: unknown } = {
      name: "synthetic-secret-name",
      code: "CERT_synthetic-secret",
    };
    error.cause = error;
    expect(classifyTransportFailure(error, null, Infinity)).toMatchObject({
      errorClass: null,
      causeCode: null,
      causeName: null,
      codes: [],
      classification: "UNKNOWN_NETWORK",
      elapsedMs: 0,
    });
    const getter = vi.fn(() => {
      throw new Error("synthetic-secret");
    });
    expect(
      classifyTransportFailure(Object.defineProperty({}, "cause", { get: getter }), null, 0)
        .classification,
    ).toBe("UNKNOWN_NETWORK");
    expect(getter).not.toHaveBeenCalled();
    const many = new AggregateError(
      Array.from({ length: 100 }, () => transportError("ECONNRESET")),
    );
    expect(classifyTransportFailure(many, null, 1).codes.length).toBeLessThanOrEqual(8);
  });
  it("passes the same URL/options/response through without reading a body or retrying", async () => {
    const original = Response.json({ synthetic: true }),
      callback = vi.fn();
    const request = vi.fn<typeof fetch>(() => Promise.resolve(original));
    const options = { method: "GET", signal: new AbortController().signal };
    expect(
      await transportDiagnosticFetch(request, callback)(
        "https://api.openai.com/v1/models",
        options,
      ),
    ).toBe(original);
    expect(request).toHaveBeenCalledExactlyOnceWith("https://api.openai.com/v1/models", options);
    expect(original.bodyUsed).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });
  it("records only safe metadata and rethrows the exact original fetch error once", async () => {
    const error = transportError("UND_ERR_CONNECT_TIMEOUT"),
      callback = vi.fn();
    const request = vi.fn<typeof fetch>(() => Promise.reject(error));
    let tick = 10;
    await expect(
      transportDiagnosticFetch(request, callback, () => tick++)("https://api.openai.com/v1/models"),
    ).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ causeCode: "UND_ERR_CONNECT_TIMEOUT", elapsedMs: 1 }),
    );
    expect(JSON.stringify(callback.mock.calls)).not.toContain("synthetic-secret");
  });
  it.each(["openai", "gemini"] as const)(
    "preserves %s adapter mapping while capturing the cause offline",
    async (provider) => {
      const error = transportError("ECONNRESET"),
        callback = vi.fn();
      const request = vi.fn<typeof fetch>(() => Promise.reject(error));
      const wrapped = transportDiagnosticFetch(request, callback);
      const adapter =
        provider === "openai"
          ? createOpenAIProvider(
              { apiKey: "synthetic-openai-key", model: "gpt-5.6-luna", requestTimeoutMs: 60000 },
              { fetch: wrapped },
            )
          : createGeminiProvider(
              {
                apiKey: "synthetic-gemini-key",
                model: "gemini-3.8-flash",
                requestTimeoutMs: 60000,
              },
              { fetch: wrapped },
            );
      const row = planScreen()[0];
      if (row === undefined) throw new TypeError("Missing frozen fixture");
      const value = await adapter.decide(inputForCase(row.item, new AbortController().signal));
      expect(value).toMatchObject({
        kind: "provider_error",
        category: "network",
        retryable: false,
      });
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ causeCode: "ECONNRESET", classification: "SOCKET_RESET" }),
      );
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
