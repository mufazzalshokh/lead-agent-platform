import { describe, expect, it, vi } from "vitest";

import {
  createGoogleSecretManagerCredentialStore,
  createGoogleSecretManagerCredentialStoreFromEnvironment,
  type GoogleSecretManagerClient,
} from "@lead-agent/integrations";

const resource = "projects/lead-agent-staging-123/secrets/channel-credentials";
const version = `${resource}/versions/7`;

const client = (): GoogleSecretManagerClient => ({
  addSecretVersion: vi.fn(() => Promise.resolve([{ name: version }] as const)),
  accessSecretVersion: vi.fn(() =>
    Promise.resolve([{ payload: { data: Buffer.from("token-value", "utf8") } }] as const),
  ),
  destroySecretVersion: vi.fn(() => Promise.resolve([{}] as const)),
});

describe("Google Secret Manager credential store", () => {
  it("stores, reads and destroys only versions under its configured secret", async () => {
    const fake = client();
    const store = createGoogleSecretManagerCredentialStore(resource, fake);

    const reference = await store.put("token-value");
    expect(reference).toBe(`gcp-secret://${version}`);
    await expect(store.get(reference)).resolves.toBe("token-value");
    await expect(store.delete(reference)).resolves.toBeUndefined();
    expect(fake.addSecretVersion).toHaveBeenCalledWith({
      parent: resource,
      payload: { data: Buffer.from("token-value", "utf8") },
    });
    expect(fake.accessSecretVersion).toHaveBeenCalledWith({ name: version });
    expect(fake.destroySecretVersion).toHaveBeenCalledWith({ name: version });
  });

  it("fails closed for malformed or cross-resource references", async () => {
    const store = createGoogleSecretManagerCredentialStore(resource, client());
    await expect(store.get("testsecret://instagram/1")).rejects.toThrow(
      "Invalid credential reference",
    );
    await expect(
      store.delete("gcp-secret://projects/lead-agent-staging-123/secrets/other-channel/versions/1"),
    ).rejects.toThrow("Credential reference is out of scope");
  });

  it("maps missing or destroyed versions to null without suppressing other failures", async () => {
    const missing = client();
    vi.mocked(missing.accessSecretVersion).mockRejectedValueOnce({ code: 5 });
    const store = createGoogleSecretManagerCredentialStore(resource, missing);
    await expect(store.get(`gcp-secret://${version}`)).resolves.toBeNull();

    vi.mocked(missing.accessSecretVersion).mockRejectedValueOnce(new Error("permission denied"));
    await expect(store.get(`gcp-secret://${version}`)).rejects.toThrow("permission denied");
  });

  it("loads only from an explicit canonical environment resource", () => {
    expect(createGoogleSecretManagerCredentialStoreFromEnvironment({}, client())).toBeUndefined();
    expect(
      createGoogleSecretManagerCredentialStoreFromEnvironment(
        { CREDENTIAL_SECRET_RESOURCE: resource },
        client(),
      ),
    ).toBeDefined();
    expect(() =>
      createGoogleSecretManagerCredentialStoreFromEnvironment(
        { CREDENTIAL_SECRET_RESOURCE: "projects/other/secrets/x" },
        client(),
      ),
    ).toThrow("CREDENTIAL_SECRET_RESOURCE");
  });
});
