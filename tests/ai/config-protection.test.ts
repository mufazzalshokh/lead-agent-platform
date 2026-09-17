import { describe, expect, it } from "vitest";
import { loadOpenAIHarnessConfig } from "../../packages/config/src/index.js";
import { createAIProposalProtection } from "../../packages/security/src/index.js";
import { AI_REFERENCE, fixtureId } from "./fixtures.js";

describe("S12 configuration and protected proposals", () => {
  it("uses explicit model configuration without selecting or pinning a production model", () =>
    expect(
      loadOpenAIHarnessConfig({
        OPENAI_API_KEY: "synthetic-test-api-key",
        AI_MODEL: "model-owned-by-test",
      }),
    ).toMatchObject({ model: "model-owned-by-test", requestTimeoutMs: 15_000 }));
  it.each([
    { OPENAI_API_KEY: "" },
    { AI_MODEL: "" },
    { AI_MODEL: "latest" },
    { AI_MODEL: "model with spaces" },
    { AI_REQUEST_TIMEOUT_MS: "0" },
    { AI_REQUEST_TIMEOUT_MS: "120001" },
    { AI_REQUEST_TIMEOUT_MS: "NaN" },
  ])("rejects invalid config without exposing secrets %o", (override) => {
    const environment = {
      OPENAI_API_KEY: "synthetic-test-api-key",
      AI_MODEL: "configured-test-model",
      ...override,
    };
    try {
      loadOpenAIHarnessConfig(environment);
      throw new Error("Should reject");
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-test-api-key");
      expect(error).toMatchObject({ code: "configuration_invalid" });
    }
  });
  it("encrypts proposal arguments with tenant/run binding and separate purpose", () => {
    const protection = createAIProposalProtection({
      currentEncryptionKey: new Uint8Array(32).fill(31),
      currentKeyId: "s12-test-key",
      lookupKey: new Uint8Array(32).fill(32),
    });
    const context = { organizationId: AI_REFERENCE.organizationId, runId: fixtureId(12200) };
    const ciphertext = protection.protect({
      ...context,
      argumentsJSON: '{"type":"request_information","field":"phone"}',
    });
    expect(Buffer.from(ciphertext).toString("utf8")).not.toContain("request_information");
    expect(protection.reveal({ ...context, ciphertext })).toBe(
      '{"type":"request_information","field":"phone"}',
    );
    expect(() => protection.reveal({ ...context, runId: fixtureId(12201), ciphertext })).toThrow(
      "Protected customer data is unavailable",
    );
    expect(() =>
      protection.reveal({ ...context, ciphertext: new Uint8Array(ciphertext).fill(0) }),
    ).toThrow("Protected customer data is unavailable");
  });
});
