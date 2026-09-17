import {
  AgentDecisionV1Schema,
  ChannelConnectionIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type AgentDecisionV1,
} from "../../packages/contracts/src/index.js";
import type {
  AIContextSnapshot,
  AIProviderMetadata,
  AIWorkReference,
} from "../../packages/application/src/index.js";

export const fixtureId = (suffix: number): string =>
  `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;
const organizationId = fixtureId(12001),
  conversationId = fixtureId(12002),
  messageId = fixtureId(12003),
  correlationId = fixtureId(12004),
  channelId = fixtureId(12005);
if (
  !isSchemaValue(OrganizationIdSchema, organizationId) ||
  !isSchemaValue(ConversationIdSchema, conversationId) ||
  !isSchemaValue(MessageIdSchema, messageId) ||
  !isSchemaValue(CorrelationIdSchema, correlationId) ||
  !isSchemaValue(ChannelConnectionIdSchema, channelId)
)
  throw new TypeError("Invalid S12 fixture");
export const AI_REFERENCE: AIWorkReference = {
  organizationId,
  conversationId,
  messageId,
  correlationId,
  causationId: fixtureId(12006),
};
export const AI_SNAPSHOT: AIContextSnapshot = {
  conversationId,
  sourceMessageId: messageId,
  channelConnectionId: channelId,
  conversationVersion: 2,
  sourceSequence: 2,
  locale: "en",
  message: "Hello",
  history: [{ sequence: 1, role: "customer", text: "Salom" }],
  policy: {
    automationMode: "ai",
    conversationStatus: "open",
    missingFields: ["service", "name", "phone"],
    contactableWithoutPhone: true,
    facts: [],
    appointments: [],
  },
};
export const AI_METADATA: AIProviderMetadata = {
  model: "configured-test-model",
  responseId: "resp_test",
  latencyMs: 10,
  usage: { input: 10, output: 20, total: 30, cachedInput: 0, reasoning: 0 },
};
export const validDecision = (
  overrides: Readonly<Record<string, unknown>> = {},
): AgentDecisionV1 => {
  const candidate: unknown = {
    action: { type: "none" },
    confidence: 1,
    extracted_facts: {
      appointment_preference: null,
      display_name: null,
      email_raw: null,
      location_id: null,
      phone_raw: null,
      service_id: null,
    },
    factual_claims: [],
    intent: "greeting",
    language: "en",
    message: { draft_text: "Hello", mode: "send_candidate" },
    safety: { risk_flags: [], safe_to_send: true },
    schema_version: "1",
    ...overrides,
  };
  if (!isSchemaValue(AgentDecisionV1Schema, candidate))
    throw new TypeError("Invalid S12 decision fixture");
  return candidate;
};
