import {
  CanonicalInboundEventSchema,
  ChannelConnectionIdSchema,
  LocaleSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  isSchemaValue,
  type CanonicalInboundEvent,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type LeadId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
} from "@lead-agent/contracts";

const HASH_MINIMUM_BYTES = 16;
const HASH_MAXIMUM_BYTES = 128;
const IDENTITY_CIPHERTEXT_MAXIMUM_BYTES = 8_192;
const MESSAGE_CIPHERTEXT_MAXIMUM_BYTES = 65_536;
const BOUNDED_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const NOTICE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export type InboundParticipantIdentityType = "telegram_user" | "widget_participant";
export type InboundMessageProcessingStatus =
  "accepted" | "failed" | "processed" | "processing" | "suppressed";
type InitialInboundMessageProcessingStatus = Extract<
  InboundMessageProcessingStatus,
  "accepted" | "suppressed"
>;

export type TrustedInboundContext = Readonly<{
  /** Derived only after trusted channel routing/authentication; never copied from a public body. */
  channelConnectionId: ChannelConnectionId;
  organizationId: OrganizationId;
}>;

export type ProtectedInboundParticipant = Readonly<{
  hashKeyVersion: number;
  lookupHash: Uint8Array;
  valueCiphertext: Uint8Array;
}>;

export type ProtectedInboundContent = Readonly<{
  bodyCiphertext: Uint8Array;
  bodyHash: Uint8Array;
}>;

export interface CanonicalInboundDataProtector {
  protectContent(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      content: CanonicalInboundEvent["content"];
      organizationId: OrganizationId;
    }>,
  ): Promise<ProtectedInboundContent> | ProtectedInboundContent;
  protectParticipant(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      externalParticipantId: CanonicalInboundEvent["external_sender_id"];
      identityType: InboundParticipantIdentityType;
      organizationId: OrganizationId;
    }>,
  ): Promise<ProtectedInboundParticipant> | ProtectedInboundParticipant;
  threadHash(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      externalConversationId: CanonicalInboundEvent["external_conversation_id"];
      organizationId: OrganizationId;
    }>,
  ): Promise<Uint8Array> | Uint8Array;
}

export type InboundConsentEvidence = Readonly<{
  evidenceCiphertext: Uint8Array | null;
  evidenceHash: Uint8Array;
  lawfulBasisCode: string | null;
  locale: "en" | "ru" | "uz";
  noticeKey: string;
  noticeVersion: number;
  policyUrl: string | null;
  purpose: "analytics_optional" | "booking_follow_up" | "marketing" | "service_messages";
  status: "declined" | "granted" | "not_required" | "withdrawn";
  supersedesConsentId: ResourceId | null;
}>;

export type PreparedCanonicalInbound = Readonly<{
  consentEvidence: InboundConsentEvidence | null;
  event: CanonicalInboundEvent;
  identity: ProtectedInboundParticipant &
    Readonly<{
      identityType: InboundParticipantIdentityType;
      validationStatus: "valid" | "verified";
    }>;
  message: ProtectedInboundContent &
    Readonly<{
      localeHint: "en" | "ru" | "uz" | null;
      processingStatus: InitialInboundMessageProcessingStatus;
    }>;
  organizationId: OrganizationId;
  threadHash: Uint8Array;
}>;

export type CanonicalInboundReceipt = Readonly<{
  contactId: ContactId;
  contactWasCreated: boolean;
  conversationId: ConversationId;
  conversationWasCreated: boolean;
  leadId: LeadId;
  leadWasCreated: boolean;
  messageId: MessageId;
  messageSequenceNo: number;
  processingStatus: InboundMessageProcessingStatus;
  status: "accepted" | "duplicate";
}>;

export type CanonicalInboundFailureCode =
  | "channel_unavailable"
  | "contact_unavailable"
  | "identity_conflict"
  | "persistence_conflict"
  | "unsupported_channel"
  | "unsupported_event_kind"
  | "validation_failed";

export type CanonicalInboundResult =
  | Readonly<{ ok: true; value: CanonicalInboundReceipt }>
  | Readonly<{ error: Readonly<{ code: CanonicalInboundFailureCode }>; ok: false }>;

export interface CanonicalInboundPersistenceStore {
  acceptInbound(input: PreparedCanonicalInbound): Promise<CanonicalInboundResult>;
}

export interface CanonicalInboundUseCases {
  acceptInbound(
    command: Readonly<{
      consentEvidence?: InboundConsentEvidence | null;
      context: TrustedInboundContext;
      event: CanonicalInboundEvent;
    }>,
  ): Promise<CanonicalInboundResult>;
}

const failure = (code: CanonicalInboundFailureCode): CanonicalInboundResult =>
  Object.freeze({ error: Object.freeze({ code }), ok: false });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedBytes = (value: unknown, minimum: number, maximum: number): value is Uint8Array =>
  value instanceof Uint8Array && value.byteLength >= minimum && value.byteLength <= maximum;

const isNullableBoundedCode = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" && value.length <= 100 && BOUNDED_CODE_PATTERN.test(value));

const isConsentEvidence = (value: unknown): value is InboundConsentEvidence => {
  if (!isRecord(value)) return false;
  const status = value["status"];
  const supersedesConsentId = value["supersedesConsentId"];
  return (
    [
      "evidenceCiphertext",
      "evidenceHash",
      "lawfulBasisCode",
      "locale",
      "noticeKey",
      "noticeVersion",
      "policyUrl",
      "purpose",
      "status",
      "supersedesConsentId",
    ].every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).length === 10 &&
    isBoundedBytes(value["evidenceHash"], HASH_MINIMUM_BYTES, HASH_MAXIMUM_BYTES) &&
    (value["evidenceCiphertext"] === null ||
      isBoundedBytes(value["evidenceCiphertext"], 1, MESSAGE_CIPHERTEXT_MAXIMUM_BYTES)) &&
    isNullableBoundedCode(value["lawfulBasisCode"]) &&
    isSchemaValue(LocaleSchema, value["locale"]) &&
    typeof value["noticeKey"] === "string" &&
    value["noticeKey"].length <= 128 &&
    NOTICE_KEY_PATTERN.test(value["noticeKey"]) &&
    Number.isSafeInteger(value["noticeVersion"]) &&
    Number(value["noticeVersion"]) > 0 &&
    (value["policyUrl"] === null ||
      (typeof value["policyUrl"] === "string" &&
        value["policyUrl"].trim() === value["policyUrl"] &&
        value["policyUrl"].length >= 1 &&
        value["policyUrl"].length <= 2_048)) &&
    ["analytics_optional", "booking_follow_up", "marketing", "service_messages"].includes(
      String(value["purpose"]),
    ) &&
    ["declined", "granted", "not_required", "withdrawn"].includes(String(status)) &&
    (supersedesConsentId === null || isSchemaValue(ResourceIdSchema, supersedesConsentId)) &&
    (status !== "withdrawn" || supersedesConsentId !== null)
  );
};

const identityTypeFor = (event: CanonicalInboundEvent): InboundParticipantIdentityType | null => {
  switch (event.channel) {
    case "telegram":
      return "telegram_user";
    case "widget":
      return "widget_participant";
    case "instagram":
    case "whatsapp":
      return null;
  }
};

const localeHintFor = (event: CanonicalInboundEvent): "en" | "ru" | "uz" | null =>
  event.kind === "text" ? (event.content.locale_hint ?? null) : null;

const processingStatusFor = (
  event: CanonicalInboundEvent,
): InitialInboundMessageProcessingStatus =>
  event.kind === "text" || event.kind === "quick_reply" ? "accepted" : "suppressed";

const validContext = (value: unknown): value is TrustedInboundContext =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  isSchemaValue(ChannelConnectionIdSchema, value["channelConnectionId"]) &&
  isSchemaValue(OrganizationIdSchema, value["organizationId"]);

const validProtectedParticipant = (value: unknown): value is ProtectedInboundParticipant =>
  isRecord(value) &&
  Object.keys(value).length === 3 &&
  Number.isSafeInteger(value["hashKeyVersion"]) &&
  Number(value["hashKeyVersion"]) > 0 &&
  isBoundedBytes(value["lookupHash"], HASH_MINIMUM_BYTES, HASH_MAXIMUM_BYTES) &&
  isBoundedBytes(value["valueCiphertext"], 1, IDENTITY_CIPHERTEXT_MAXIMUM_BYTES);

const validProtectedContent = (value: unknown): value is ProtectedInboundContent =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  isBoundedBytes(value["bodyHash"], HASH_MINIMUM_BYTES, HASH_MAXIMUM_BYTES) &&
  isBoundedBytes(value["bodyCiphertext"], 1, MESSAGE_CIPHERTEXT_MAXIMUM_BYTES);

export const createCanonicalInboundUseCases = (
  store: CanonicalInboundPersistenceStore,
  protector: CanonicalInboundDataProtector,
): CanonicalInboundUseCases =>
  Object.freeze({
    acceptInbound: async (command: Parameters<CanonicalInboundUseCases["acceptInbound"]>[0]) => {
      if (
        !isRecord(command) ||
        !validContext(command["context"]) ||
        !isSchemaValue(CanonicalInboundEventSchema, command["event"])
      ) {
        return failure("validation_failed");
      }
      const event = command["event"];
      const context = command["context"];
      if (event.channel_connection_id !== context.channelConnectionId) {
        return failure("channel_unavailable");
      }
      if (event.kind === "delivery_status") {
        return failure("unsupported_event_kind");
      }
      const identityType = identityTypeFor(event);
      if (identityType === null) return failure("unsupported_channel");

      const consentEvidence = command["consentEvidence"] ?? null;
      if (consentEvidence !== null && !isConsentEvidence(consentEvidence)) {
        return failure("validation_failed");
      }

      const [identity, message, threadHash] = await Promise.all([
        protector.protectParticipant({
          channelConnectionId: context.channelConnectionId,
          externalParticipantId: event.external_sender_id,
          identityType,
          organizationId: context.organizationId,
        }),
        protector.protectContent({
          channelConnectionId: context.channelConnectionId,
          content: event.content,
          organizationId: context.organizationId,
        }),
        protector.threadHash({
          channelConnectionId: context.channelConnectionId,
          externalConversationId: event.external_conversation_id,
          organizationId: context.organizationId,
        }),
      ]);
      if (
        !validProtectedParticipant(identity) ||
        !validProtectedContent(message) ||
        !isBoundedBytes(threadHash, HASH_MINIMUM_BYTES, HASH_MAXIMUM_BYTES)
      ) {
        return failure("validation_failed");
      }

      return await store.acceptInbound(
        Object.freeze({
          consentEvidence,
          event,
          identity: Object.freeze({
            hashKeyVersion: identity.hashKeyVersion,
            identityType,
            lookupHash: new Uint8Array(identity.lookupHash),
            validationStatus: event.channel === "telegram" ? "verified" : "valid",
            valueCiphertext: new Uint8Array(identity.valueCiphertext),
          }),
          message: Object.freeze({
            bodyCiphertext: new Uint8Array(message.bodyCiphertext),
            bodyHash: new Uint8Array(message.bodyHash),
            localeHint: localeHintFor(event),
            processingStatus: processingStatusFor(event),
          }),
          organizationId: context.organizationId,
          threadHash: new Uint8Array(threadHash),
        }),
      );
    },
  });
