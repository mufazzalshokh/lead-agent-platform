import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ConfigurationValidationError,
  createCustomerDataProtectionConfig,
} from "../../packages/config/src/index.js";
import {
  CustomerDataProtectionError,
  createCustomerDataProtection,
} from "../../packages/security/src/index.js";
import {
  ChannelConnectionIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type OrganizationId,
} from "../../packages/contracts/src/index.js";

const ORGANIZATION_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47501";
const OTHER_ORGANIZATION_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47502";
const CHANNEL_VALUE = "0199f1a8-7f65-7c28-a434-a10796c47503";
if (
  !isSchemaValue(OrganizationIdSchema, ORGANIZATION_VALUE) ||
  !isSchemaValue(OrganizationIdSchema, OTHER_ORGANIZATION_VALUE) ||
  !isSchemaValue(ChannelConnectionIdSchema, CHANNEL_VALUE)
) {
  throw new TypeError("Invalid customer data protection fixture");
}
const ORGANIZATION_ID: OrganizationId = ORGANIZATION_VALUE;
const OTHER_ORGANIZATION_ID: OrganizationId = OTHER_ORGANIZATION_VALUE;
const CHANNEL_ID: ChannelConnectionId = CHANNEL_VALUE;
const ENCRYPTION_KEY = randomBytes(32);
const LOOKUP_KEY = randomBytes(32);

const protector = () =>
  createCustomerDataProtection({
    currentEncryptionKey: ENCRYPTION_KEY,
    currentKeyId: "customer-data-v1",
    lookupKey: LOOKUP_KEY,
  });

describe("S9 customer data protection", () => {
  it("validates explicit distinct 32-byte environment keys", () => {
    const encodedEncryption = Buffer.from(ENCRYPTION_KEY).toString("base64url");
    const encodedLookup = Buffer.from(LOOKUP_KEY).toString("base64url");
    expect(
      createCustomerDataProtectionConfig({
        currentEncryptionKey: encodedEncryption,
        currentKeyId: "customer-data-v1",
        lookupKey: encodedLookup,
      }).currentKeyId,
    ).toBe("customer-data-v1");
    expect(() =>
      createCustomerDataProtectionConfig({
        currentEncryptionKey: encodedEncryption,
        currentKeyId: "customer-data-v1",
        lookupKey: encodedEncryption,
      }),
    ).toThrow(ConfigurationValidationError);
  });

  it("round-trips every purpose through randomized authenticated envelopes", () => {
    const protection = protector();
    const displayOne = protection.protectContactDisplayName({
      organizationId: ORGANIZATION_ID,
      value: "Aziza",
    });
    const displayTwo = protection.protectContactDisplayName({
      organizationId: ORGANIZATION_ID,
      value: "Aziza",
    });
    expect(displayOne).not.toEqual(displayTwo);
    expect(Buffer.from(displayOne).includes(Buffer.from("Aziza"))).toBe(false);
    expect(
      protection.revealContactDisplayName({
        ciphertext: displayOne,
        organizationId: ORGANIZATION_ID,
      }),
    ).toBe("Aziza");

    const identity = protection.protectContactIdentity({
      channelConnectionId: CHANNEL_ID,
      identityType: "telegram_user",
      organizationId: ORGANIZATION_ID,
      value: "998877",
    });
    expect(
      protection.revealContactIdentity({
        channelConnectionId: CHANNEL_ID,
        ciphertext: identity,
        identityType: "telegram_user",
        organizationId: ORGANIZATION_ID,
      }),
    ).toBe("998877");

    for (const content of [
      { locale_hint: "uz" as const, text: "Salom", type: "text" as const },
      { action_token: "appointment:yes", display_text: "Ha", type: "quick_reply" as const },
      {
        caption: "Rasm",
        media_kind: "image" as const,
        provider_media_ref: "provider-ref",
        type: "attachment" as const,
      },
    ]) {
      const contentType = content.type;
      const protectedBody = protection.protectMessageBody({
        channelConnectionId: CHANNEL_ID,
        content,
        contentType,
        organizationId: ORGANIZATION_ID,
      });
      expect(
        protection.revealMessageBody({
          channelConnectionId: CHANNEL_ID,
          ciphertext: protectedBody.ciphertext,
          contentType,
          organizationId: ORGANIZATION_ID,
        }),
      ).toBe(content.type === "text" ? "Salom" : content.type === "quick_reply" ? "Ha" : "Rasm");
      expect(protectedBody.hash).toHaveLength(32);
    }
  });

  it("derives deterministic, tenant-bound and purpose-separated lookup hashes", () => {
    const protection = protector();
    const identity = protection.deriveContactIdentityLookupHash({
      channelConnectionId: CHANNEL_ID,
      identityType: "telegram_user",
      organizationId: ORGANIZATION_ID,
      value: "participant",
    });
    expect(identity).toEqual(
      protection.deriveContactIdentityLookupHash({
        channelConnectionId: CHANNEL_ID,
        identityType: "telegram_user",
        organizationId: ORGANIZATION_ID,
        value: "participant",
      }),
    );
    expect(identity).not.toEqual(
      protection.deriveContactIdentityLookupHash({
        channelConnectionId: CHANNEL_ID,
        identityType: "telegram_user",
        organizationId: OTHER_ORGANIZATION_ID,
        value: "participant",
      }),
    );
    expect(identity).not.toEqual(
      protection.deriveThreadHash({
        channelConnectionId: CHANNEL_ID,
        organizationId: ORGANIZATION_ID,
        value: "participant",
      }),
    );
  });

  it("fails closed for wrong tenant, purpose, identity context, and encryption key", () => {
    const protection = protector();
    const envelope = protection.protectContactDisplayName({
      organizationId: ORGANIZATION_ID,
      value: "private-name",
    });
    const identity = protection.protectContactIdentity({
      channelConnectionId: CHANNEL_ID,
      identityType: "telegram_user",
      organizationId: ORGANIZATION_ID,
      value: "private-identity",
    });
    const wrongKeyProtection = createCustomerDataProtection({
      currentEncryptionKey: randomBytes(32),
      currentKeyId: "customer-data-v1",
      lookupKey: randomBytes(32),
    });
    for (const action of [
      () =>
        protection.revealContactDisplayName({
          ciphertext: envelope,
          organizationId: OTHER_ORGANIZATION_ID,
        }),
      () =>
        protection.revealContactIdentity({
          channelConnectionId: CHANNEL_ID,
          ciphertext: envelope,
          identityType: "telegram_user",
          organizationId: ORGANIZATION_ID,
        }),
      () =>
        protection.revealContactIdentity({
          channelConnectionId: CHANNEL_ID,
          ciphertext: identity,
          identityType: "phone",
          organizationId: ORGANIZATION_ID,
        }),
      () =>
        protection.revealContactIdentity({
          channelConnectionId: null,
          ciphertext: identity,
          identityType: "telegram_user",
          organizationId: ORGANIZATION_ID,
        }),
      () =>
        wrongKeyProtection.revealContactDisplayName({
          ciphertext: envelope,
          organizationId: ORGANIZATION_ID,
        }),
    ]) {
      expect(action).toThrow(CustomerDataProtectionError);
    }
  });

  it("fails closed for tamper, unknown version/key, malformed envelope, and oversize input without logging sensitive material", () => {
    const protection = protector();
    const envelope = protection.protectContactDisplayName({
      organizationId: ORGANIZATION_ID,
      value: "private-name",
    });
    const tampered = Uint8Array.from(envelope);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    const unknownVersion = Uint8Array.from(envelope);
    unknownVersion[4] = 2;
    const unknownKey = Uint8Array.from(envelope);
    unknownKey[6] = "x".charCodeAt(0);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const action of [
      () =>
        protection.revealContactDisplayName({
          ciphertext: tampered,
          organizationId: ORGANIZATION_ID,
        }),
      () =>
        protection.revealContactDisplayName({
          ciphertext: unknownVersion,
          organizationId: ORGANIZATION_ID,
        }),
      () =>
        protection.revealContactDisplayName({
          ciphertext: unknownKey,
          organizationId: ORGANIZATION_ID,
        }),
      () =>
        protection.revealContactDisplayName({
          ciphertext: Uint8Array.of(1, 2, 3),
          organizationId: ORGANIZATION_ID,
        }),
      () =>
        protection.protectContactDisplayName({
          organizationId: ORGANIZATION_ID,
          value: "x".repeat(9_000),
        }),
    ]) {
      expect(action).toThrow(CustomerDataProtectionError);
      try {
        action();
      } catch (error) {
        expect(String(error)).not.toContain("private-name");
        expect(String(error)).not.toContain("aes");
      }
    }
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("backs the existing S9.A protector port with the same format", () => {
    const protection = protector();
    const participant = protection.protectParticipant({
      channelConnectionId: CHANNEL_ID,
      externalParticipantId: "telegram-user",
      identityType: "telegram_user",
      organizationId: ORGANIZATION_ID,
    });
    expect(
      protection.revealContactIdentity({
        channelConnectionId: CHANNEL_ID,
        ciphertext: participant.valueCiphertext,
        identityType: "telegram_user",
        organizationId: ORGANIZATION_ID,
      }),
    ).toBe("telegram-user");
    const message = protection.protectContent({
      channelConnectionId: CHANNEL_ID,
      content: { locale_hint: "uz", text: "Salom", type: "text" },
      organizationId: ORGANIZATION_ID,
    });
    expect(
      protection.revealMessageBody({
        channelConnectionId: CHANNEL_ID,
        ciphertext: message.bodyCiphertext,
        contentType: "text",
        organizationId: ORGANIZATION_ID,
      }),
    ).toBe("Salom");
    expect(participant.hashKeyVersion).toBe(1);
  });
});
