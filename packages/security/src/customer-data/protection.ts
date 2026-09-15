import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import type {
  CanonicalInboundEvent,
  ChannelConnectionId,
  OrganizationId,
} from "@lead-agent/contracts";

const MAGIC = Buffer.from("LADP", "ascii");
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FIXED_ENVELOPE_BYTES = MAGIC.byteLength + 1 + 1 + NONCE_BYTES + TAG_BYTES;
const IDENTITY_ENVELOPE_MAX_BYTES = 8_192;
const MESSAGE_ENVELOPE_MAX_BYTES = 65_536;

export type CustomerIdentityType = "email" | "phone" | "telegram_user" | "widget_participant";
export type CustomerMessageContentType = "attachment" | "quick_reply" | "text";

export class CustomerDataProtectionError extends Error {
  public readonly code = "customer_data_unavailable" as const;

  public constructor() {
    super("Protected customer data is unavailable");
    this.name = "CustomerDataProtectionError";
  }
}

export type CustomerDataKeyProvider = Readonly<{
  current(): Readonly<{ id: string; key: Uint8Array }>;
  resolve(keyId: string): Uint8Array | null;
}>;

export type CustomerDataProtectionOptions = Readonly<{
  currentEncryptionKey: Uint8Array;
  currentKeyId: string;
  lookupKey: Uint8Array;
}>;

type IdentityContext = Readonly<{
  channelConnectionId: ChannelConnectionId | null;
  identityType: CustomerIdentityType;
  organizationId: OrganizationId;
}>;

type MessageContext = Readonly<{
  channelConnectionId: ChannelConnectionId;
  contentType: CustomerMessageContentType;
  organizationId: OrganizationId;
}>;

type ProtectedValue = Readonly<{ ciphertext: Uint8Array; hash: Uint8Array }>;

export type CustomerDataProtection = Readonly<{
  protectContactDisplayName(
    input: Readonly<{ organizationId: OrganizationId; value: string }>,
  ): Uint8Array;
  revealContactDisplayName(
    input: Readonly<{ ciphertext: Uint8Array; organizationId: OrganizationId }>,
  ): string;
  protectContactIdentity(input: IdentityContext & Readonly<{ value: string }>): Uint8Array;
  revealContactIdentity(input: IdentityContext & Readonly<{ ciphertext: Uint8Array }>): string;
  protectMessageBody(
    input: MessageContext & Readonly<{ content: CanonicalInboundEvent["content"] }>,
  ): ProtectedValue;
  revealMessageBody(input: MessageContext & Readonly<{ ciphertext: Uint8Array }>): string | null;
  deriveContactIdentityLookupHash(input: IdentityContext & Readonly<{ value: string }>): Uint8Array;
  deriveThreadHash(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      organizationId: OrganizationId;
      value: string;
    }>,
  ): Uint8Array;
  deriveContactIdentityLookup(input: IdentityContext & Readonly<{ value: string }>): Uint8Array;
  deriveThreadLookup(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      organizationId: OrganizationId;
      value: string;
    }>,
  ): Uint8Array;
  protectContent(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      content: CanonicalInboundEvent["content"];
      organizationId: OrganizationId;
    }>,
  ): Readonly<{ bodyCiphertext: Uint8Array; bodyHash: Uint8Array }>;
  protectParticipant(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      externalParticipantId: string;
      identityType: "telegram_user" | "widget_participant";
      organizationId: OrganizationId;
    }>,
  ): Readonly<{ hashKeyVersion: 1; lookupHash: Uint8Array; valueCiphertext: Uint8Array }>;
  threadHash(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      externalConversationId: string;
      organizationId: OrganizationId;
    }>,
  ): Uint8Array;
}>;

const fail = (): never => {
  throw new CustomerDataProtectionError();
};

const encodeParts = (...parts: readonly (string | null)[]): Buffer => {
  const encoded: Buffer[] = [];
  for (const part of parts) {
    if (part === null) {
      encoded.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
      continue;
    }
    const value = Buffer.from(part, "utf8");
    if (value.byteLength > 65_536) fail();
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(value.byteLength);
    encoded.push(length, value);
  }
  return Buffer.concat(encoded);
};

const aad = (purpose: string, ...parts: readonly (string | null)[]): Buffer =>
  encodeParts("lead-agent-customer-data", String(VERSION), purpose, ...parts);

const validateKey = (key: Uint8Array): Buffer => {
  if (key.byteLength !== 32) fail();
  return Buffer.from(key);
};

const createSingleKeyProvider = (id: string, key: Uint8Array): CustomerDataKeyProvider => {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(id) || id.length > 64) fail();
  const owned = validateKey(key);
  return Object.freeze({
    current: () => Object.freeze({ id, key: new Uint8Array(owned) }),
    resolve: (keyId: string) => (keyId === id ? new Uint8Array(owned) : null),
  });
};

const seal = (
  provider: CustomerDataKeyProvider,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
  maximumEnvelopeBytes: number,
): Uint8Array => {
  const active = provider.current();
  const keyId = Buffer.from(active.id, "utf8");
  if (keyId.byteLength < 1 || keyId.byteLength > 64) fail();
  if (
    plaintext.byteLength < 1 ||
    plaintext.byteLength + FIXED_ENVELOPE_BYTES + keyId.byteLength > maximumEnvelopeBytes
  )
    fail();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", validateKey(active.key), nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    MAGIC,
    Buffer.from([VERSION, keyId.byteLength]),
    keyId,
    nonce,
    tag,
    encrypted,
  ]);
};

const open = (
  provider: CustomerDataKeyProvider,
  envelope: Uint8Array,
  associatedData: Uint8Array,
  maximumEnvelopeBytes: number,
): Buffer => {
  try {
    const packed = Buffer.from(envelope);
    if (packed.byteLength <= FIXED_ENVELOPE_BYTES || packed.byteLength > maximumEnvelopeBytes)
      fail();
    if (!packed.subarray(0, MAGIC.byteLength).equals(MAGIC) || packed[MAGIC.byteLength] !== VERSION)
      fail();
    const keyIdLength = packed.readUInt8(MAGIC.byteLength + 1);
    if (keyIdLength < 1 || keyIdLength > 64) fail();
    const headerBytes = MAGIC.byteLength + 2 + keyIdLength + NONCE_BYTES + TAG_BYTES;
    if (packed.byteLength <= headerBytes) fail();
    const keyIdStart = MAGIC.byteLength + 2;
    const keyId = packed.subarray(keyIdStart, keyIdStart + keyIdLength).toString("utf8");
    if (Buffer.from(keyId, "utf8").byteLength !== keyIdLength) fail();
    const key = provider.resolve(keyId) ?? fail();
    const nonceStart = keyIdStart + keyIdLength;
    const tagStart = nonceStart + NONCE_BYTES;
    const bodyStart = tagStart + TAG_BYTES;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      validateKey(key),
      packed.subarray(nonceStart, tagStart),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(packed.subarray(tagStart, bodyStart));
    return Buffer.concat([decipher.update(packed.subarray(bodyStart)), decipher.final()]);
  } catch {
    return fail();
  }
};

const messageContentType = (
  content: CanonicalInboundEvent["content"],
): CustomerMessageContentType => {
  if (content.type === "text" || content.type === "quick_reply" || content.type === "attachment")
    return content.type;
  return fail();
};

const encodeMessage = (content: CanonicalInboundEvent["content"]): Buffer => {
  switch (content.type) {
    case "text":
      return encodeParts("text", content.locale_hint ?? null, content.text);
    case "quick_reply":
      return encodeParts("quick_reply", content.action_token, content.display_text ?? null);
    case "attachment":
      return encodeParts(
        "attachment",
        content.media_kind,
        content.provider_media_ref,
        content.caption ?? null,
      );
    case "delivery_status":
    case "unsupported":
      return fail();
  }
};

const decodeParts = (value: Buffer): readonly (string | null)[] => {
  const values: (string | null)[] = [];
  let offset = 0;
  while (offset < value.byteLength) {
    if (offset + 4 > value.byteLength) fail();
    const length = value.readUInt32BE(offset);
    offset += 4;
    if (length === 0xffff_ffff) {
      values.push(null);
      continue;
    }
    if (offset + length > value.byteLength) fail();
    const bytes = value.subarray(offset, offset + length);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) fail();
    values.push(text);
    offset += length;
  }
  return values;
};

const decodeMessage = (plaintext: Buffer, expected: CustomerMessageContentType): string | null => {
  const values = decodeParts(plaintext);
  if (values[0] !== expected) fail();
  switch (expected) {
    case "text":
      if (values.length !== 3 || typeof values[2] !== "string") return fail();
      return values[2];
    case "quick_reply":
      if (values.length !== 3 || typeof values[1] !== "string") return fail();
      return values[2] ?? values[1];
    case "attachment":
      if (values.length !== 4 || typeof values[1] !== "string" || typeof values[2] !== "string")
        return fail();
      return values[3] ?? null;
  }
};

export const createCustomerDataProtection = (
  options: CustomerDataProtectionOptions,
): CustomerDataProtection => {
  const provider = createSingleKeyProvider(options.currentKeyId, options.currentEncryptionKey);
  const lookupKey = validateKey(options.lookupKey);
  if (lookupKey.equals(validateKey(options.currentEncryptionKey))) fail();
  const hmac = (
    purpose: "identity-lookup" | "thread-lookup",
    ...parts: readonly (string | null)[]
  ): Uint8Array =>
    createHmac("sha256", lookupKey)
      .update(encodeParts("lead-agent-customer-lookup", purpose, ...parts))
      .digest();
  const bodyHash = (plaintext: Uint8Array): Uint8Array =>
    createHash("sha256").update(plaintext).digest();

  const protectMessageBody: CustomerDataProtection["protectMessageBody"] = (input) => {
    const contentType = messageContentType(input.content);
    if (contentType !== input.contentType) fail();
    const plaintext = encodeMessage(input.content);
    return Object.freeze({
      ciphertext: seal(
        provider,
        plaintext,
        aad("message-body", input.organizationId, input.channelConnectionId, contentType),
        MESSAGE_ENVELOPE_MAX_BYTES,
      ),
      hash: bodyHash(plaintext),
    });
  };

  const protection: CustomerDataProtection = {
    deriveContactIdentityLookup: (input) =>
      hmac(
        "identity-lookup",
        input.organizationId,
        input.identityType,
        input.channelConnectionId,
        input.value,
      ),
    deriveContactIdentityLookupHash: (input) =>
      hmac(
        "identity-lookup",
        input.organizationId,
        input.identityType,
        input.channelConnectionId,
        input.value,
      ),
    deriveThreadHash: (input) =>
      hmac("thread-lookup", input.organizationId, input.channelConnectionId, input.value),
    deriveThreadLookup: (input) =>
      hmac("thread-lookup", input.organizationId, input.channelConnectionId, input.value),
    protectContactDisplayName: (input) =>
      seal(
        provider,
        Buffer.from(input.value, "utf8"),
        aad("contact-display-name", input.organizationId),
        IDENTITY_ENVELOPE_MAX_BYTES,
      ),
    protectContactIdentity: (input) =>
      seal(
        provider,
        Buffer.from(input.value, "utf8"),
        aad(
          "contact-identity",
          input.organizationId,
          input.identityType,
          input.channelConnectionId,
        ),
        IDENTITY_ENVELOPE_MAX_BYTES,
      ),
    protectContent: (input) => {
      const contentType = messageContentType(input.content);
      const result = protectMessageBody({ ...input, contentType });
      return Object.freeze({ bodyCiphertext: result.ciphertext, bodyHash: result.hash });
    },
    protectMessageBody,
    protectParticipant: (input) =>
      Object.freeze({
        hashKeyVersion: 1 as const,
        lookupHash: hmac(
          "identity-lookup",
          input.organizationId,
          input.identityType,
          input.channelConnectionId,
          input.externalParticipantId,
        ),
        valueCiphertext: seal(
          provider,
          Buffer.from(input.externalParticipantId, "utf8"),
          aad(
            "contact-identity",
            input.organizationId,
            input.identityType,
            input.channelConnectionId,
          ),
          IDENTITY_ENVELOPE_MAX_BYTES,
        ),
      }),
    revealContactDisplayName: (input) =>
      open(
        provider,
        input.ciphertext,
        aad("contact-display-name", input.organizationId),
        IDENTITY_ENVELOPE_MAX_BYTES,
      ).toString("utf8"),
    revealContactIdentity: (input) =>
      open(
        provider,
        input.ciphertext,
        aad(
          "contact-identity",
          input.organizationId,
          input.identityType,
          input.channelConnectionId,
        ),
        IDENTITY_ENVELOPE_MAX_BYTES,
      ).toString("utf8"),
    revealMessageBody: (input) =>
      decodeMessage(
        open(
          provider,
          input.ciphertext,
          aad("message-body", input.organizationId, input.channelConnectionId, input.contentType),
          MESSAGE_ENVELOPE_MAX_BYTES,
        ),
        input.contentType,
      ),
    threadHash: (input) =>
      hmac(
        "thread-lookup",
        input.organizationId,
        input.channelConnectionId,
        input.externalConversationId,
      ),
  };
  return Object.freeze(protection);
};
