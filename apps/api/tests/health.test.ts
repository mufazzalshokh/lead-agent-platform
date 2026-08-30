import { describe, expect, it } from "vitest";
import { createApi } from "../src/app.js";

describe("GET /health", () => {
  it("returns a deterministic readiness response", async () => {
    const api = createApi();

    try {
      const response = await api.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json()).toEqual({
        service: "api",
        status: "ok",
      });
    } finally {
      await api.close();
    }
  });
});
