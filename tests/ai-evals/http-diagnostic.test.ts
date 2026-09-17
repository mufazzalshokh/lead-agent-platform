import { describe, expect, it, vi } from "vitest";
import { diagnosticFetch, type HTTPDiagnostic } from "./http-diagnostic.js";
const url = "https://api.openai.com/v1/responses";
describe("S13 sanitized HTTP diagnostic boundary", () => {
  it.each([null, "RATE_LIMIT_EXCEEDED"])(
    "Gemini quota status alone is not proof of throttling: %s",
    async (reason) => {
      let diagnostic: HTTPDiagnostic | null = null;
      const body = {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "synthetic-sensitive",
          details: reason === null ? [] : [{ reason, metadata: "synthetic-sensitive" }],
        },
      };
      await diagnosticFetch(
        () => Promise.resolve(Response.json(body, { status: 429 })),
        (value) => {
          diagnostic = value;
        },
      )("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
      expect(diagnostic).toEqual({ status: 429, code: reason, category: "RESOURCE_EXHAUSTED" });
      expect(JSON.stringify(diagnostic)).not.toContain("synthetic-sensitive");
    },
  );
  it.each([
    "insufficient_quota",
    "credit_balance_exhausted",
    "rate_limit_exceeded",
    "project_spend_limit_exceeded",
    "slow_down",
  ])("retains status and safe %s only", async (code) => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code,
              type: "insufficient_quota",
              message: "synthetic-sensitive-message",
              param: "synthetic-key",
            },
          },
          { status: 429, headers: { "retry-after": "2" } },
        ),
      ),
    );
    let value: HTTPDiagnostic | null = null;
    const response = await diagnosticFetch(request, (v) => {
      value = v;
    })(url);
    expect(value).toEqual({ status: 429, code, category: "insufficient_quota" });
    expect(await response.text()).toBe("");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(JSON.stringify(value)).not.toContain("sensitive");
    expect(JSON.stringify(value)).not.toContain("synthetic-key");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["<html>synthetic-secret</html>", "x".repeat(16385)])(
    "malformed/oversized body is not emitted",
    async (body) => {
      const response = await diagnosticFetch(
        () => Promise.resolve(new Response(body, { status: 429 })),
        () => {},
      )(url);
      expect(response.status).toBe(429);
      expect(await response.text()).toBe("");
    },
  );
  it("arbitrary code/type cannot leak identifiers or credential-shaped strings", async () => {
    let value: HTTPDiagnostic | null = null;
    await diagnosticFetch(
      () =>
        Promise.resolve(
          Response.json(
            { error: { code: "synthetic-sensitive-code", type: "synthetic-sensitive-type" } },
            { status: 429 },
          ),
        ),
      (v) => {
        value = v;
      },
    )(url);
    expect(value).toEqual({ status: 429, code: "unrecognized", category: "unrecognized" });
  });
  it("success response is passed through uninspected", async () => {
    const original = Response.json({ output: "synthetic" });
    const callback = vi.fn();
    expect(await diagnosticFetch(() => Promise.resolve(original), callback)(url)).toBe(original);
    expect(callback).not.toHaveBeenCalled();
  });
});
