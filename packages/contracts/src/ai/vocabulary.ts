import Type from "typebox";

import { LocaleSchema } from "../shared/localization.js";
import { embedSchema } from "./internal.js";

export const AgentDecisionLanguageSchema = Type.Union(
  [embedSchema(LocaleSchema), Type.Literal("unknown")],
  {
    $id: "AgentDecisionLanguage.v1",
    description:
      "Supported customer language detected by the model, or unknown when it cannot decide safely.",
  },
);
export type AgentDecisionLanguage = Type.Static<typeof AgentDecisionLanguageSchema>;

export const AgentIntentSchema = Type.Union(
  [
    Type.Literal("greeting"),
    Type.Literal("faq"),
    Type.Literal("service_inquiry"),
    Type.Literal("pricing"),
    Type.Literal("qualification"),
    Type.Literal("provide_contact"),
    Type.Literal("booking_request"),
    Type.Literal("booking_confirmation"),
    Type.Literal("booking_decline"),
    Type.Literal("human_request"),
    Type.Literal("medical_question"),
    Type.Literal("complaint"),
    Type.Literal("unsafe_or_abusive"),
    Type.Literal("other"),
  ],
  {
    $id: "AgentIntent.v1",
    description: "Closed Stage 0 intent vocabulary for AgentDecision V1.",
  },
);
export type AgentIntent = Type.Static<typeof AgentIntentSchema>;

export const AgentFactualClaimKindSchema = Type.Union(
  [
    Type.Literal("service"),
    Type.Literal("price"),
    Type.Literal("hours"),
    Type.Literal("policy"),
    Type.Literal("faq"),
    Type.Literal("location"),
    Type.Literal("booking_offer"),
  ],
  {
    $id: "AgentFactualClaimKind.v1",
    description: "Closed classification for a proposed customer-facing factual claim.",
  },
);
export type AgentFactualClaimKind = Type.Static<typeof AgentFactualClaimKindSchema>;

export const AgentFactualClaimSourceTypeSchema = Type.Union(
  [
    Type.Literal("service"),
    Type.Literal("service_price"),
    Type.Literal("business_policy"),
    Type.Literal("faq"),
    Type.Literal("location"),
    Type.Literal("appointment_request"),
  ],
  {
    $id: "AgentFactualClaimSourceType.v1",
    description:
      "Closed authoritative-record category. The application must validate each cited record and revision.",
  },
);
export type AgentFactualClaimSourceType = Type.Static<typeof AgentFactualClaimSourceTypeSchema>;

export const AgentActionTypeSchema = Type.Union(
  [
    Type.Literal("none"),
    Type.Literal("request_information"),
    Type.Literal("create_appointment_request"),
    Type.Literal("confirm_appointment"),
    Type.Literal("decline_appointment"),
    Type.Literal("request_handoff"),
  ],
  {
    $id: "AgentActionType.v1",
    description:
      "Closed application-owned action proposal vocabulary; it is not a provider tool registry.",
  },
);
export type AgentActionType = Type.Static<typeof AgentActionTypeSchema>;

export const AgentInformationFieldSchema = Type.Union(
  [
    Type.Literal("name"),
    Type.Literal("phone"),
    Type.Literal("email"),
    Type.Literal("service"),
    Type.Literal("location"),
    Type.Literal("appointment_time"),
    Type.Literal("booking_confirmation"),
  ],
  {
    $id: "AgentInformationField.v1",
    description: "Closed field vocabulary for a request-information proposal.",
  },
);
export type AgentInformationField = Type.Static<typeof AgentInformationFieldSchema>;

export const AgentHandoffReasonSchema = Type.Union(
  [
    Type.Literal("customer_requested"),
    Type.Literal("missing_authoritative_information"),
    Type.Literal("medical_or_safety"),
    Type.Literal("low_confidence"),
    Type.Literal("policy_blocked"),
    Type.Literal("ai_unavailable"),
    Type.Literal("delivery_problem"),
    Type.Literal("other"),
  ],
  {
    $id: "AgentHandoffReason.v1",
    description: "Closed model-proposable handoff reason vocabulary.",
  },
);
export type AgentHandoffReason = Type.Static<typeof AgentHandoffReasonSchema>;

export const AgentMessageModeSchema = Type.Union(
  [Type.Literal("send_candidate"), Type.Literal("use_safe_template"), Type.Literal("suppress")],
  {
    $id: "AgentMessageMode.v1",
    description:
      "Advisory response mode; deterministic application policy selects the actual outbound behavior.",
  },
);
export type AgentMessageMode = Type.Static<typeof AgentMessageModeSchema>;

export const AgentRiskFlagSchema = Type.Union(
  [
    Type.Literal("medical_content"),
    Type.Literal("price_missing"),
    Type.Literal("availability_unknown"),
    Type.Literal("service_missing"),
    Type.Literal("prompt_injection"),
    Type.Literal("sensitive_data"),
    Type.Literal("abuse"),
    Type.Literal("ambiguous_confirmation"),
  ],
  {
    $id: "AgentRiskFlag.v1",
    description:
      "Closed advisory risk vocabulary for later deterministic policy evaluation; it grants no permission.",
  },
);
export type AgentRiskFlag = Type.Static<typeof AgentRiskFlagSchema>;
