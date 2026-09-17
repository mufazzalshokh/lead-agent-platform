import { describe, expect, it, vi } from "vitest";
import { preflightInputCounts } from "./live-preflight.js";
const keys = { openai: "synthetic-openai-key", gemini: "synthetic-gemini-key" };
describe("S13 non-generation input-token preflight", () => {
  it("counts largest unchanged request with exact IDs/schema, no uploads or generations", async () => {
    const request = vi.fn<typeof fetch>((url) =>
      Promise.resolve(
        Response.json(
          url === "https://api.openai.com/v1/responses/input_tokens"
            ? { input_tokens: 2200 }
            : { totalTokens: 2300 },
        ),
      ),
    );
    expect(await preflightInputCounts(keys, request)).toMatchObject({
      openai: 2200,
      gemini: 2300,
      inputReserve: 9000,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "https://api.openai.com/v1/responses/input_tokens",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens",
    ]);
    for (const call of request.mock.calls) {
      expect(call[1]?.redirect).toBe("error");
      expect(call[1]?.body).not.toContain(keys.openai);
      expect(call[1]?.body).not.toContain(keys.gemini);
    }
  });
  it.each([null, 0, 9001, 1.5])("bad count %s halts before generations", async (input_tokens) => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ input_tokens })));
    await expect(preflightInputCounts(keys, request)).rejects.toThrow("Preflight input tokens");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("no retry/error-body disclosure on count API failure", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(keys.openai, { status: 429 })),
    );
    await expect(preflightInputCounts(keys, request)).rejects.toThrow(
      "Token-count preflight HTTP 429; no generation",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
