import type {
  AgentDecisionV1,
  AgentFactualClaim,
  AgentInformationField,
  AppointmentRequestId,
  ChannelConnectionId,
  ConversationId,
  CorrelationId,
  Locale,
  MessageId,
  OrganizationId,
  LeadId,
  LocationId,
  ServiceId,
  ResourceId,
  PublishedBusinessKnowledgeV2,
} from "@lead-agent/contracts";

export type AIUsage = Readonly<{
  input: number | null;
  output: number | null;
  total: number | null;
  cachedInput: number | null;
  reasoning: number | null;
}>;
export type AIProviderMetadata = Readonly<{
  model: string | null;
  responseId: string | null;
  latencyMs: number;
  usage: AIUsage;
  outputHash?: Uint8Array;
}>;
export type AIProviderResult = AIProviderMetadata &
  (
    | Readonly<{ kind: "completed"; value: unknown }>
    | Readonly<{ kind: "invalid_output" }>
    | Readonly<{ kind: "refusal" }>
    | Readonly<{ kind: "timeout" }>
    | Readonly<{ kind: "incomplete"; reason: "output_limit" | "content_filter" | "unknown" }>
    | Readonly<{
        kind: "provider_error";
        category: "authentication" | "request" | "rate_limit" | "unavailable" | "network";
        retryable: boolean;
        retryAfterMs: number | null;
      }>
  );
export type GroundingNeed = "price" | "hours" | "duration" | "location" | "service" | "faq";
export type AIFact = Readonly<{
  reference: AgentFactualClaim;
  text: string;
  /** Application-only approved rendering metadata; NEVER projected into provider input. */
  grounding?: Readonly<{ locale: Locale; need: GroundingNeed; subject: string }>;
}>;
export type AIHistoryEntry = Readonly<{
  sequence: number;
  role: "customer" | "staff" | "system";
  text: string;
  /** Internal evidence binding, never projected into provider input. */
  messageId?: MessageId;
  /** Server receipt instant for relative preferences; never provider instructions. */
  receivedAt?: string;
}>;
export type SalesEvidence = Readonly<{
  serviceId: ServiceId | null;
  locationId: LocationId | null;
  positiveNextStep: boolean;
  serviceMessageId: MessageId | null;
  locationMessageId: MessageId | null;
  nextStepMessageId: MessageId | null;
}>;
/** Trusted application context, never model-authored or projected as instructions. */
export type SalesContext = Readonly<{
  leadId: LeadId;
  leadVersion: number;
  leadStatus: string;
  policy: Readonly<{ id: ResourceId; version: number }> | null;
  services: readonly Readonly<{
    id: ServiceId;
    names: readonly string[];
    locationIds: readonly LocationId[];
  }>[];
  locations: readonly Readonly<{ id: LocationId; names: readonly string[] }>[];
  stored: SalesEvidence;
  contactable: boolean;
}>;
export type SalesResult = Readonly<{
  kind:
    | "qualification_incomplete"
    | "qualified"
    | "handoff_requested"
    | "appointment_boundary"
    | "appointment_incomplete"
    | "appointment_requested"
    | "appointment_existing"
    | "grounding_insufficient";
  reason: string | null;
  missing: readonly string[];
}>;
export type AIProviderInput = Readonly<{
  locale: Locale;
  history: readonly AIHistoryEntry[];
  message: string;
  facts: readonly AIFact[];
  schemaVersion: "1";
  repair: boolean;
  signal: AbortSignal;
}>;
export interface AIProvider {
  decide(input: AIProviderInput): Promise<AIProviderResult>;
}
export type AIPolicyContext = Readonly<{
  automationMode: "ai" | "paused" | "staff";
  conversationStatus: "open" | "awaiting_lead" | "awaiting_staff" | "resolved" | "closed";
  missingFields: readonly AgentInformationField[];
  contactableWithoutPhone: boolean;
  facts: readonly AIFact[];
  appointments: readonly Readonly<{
    id: AppointmentRequestId;
    state: string;
    version: number;
    offerVersion: number;
    boundToConversation: boolean;
    customerConfirmationBound: boolean;
  }>[];
}>;
export type AIContextSnapshot = Readonly<{
  conversationId: ConversationId;
  sourceMessageId: MessageId;
  channelConnectionId: ChannelConnectionId;
  conversationVersion: number;
  sourceSequence: number;
  locale: Locale;
  message: string;
  history: readonly AIHistoryEntry[];
  policy: AIPolicyContext;
  sales?: SalesContext;
  sourceReceivedAt?: string;
  booking?: AppointmentSubmissionContext;
}>;
/** Private trusted submission context, not a configurable booking policy. */
export type AppointmentSubmissionContext = Readonly<{
  now: string;
  knowledge: PublishedBusinessKnowledgeV2 | null;
  activeRequestId: AppointmentRequestId | null;
  afterSequence: number;
  staffActive: boolean;
}>;
export type AIFallbackReason =
  | "provider_unavailable"
  | "timeout"
  | "refusal"
  | "invalid_output"
  | "context_too_large"
  | "policy_denied"
  | "grounding_insufficient"
  | "medical_safety_wording_unapproved"
  | "booking_availability_unapproved"
  | "staff_requested"
  | "stale_context";
export type AIOutcome =
  | Readonly<{
      kind: "decision";
      decision: AgentDecisionV1;
      disposition: "candidate" | "suppress";
      applied: false;
      salesResult?: SalesResult;
    }>
  | Readonly<{
      kind: "fallback_required";
      reason: AIFallbackReason;
      applied: false;
      salesResult?: SalesResult;
    }>;
export type AIWorkReference = Readonly<{
  organizationId: OrganizationId;
  messageId: MessageId;
  conversationId: ConversationId;
  correlationId: CorrelationId;
  causationId: string;
}>;
export type AIRunReservation = Readonly<{ runId: string; attemptNo: number }>;
export type AIRunFinish = Readonly<{
  reference: AIWorkReference;
  reservation: AIRunReservation;
  snapshot: AIContextSnapshot;
  provider: AIProviderResult | null;
  outcome: AIOutcome;
  allowRepair: boolean;
}>;
export interface AIOrchestrationStore {
  load(reference: AIWorkReference): Promise<AIContextSnapshot | null>;
  reserve(
    input: Readonly<{
      reference: AIWorkReference;
      snapshot: AIContextSnapshot;
      inputHash: Uint8Array;
    }>,
  ): Promise<AIRunReservation | null>;
  /** Revalidates source, state/version and references under fresh tenant context; writes run/evaluation/audit/outbox atomically. */
  finish(input: AIRunFinish): Promise<AIOutcome>;
}
export type AITelemetry = Readonly<{
  record(
    input: Readonly<{
      operation: "decide";
      outcome: AIOutcome["kind"];
      providerOutcome: AIProviderResult["kind"] | null;
      model: string | null;
      schemaVersion: "1";
      transportRetries: 0;
      failure: AIFallbackReason | null;
      latencyMs: number;
      usage: AIUsage | null;
      repair: boolean;
    }>,
  ): void;
}>;
