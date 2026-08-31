import * as Contracts from "../../packages/contracts/src/index.js";

export const PUBLIC_STATIC_SCHEMA_NAMES = {
  ai: [
    "AgentDecisionLanguageSchema",
    "AgentIntentSchema",
    "AgentFactualClaimKindSchema",
    "AgentFactualClaimSourceTypeSchema",
    "AgentActionTypeSchema",
    "AgentInformationFieldSchema",
    "AgentHandoffReasonSchema",
    "AgentMessageModeSchema",
    "AgentRiskFlagSchema",
    "AgentAppointmentPreferenceSchema",
    "AgentExtractedFactsSchema",
    "AgentFactualClaimSchema",
    "AgentDecisionActionSchema",
    "AgentDecisionMessageSchema",
    "AgentDecisionSafetySchema",
    "AgentDecisionV1Schema",
  ],
  api: [
    "ApiErrorCodeSchema",
    "ValidationIssueSchema",
    "ProblemSchema",
    "OpaqueCursorSchema",
    "PageSizeSchema",
    "PaginationRequestSchema",
    "PaginationMetaSchema",
    "ResponseMetaSchema",
  ],
  channel: [
    "ChannelTypeSchema",
    "InboundMessageKindSchema",
    "ChannelMediaKindSchema",
    "ChannelTextFormatSchema",
    "ChannelFailureCategorySchema",
    "ExternalChannelEventIdSchema",
    "ExternalChannelAccountIdSchema",
    "ExternalChannelConversationIdSchema",
    "ExternalChannelMessageIdSchema",
    "ExternalChannelParticipantIdSchema",
    "ProviderMediaReferenceSchema",
    "ChannelActionTokenSchema",
    "ChannelIdempotencyKeySchema",
    "InboundTextContentSchema",
    "InboundQuickReplyContentSchema",
    "InboundAttachmentContentSchema",
    "InboundDeliveryStatusContentSchema",
    "InboundUnsupportedContentSchema",
    "InboundChannelContentSchema",
    "CanonicalInboundEventSchema",
    "OutboundQuickReplySchema",
    "OutboundChannelContentSchema",
    "SendChannelMessageSchema",
    "ChannelCapabilitiesSchema",
  ],
  event: ["DomainEventNameSchema", "DomainAggregateTypeSchema", "DomainEventSchema"],
  shared: [
    "ActorRefSchema",
    "UuidV7Schema",
    "ResourceIdSchema",
    "OrganizationIdSchema",
    "UserIdSchema",
    "MembershipIdSchema",
    "LocationIdSchema",
    "ServiceIdSchema",
    "ContactIdSchema",
    "LeadIdSchema",
    "ConversationIdSchema",
    "MessageIdSchema",
    "AppointmentRequestIdSchema",
    "HandoffIdSchema",
    "ChannelConnectionIdSchema",
    "AiRunIdSchema",
    "EventIdSchema",
    "RequestIdSchema",
    "CorrelationIdSchema",
    "CausationIdSchema",
    "SchemaIdSchema",
    "LocaleSchema",
    "CurrencyCodeSchema",
    "MoneySchema",
    "UtcTimestampSchema",
    "SchemaVersionSchema",
    "ResourceVersionSchema",
    "AggregateVersionSchema",
  ],
} as const;

export type ContractCategory = keyof typeof PUBLIC_STATIC_SCHEMA_NAMES;

export type PublicContractEntry = {
  readonly category: ContractCategory;
  readonly exportName: string;
  readonly schema: unknown;
};

const publicExports = new Map<string, unknown>(Object.entries(Contracts));
const CONTRACT_CATEGORIES = ["ai", "api", "channel", "event", "shared"] as const;

const requirePublicExport = (exportName: string) => {
  const value = publicExports.get(exportName);

  if (value === undefined) {
    throw new TypeError(`Missing public contract export: ${exportName}`);
  }

  return value;
};

export const getPublicContractCatalog = (): readonly PublicContractEntry[] => {
  const staticEntries = CONTRACT_CATEGORIES.flatMap((category) =>
    PUBLIC_STATIC_SCHEMA_NAMES[category].map((exportName) => ({
      category,
      exportName,
      schema: requirePublicExport(exportName),
    })),
  );

  const eventEntries = Contracts.DOMAIN_EVENT_NAMES.flatMap((eventName) => [
    {
      category: "event" as const,
      exportName: `DomainEventSchemas[${JSON.stringify(eventName)}]`,
      schema: Contracts.DomainEventSchemas[eventName],
    },
    {
      category: "event" as const,
      exportName: `DomainEventPayloadSchemas[${JSON.stringify(eventName)}]`,
      schema: Contracts.DomainEventPayloadSchemas[eventName],
    },
  ]);

  return [...staticEntries, ...eventEntries].sort((left, right) =>
    left.exportName.localeCompare(right.exportName),
  );
};
