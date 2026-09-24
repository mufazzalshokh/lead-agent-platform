import { describe, expect, it, vi } from "vitest";
import {
  createTelegramBusinessUseCases,
  telegramBusinessConnectionRouteHash,
  telegramConversationIdentity,
  telegramOwnerRouteHash,
  type CanonicalInboundPersistenceStore,
  type PreparedCanonicalInbound,
  type TelegramPersistenceStore,
} from "../../packages/application/src/index.js";
import { normalizeTelegramUpdate } from "../../packages/integrations/src/telegram/normalizer.js";
import {
  authorization,
  businessMessage,
  dataProtection,
  digest,
  IDS,
  NONCE,
  NOW,
} from "./fixtures.js";

const fixture = (
  eligibilityState:
    "business_eligible" | "excluded_personal" | "uncertain" | "staff_only" = "business_eligible",
) => {
  let routeHash = digest(NONCE);
  let phase: "awaiting_owner" | "awaiting_connection" | "active" | "disabled" = "awaiting_owner";
  let canReply = true;
  const canonicalInputs: PreparedCanonicalInbound[] = [];
  const knownMessages = new Set<string>();
  const ack = vi.fn(() => Promise.resolve());
  const acknowledgementFailure = vi.fn();
  const context = { organizationId: IDS.organization, channelConnectionId: IDS.channel };
  const persistence: TelegramPersistenceStore = {
    beginOnboarding: vi.fn<TelegramPersistenceStore["beginOnboarding"]>((input) => {
      expect(input.nonceHash).toEqual(digest(NONCE));
      expect(input.expiresAt.getTime() - input.now.getTime()).toBe(900000);
      return Promise.resolve({ channelConnectionId: IDS.channel });
    }),
    bindOwner: (input) => {
      const valid =
        phase === "awaiting_owner" && Buffer.from(routeHash).equals(Buffer.from(input.nonceHash));
      if (valid) {
        routeHash = input.newOwnerRouteHash;
        phase = "awaiting_connection";
      }
      return Promise.resolve(valid);
    },
    bindBusinessConnection: (input) => {
      const valid =
        phase === "awaiting_connection" &&
        Buffer.from(routeHash).equals(Buffer.from(input.ownerUserIdHash));
      if (valid) {
        routeHash = input.businessConnectionIdHash;
        phase = "active";
      }
      return Promise.resolve(valid);
    },
    applyBusinessConnectionUpdate: (input) => {
      if (phase !== "active") return Promise.resolve(false);
      if (!input.isEnabled) phase = "disabled";
      canReply = input.canReply;
      return Promise.resolve(true);
    },
    loadConnection: () =>
      Promise.resolve(
        phase === "active"
          ? {
              businessConnectionId: "business-test-1",
              canReply,
              isEnabled: true,
              ownerUserIdHash: telegramOwnerRouteHash("456"),
            }
          : null,
      ),
  };
  const canonicalStore: CanonicalInboundPersistenceStore = {
    acceptInbound: (input) => {
      canonicalInputs.push(input);
      const key = input.event.external_message_id ?? input.event.event_id;
      const duplicate = knownMessages.has(key);
      knownMessages.add(key);
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
          messageSequenceNo: 1,
          processingStatus: "accepted",
          status: duplicate ? "duplicate" : "accepted",
        },
      });
    },
  };
  const useCases = createTelegramBusinessUseCases({
    botUsername: "SyntheticBusinessBot",
    callbackAcknowledger: { answerCallbackQuery: ack },
    canonicalStore,
    clock: () => NOW,
    dataProtector: dataProtection,
    eligibilityStore: {
      resolveInbound: () =>
        Promise.resolve({ controlId: IDS.control, state: eligibilityState, version: 1 }),
    },
    onCallbackAcknowledgementFailure: acknowledgementFailure,
    persistence,
    platformProvisioner: { ensureWebhook: () => Promise.resolve() },
    randomNonce: () => NONCE,
    routeResolver: {
      resolveInboundRoute: (type, hash) =>
        Promise.resolve(
          type === "telegram_webhook" &&
            Buffer.from(routeHash).equals(Buffer.from(hash)) &&
            phase !== "disabled"
            ? context
            : null,
        ),
    },
  });
  const bind = async () => {
    await useCases.processUpdate({
      kind: "onboarding_start",
      nonce: NONCE,
      ownerUserId: "456",
      updateId: "1",
    });
    await useCases.processUpdate({
      kind: "business_connection",
      businessConnectionId: "business-test-1",
      canReply: true,
      isEnabled: true,
      establishedAt: NOW.toISOString(),
      ownerUserId: "456",
      updateId: "2",
    });
  };
  return { ack, acknowledgementFailure, bind, canonicalInputs, persistence, useCases };
};

describe("Telegram Business application trust chain", () => {
  it("keeps long opaque business connection IDs within canonical thread bounds", () => {
    const connectionId = "a".repeat(255);
    const thread = telegramConversationIdentity(connectionId, "123");
    expect(thread.length).toBeLessThanOrEqual(255);
    expect(thread).not.toContain(connectionId);
    expect(thread).toBe(telegramConversationIdentity(connectionId, "123"));
    expect(thread).not.toBe(telegramConversationIdentity(connectionId, "456"));
    expect(thread).not.toBe(telegramConversationIdentity("b".repeat(255), "123"));
  });
  it("authorizes onboarding and returns only the opaque one-time nonce link", async () => {
    const test = fixture();
    const result = await test.useCases.beginOnboarding({
      authorization: await authorization(),
      displayName: "Business DM",
    });
    expect(result.onboardingUrl).toBe(`https://t.me/SyntheticBusinessBot?start=${NONCE}`);
    expect(result.onboardingUrl).not.toContain(IDS.organization);
    await expect(
      test.useCases.beginOnboarding({
        authorization: await authorization("staff"),
        displayName: "Business DM",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
  it("rotates nonce → owner → connection without creating lead state; replay is ignored", async () => {
    const test = fixture();
    await test.bind();
    expect(test.canonicalInputs).toHaveLength(0);
    expect(
      await test.useCases.processUpdate({
        kind: "onboarding_start",
        nonce: NONCE,
        ownerUserId: "789",
        updateId: "3",
      }),
    ).toEqual({ status: "ignored" });
    expect(telegramOwnerRouteHash("456")).not.toEqual(telegramBusinessConnectionRouteHash("456"));
  });
  it("does not bind the wrong business owner or accept unknown/cross-tenant connection identities", async () => {
    const test = fixture();
    expect(
      await test.useCases.processUpdate({
        kind: "business_connection",
        businessConnectionId: "business-test-1",
        canReply: true,
        isEnabled: true,
        establishedAt: NOW.toISOString(),
        ownerUserId: "789",
        updateId: "3",
      }),
    ).toEqual({ status: "ignored" });
    await test.bind();
    expect(
      await test.useCases.processUpdate(
        normalizeTelegramUpdate(
          businessMessage({ business_connection_id: IDS.otherOrganization }),
          NOW,
        ),
      ),
    ).toEqual({ status: "ignored" });
    expect(test.canonicalInputs).toHaveLength(0);
  });
  it("uses trusted IDs, protected customer identity and S9 durable duplicate outcomes without phone", async () => {
    const test = fixture();
    await test.bind();
    const update = normalizeTelegramUpdate(businessMessage(), NOW);
    expect(await test.useCases.processUpdate(update)).toEqual({ status: "accepted" });
    expect(await test.useCases.processUpdate(update)).toEqual({ status: "duplicate" });
    const input = test.canonicalInputs[0];
    expect(input?.organizationId).toBe(IDS.organization);
    expect(input?.event).not.toHaveProperty("organization_id");
    expect(input?.event).toMatchObject({
      channel: "telegram",
      channel_connection_id: IDS.channel,
      external_sender_id: "123",
      event_id: "telegram:update:100",
    });
    expect(input?.identity.identityType).toBe("telegram_user");
  });
  it("suppresses business-account self messages and bot echoes", async () => {
    const test = fixture();
    await test.bind();
    for (const raw of [
      businessMessage({ from: { id: 456, is_bot: false }, chat: { id: 456, type: "private" } }),
      businessMessage({ sender_business_bot: { id: 999 } }),
    ])
      expect(await test.useCases.processUpdate(normalizeTelegramUpdate(raw, NOW))).toEqual({
        status: "ignored",
      });
    expect(test.canonicalInputs).toHaveLength(0);
  });
  it.each(["uncertain", "excluded_personal", "staff_only"] as const)(
    "safely acknowledges %s threads without canonical business persistence",
    async (eligibilityState) => {
      const test = fixture(eligibilityState);
      await test.bind();
      expect(
        await test.useCases.processUpdate(normalizeTelegramUpdate(businessMessage(), NOW)),
      ).toEqual({ status: "ignored" });
      expect(test.canonicalInputs).toHaveLength(0);
    },
  );
  it("keeps read acceptance with reply rights removed, then disconnects without reactivation", async () => {
    const test = fixture();
    await test.bind();
    const rights = {
      kind: "business_connection" as const,
      businessConnectionId: "business-test-1",
      canReply: false,
      isEnabled: true,
      establishedAt: NOW.toISOString(),
      ownerUserId: "456",
      updateId: "5",
    };
    await test.useCases.processUpdate(rights);
    expect(
      await test.useCases.processUpdate(normalizeTelegramUpdate(businessMessage(), NOW)),
    ).toEqual({ status: "accepted" });
    await test.useCases.processUpdate({ ...rights, isEnabled: false });
    await test.useCases.processUpdate({ ...rights, canReply: true });
    expect(
      await test.useCases.processUpdate(normalizeTelegramUpdate(businessMessage(), NOW)),
    ).toEqual({ status: "ignored" });
  });
  it("acknowledges callbacks only after durable acceptance, without executing the token", async () => {
    const test = fixture();
    await test.bind();
    test.ack.mockImplementation(() => {
      expect(test.canonicalInputs).toHaveLength(1);
      return Promise.resolve();
    });
    const callback = normalizeTelegramUpdate(
      {
        update_id: 7,
        callback_query: {
          id: "opaque-callback",
          from: { id: 123, is_bot: false },
          message: businessMessage().business_message,
          data: "opaque-untrusted-action",
        },
      },
      NOW,
    );
    await test.useCases.processUpdate(callback);
    expect(test.ack).toHaveBeenCalledWith("opaque-callback");
    expect(test.canonicalInputs[0]?.event.content).toMatchObject({
      type: "quick_reply",
      action_token: "opaque-untrusted-action",
    });
  });
  it("bounds long callback identities without changing acknowledgement or duplicate detection", async () => {
    const test = fixture();
    await test.bind();
    const callbackId = "a".repeat(255);
    const callback = normalizeTelegramUpdate(
      {
        update_id: 8,
        callback_query: {
          id: callbackId,
          from: { id: 123, is_bot: false },
          message: businessMessage().business_message,
          data: "opaque-action",
        },
      },
      NOW,
    );
    expect(await test.useCases.processUpdate(callback)).toEqual({ status: "accepted" });
    expect(await test.useCases.processUpdate(callback)).toEqual({ status: "duplicate" });
    const messageId = test.canonicalInputs[0]?.event.external_message_id;
    expect(messageId?.length).toBeLessThanOrEqual(255);
    expect(messageId).not.toContain(callbackId);
    expect(test.ack).toHaveBeenCalledWith(callbackId);
  });
  it("observes acknowledgement failure without undoing durable callback acceptance", async () => {
    const test = fixture();
    await test.bind();
    test.ack.mockRejectedValue(new Error("synthetic provider failure"));
    const callback = normalizeTelegramUpdate(
      {
        update_id: 9,
        callback_query: {
          id: "opaque-callback-failure",
          from: { id: 123, is_bot: false },
          message: businessMessage().business_message,
          data: "opaque-action",
        },
      },
      NOW,
    );
    expect(await test.useCases.processUpdate(callback)).toEqual({ status: "accepted" });
    expect(test.canonicalInputs).toHaveLength(1);
    expect(test.acknowledgementFailure).toHaveBeenCalledOnce();
    expect(test.acknowledgementFailure).toHaveBeenCalledWith();
  });
});
