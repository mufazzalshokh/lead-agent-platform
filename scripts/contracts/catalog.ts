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
  configuration: [
    "BusinessHoursIntervalSchema",
    "BusinessPolicyListFilterSchema",
    "BusinessPolicySchema",
    "BusinessPolicyTypeSchema",
    "CancelLocationClosureInputSchema",
    "ChangeServiceLocationInputSchema",
    "ConfigurationCodeSchema",
    "ConfigurationIdempotencyKeySchema",
    "ConfigurationKeySchema",
    "ConfigurationRootStatusSchema",
    "ContentHashSchema",
    "CreateBusinessPolicyDraftInputSchema",
    "CreateFaqDraftInputSchema",
    "CreateLocationClosureInputSchema",
    "CreateLocationInputSchema",
    "CreateServiceInputSchema",
    "CreateServicePriceDraftInputSchema",
    "DeactivateLocationInputSchema",
    "DeactivateServiceInputSchema",
    "EffectiveIntervalSchema",
    "FaqListFilterSchema",
    "FaqSchema",
    "IanaTimeZoneSchema",
    "LocalDateSchema",
    "LocalizedTextSchema",
    "LocalTimeSchema",
    "LocationClosureKindSchema",
    "LocationClosureRecordSchema",
    "LocationClosureStatusSchema",
    "LocationListFilterSchema",
    "LocationPublicContactSchema",
    "LocationPublishedVersionSchema",
    "LocationRootSchema",
    "PublishBusinessPolicyInputSchema",
    "PublishedBusinessKnowledgeRequestSchema",
    "PublishedBusinessKnowledgeSchema",
    "PublishedConfigurationProvenanceSchema",
    "PublishFaqInputSchema",
    "PublishLocationInputSchema",
    "PublishServiceInputSchema",
    "PublishServicePriceInputSchema",
    "QualificationDisqualificationReasonSchema",
    "QualificationEvidenceKeySchema",
    "QualificationOutcomeSchema",
    "QualificationPolicyV1RulesSchema",
    "RetireBusinessPolicyInputSchema",
    "RetireFaqInputSchema",
    "RetireServicePriceInputSchema",
    "ServiceListFilterSchema",
    "ServiceLocationRecordSchema",
    "ServiceLocationStatusSchema",
    "ServicePriceListFilterSchema",
    "ServicePriceRecordSchema",
    "ServicePriceTermsSchema",
    "ServicePriceTypeSchema",
    "ServicePublishedVersionSchema",
    "ServiceRootSchema",
    "SupersedeLocationClosureInputSchema",
    "UpdateBusinessPolicyDraftInputSchema",
    "UpdateFaqDraftInputSchema",
    "UpdateServicePriceDraftInputSchema",
    "VersionedConfigurationStatusSchema",
    "WeekdaySchema",
    "WeeklyBusinessHoursSchema",
  ],
  event: [
    "DomainEventNameSchema",
    "DomainAggregateTypeSchema",
    "DomainEventSchema",
    "LeadReopenedDomainEventV2Schema",
    "LeadReopenedDomainEventPayloadV2Schema",
  ],
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
const CONTRACT_CATEGORIES = ["ai", "api", "channel", "configuration", "event", "shared"] as const;

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
