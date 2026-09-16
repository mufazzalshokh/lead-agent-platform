import { describe, expect, it, vi } from "vitest";
import {
  createInstagramBusinessUseCases,
  instagramAccountRouteHash,
  instagramConversationIdentity,
  InstagramProviderError,
  type InstagramConnection,
  type InstagramPersistenceStore,
  type CanonicalInboundPersistenceStore,
  type PreparedCanonicalInbound,
  type CredentialSecretStore,
  type InstagramOAuthClient,
} from "../../packages/application/src/index.js";
import {
  ACCOUNT_ID,
  CUSTOMER_ID,
  IDS,
  NONCE,
  NOW,
  TOKEN,
  authorization,
  dataProtection,
  digest,
  instagramConfig,
} from "./fixtures.js";

const context = { organizationId: IDS.organization, channelConnectionId: IDS.channel };
const fixture = () => {
  let now = NOW;
  let routeHash = digest(NONCE);
  let connection: InstagramConnection = {
    accountId: null,
    credentialReference: null,
    credentialVersion: 1,
    credentialIssuedAt: null,
    expiresAt: null,
    onboardingExpiresAt: new Date(NOW.getTime() + 600000).toISOString(),
    stateHash: routeHash,
    status: "pending",
  };
  const values = new Map<string, string>();
  let secretNumber = 0;
  const operations: string[] = [];
  const deleteCredential = vi.fn<CredentialSecretStore["delete"]>((key) => {
    operations.push("secret.delete");
    values.delete(key);
    return Promise.resolve();
  });
  const credentials: CredentialSecretStore = {
    put: vi.fn<CredentialSecretStore["put"]>((value) => {
      operations.push("secret.put");
      const key = `testsecret://instagram/${++secretNumber}`;
      values.set(key, value);
      return Promise.resolve(key);
    }),
    get: vi.fn<CredentialSecretStore["get"]>((key) => Promise.resolve(values.get(key) ?? null)),
    delete: deleteCredential,
  };
  const activate = vi.fn<InstagramPersistenceStore["activate"]>((input) => {
    operations.push("db.activate");
    if (connection.status !== "pending") return Promise.resolve(false);
    routeHash = input.accountHash;
    connection = {
      accountId: input.accountId,
      credentialReference: input.credentialReference,
      credentialVersion: 2,
      credentialIssuedAt: input.now.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      onboardingExpiresAt: null,
      stateHash: null,
      status: "active",
    };
    return Promise.resolve(true);
  });
  const disconnect = vi.fn<InstagramPersistenceStore["disconnect"]>((input) => {
    operations.push("db.disconnect");
    if (
      input.context.organizationId !== IDS.organization ||
      (input.expectedVersion !== undefined &&
        input.expectedVersion !== connection.credentialVersion)
    )
      return Promise.resolve(null);
    const old = connection.credentialReference;
    connection = {
      ...connection,
      credentialReference: null,
      status: input.revoked ? "revoked" : "disabled",
      credentialVersion: connection.credentialVersion + 1,
    };
    return Promise.resolve(old);
  });
  const replaceCredential = vi.fn<InstagramPersistenceStore["replaceCredential"]>((input) => {
    operations.push("db.rotate");
    connection = {
      ...connection,
      credentialReference: input.credentialReference,
      credentialVersion: connection.credentialVersion + 1,
      credentialIssuedAt: input.now.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    };
    return Promise.resolve(true);
  });
  const beginOnboarding = vi.fn<InstagramPersistenceStore["beginOnboarding"]>(() =>
    Promise.resolve(IDS.channel),
  );
  const persistence: InstagramPersistenceStore = {
    activate,
    beginOnboarding,
    disconnect,
    replaceCredential,
    loadConnection: (input) =>
      Promise.resolve(input.organizationId === IDS.organization ? connection : null),
  };
  const exchangeCode = vi.fn<InstagramOAuthClient["exchangeCode"]>(() => {
    operations.push("provider.exchange");
    return Promise.resolve({ accountId: ACCOUNT_ID, token: TOKEN, expiresInSeconds: 5184000 });
  });
  const refreshToken = vi.fn<InstagramOAuthClient["refreshToken"]>(() =>
    Promise.resolve({ token: `${TOKEN}_new`, expiresInSeconds: 5184000 }),
  );
  const subscribeMessages = vi.fn<InstagramOAuthClient["subscribeMessages"]>(() => {
    operations.push("provider.subscribe");
    return Promise.resolve();
  });
  const inputs: PreparedCanonicalInbound[] = [];
  const known = new Set<string>();
  const canonicalStore: CanonicalInboundPersistenceStore = {
    acceptInbound: (input) => {
      inputs.push(input);
      const duplicate = known.has(input.event.event_id);
      known.add(input.event.event_id);
      return Promise.resolve({
        ok: true,
        value: {
          contactId: IDS.contact,
          contactWasCreated: !duplicate,
          conversationId: IDS.conversation,
          conversationWasCreated: !duplicate,
          leadId: IDS.lead,
          leadWasCreated: !duplicate,
          messageId: IDS.message,
          messageSequenceNo: inputs.length,
          processingStatus: "accepted",
          status: duplicate ? "duplicate" : "accepted",
        },
      });
    },
  };
  const cleanupFailure = vi.fn();
  const resolver = vi.fn((type: string, hash: Uint8Array) =>
    Promise.resolve(
      type === "instagram_webhook" &&
        connection.status !== "disabled" &&
        connection.status !== "revoked" &&
        Buffer.from(hash).equals(Buffer.from(routeHash))
        ? context
        : null,
    ),
  );
  const useCases = createInstagramBusinessUseCases({
    appId: instagramConfig.appId,
    oauthRedirectUri: instagramConfig.oauthRedirectUri,
    canonicalStore,
    credentials,
    dataProtector: dataProtection,
    oauth: { exchangeCode, refreshToken, subscribeMessages },
    persistence,
    routeResolver: { resolveInboundRoute: resolver },
    clock: () => now,
    randomState: () => NONCE,
    onCredentialCleanupFailure: cleanupFailure,
  });
  return {
    useCases,
    credentials,
    activate,
    deleteCredential,
    beginOnboarding,
    disconnect,
    replaceCredential,
    exchangeCode,
    refreshToken,
    subscribeMessages,
    inputs,
    operations,
    values,
    cleanupFailure,
    resolver,
    setNow: (value: Date) => {
      now = value;
    },
    setConnection: (value: InstagramConnection) => {
      connection = value;
    },
    connect: () => useCases.completeOnboarding({ code: "synthetic-code", state: NONCE }),
  };
};
const message = {
  accountId: ACCOUNT_ID,
  customerId: CUSTOMER_ID,
  messageId: "mid.synthetic",
  occurredAt: NOW.toISOString(),
  content: { type: "text" as const, text: "Salom" },
};
describe("Instagram application trust and short-transaction choreography", () => {
  it("binds ten-minute SHA-256 state to a server-authorized tenant and returns only the official URL", async () => {
    const test = fixture();
    const result = await test.useCases.beginOnboarding({
      authorization: await authorization(),
      displayName: "Clinic Instagram",
    });
    const url = new URL(result.authorizationUrl);
    expect(Object.keys(result)).toEqual(["authorizationUrl"]);
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.searchParams.get("state")).toBe(NONCE);
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_messages",
    );
    expect(result.authorizationUrl).not.toContain(IDS.organization);
    const input = test.beginOnboarding.mock.calls[0]?.[0];
    expect(input?.stateHash).toEqual(digest(NONCE));
    expect((input?.expiresAt.getTime() ?? 0) - (input?.now.getTime() ?? 0)).toBe(600000);
  });
  it("requires integrations.manage before touching persistence or provider", async () => {
    const test = fixture();
    await expect(
      test.useCases.beginOnboarding({
        authorization: await authorization("staff"),
        displayName: "Clinic",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(test.beginOnboarding).not.toHaveBeenCalled();
  });
  it("orders provider verification/subscription and external secret creation before activation", async () => {
    const test = fixture();
    await test.connect();
    expect(test.operations).toEqual([
      "provider.exchange",
      "provider.subscribe",
      "secret.put",
      "db.activate",
    ]);
    expect(test.activate.mock.calls[0]?.[0].accountHash).toEqual(
      instagramAccountRouteHash(ACCOUNT_ID),
    );
    expect(test.activate.mock.calls[0]?.[0]).not.toHaveProperty("token");
  });
  it.each(["bad", "x".repeat(42), "x".repeat(44)])(
    "rejects malformed state %s before resolution",
    async (state) => {
      const test = fixture();
      await expect(test.useCases.completeOnboarding({ code: "code", state })).rejects.toMatchObject(
        { code: "validation_failed" },
      );
      expect(test.resolver).not.toHaveBeenCalled();
    },
  );
  it("rejects expired state and replay without re-exchanging code or creating another secret", async () => {
    const expired = fixture();
    expired.setNow(new Date(NOW.getTime() + 600001));
    await expect(expired.connect()).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(expired.exchangeCode).not.toHaveBeenCalled();
    const test = fixture();
    await test.connect();
    await expect(test.connect()).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(test.exchangeCode).toHaveBeenCalledOnce();
    expect(test.values.size).toBe(1);
  });
  it("compensates only the new secret when activation loses CAS", async () => {
    const test = fixture();
    test.activate.mockResolvedValue(false);
    await expect(test.connect()).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(test.values.size).toBe(0);
    expect(test.operations.at(-1)).toBe("secret.delete");
  });
  it("allows one racing callback winner and deletes the losing external credential", async () => {
    const test = fixture();
    const results = await Promise.allSettled([test.connect(), test.connect()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(test.values.size).toBe(1);
  });
  it("does not activate after subscription failure", async () => {
    const test = fixture();
    test.subscribeMessages.mockRejectedValue(
      new InstagramProviderError("permanent_rejection", false),
    );
    await expect(test.connect()).rejects.toMatchObject({ category: "permanent_rejection" });
    expect(test.activate).not.toHaveBeenCalled();
    expect(test.values.size).toBe(0);
  });
  it("disconnects atomically before best-effort secret deletion", async () => {
    const test = fixture();
    await test.connect();
    test.operations.length = 0;
    await test.useCases.disconnect({
      authorization: await authorization(),
      channelConnectionId: IDS.channel,
    });
    expect(test.operations).toEqual(["db.disconnect", "secret.delete"]);
    expect(test.values.size).toBe(0);
    expect(await test.useCases.processMessage(message)).toEqual({ status: "ignored" });
  });
  it("rotates only after 24 hours, commits the new reference before deleting the old", async () => {
    const test = fixture();
    await test.connect();
    const actor = await authorization();
    await expect(
      test.useCases.refreshCredential({ authorization: actor, channelConnectionId: IDS.channel }),
    ).rejects.toMatchObject({ code: "business_rule_failed" });
    test.setNow(new Date(NOW.getTime() + 86400001));
    test.operations.length = 0;
    await test.useCases.refreshCredential({
      authorization: actor,
      channelConnectionId: IDS.channel,
    });
    expect(test.operations).toEqual(["secret.put", "db.rotate", "secret.delete"]);
    expect(test.values.size).toBe(1);
  });
  it("revokes expired authentication instead of retrying token refresh forever", async () => {
    const test = fixture();
    await test.connect();
    test.setNow(new Date(NOW.getTime() + 86400001));
    test.refreshToken.mockRejectedValue(new InstagramProviderError("authentication_failed", false));
    await expect(
      test.useCases.refreshCredential({
        authorization: await authorization(),
        channelConnectionId: IDS.channel,
      }),
    ).rejects.toMatchObject({ category: "authentication_failed" });
    expect(test.disconnect.mock.calls[0]?.[0].revoked).toBe(true);
    expect(test.values.size).toBe(0);
  });
  it("is observably safe when post-commit credential cleanup fails", async () => {
    const test = fixture();
    await test.connect();
    test.deleteCredential.mockRejectedValue(new Error(`private ${TOKEN}`));
    await test.useCases.disconnect({
      authorization: await authorization(),
      channelConnectionId: IDS.channel,
    });
    expect(test.cleanupFailure).toHaveBeenCalledOnce();
  });
  it("uses canonical Instagram protected identity and account/customer conversation grouping without a phone", async () => {
    const test = fixture();
    await test.connect();
    expect(await test.useCases.processMessage(message)).toEqual({ status: "accepted" });
    const input = test.inputs[0];
    expect(input?.identity.identityType).toBe("instagram_user");
    expect(input?.identity.validationStatus).toBe("verified");
    expect(input?.organizationId).toBe(IDS.organization);
    expect(input?.event.external_conversation_id).toBe(
      instagramConversationIdentity(ACCOUNT_ID, CUSTOMER_ID),
    );
    expect(Buffer.from(input?.identity.valueCiphertext ?? []).toString()).not.toContain(
      CUSTOMER_ID,
    );
    expect(input?.consentEvidence).toBeNull();
  });
  it("deduplicates a stable mid and passes reordered occurred_at unchanged to existing canonical persistence", async () => {
    const test = fixture();
    await test.connect();
    await test.useCases.processMessage(message);
    expect(await test.useCases.processMessage(message)).toEqual({ status: "duplicate" });
    const older = new Date(NOW.getTime() - 60000).toISOString();
    await test.useCases.processMessage({ ...message, messageId: "mid.older", occurredAt: older });
    expect(test.inputs[2]?.event.occurred_at).toBe(older);
    expect(test.inputs[0]?.threadHash).toEqual(test.inputs[2]?.threadHash);
  });
  it("ignores unknown accounts and rejects invalid customer IDs before SQL", async () => {
    const test = fixture();
    await test.connect();
    expect(await test.useCases.processMessage({ ...message, accountId: "111" })).toEqual({
      status: "ignored",
    });
    test.resolver.mockClear();
    await expect(
      test.useCases.processMessage({ ...message, customerId: "username" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(test.resolver).not.toHaveBeenCalled();
    expect(test.inputs).toHaveLength(0);
  });
  it("keeps account and customer grouping distinct across accounts", () => {
    expect(instagramConversationIdentity(ACCOUNT_ID, CUSTOMER_ID)).not.toBe(
      instagramConversationIdentity("111", CUSTOMER_ID),
    );
    expect(instagramConversationIdentity(ACCOUNT_ID, CUSTOMER_ID)).not.toBe(
      instagramConversationIdentity(ACCOUNT_ID, "111"),
    );
  });
});
