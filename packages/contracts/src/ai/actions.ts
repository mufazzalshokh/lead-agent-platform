import Type from "typebox";

import { AppointmentRequestIdSchema, type AppointmentRequestId } from "../shared/identifiers.js";
import { embedSchema, embedSchemaAs } from "./internal.js";
import { AgentHandoffReasonSchema, AgentInformationFieldSchema } from "./vocabulary.js";

const NoActionProposalSchema = Type.Object(
  {
    type: Type.Literal("none"),
  },
  { additionalProperties: false },
);

const RequestInformationActionProposalSchema = Type.Object(
  {
    field: embedSchema(AgentInformationFieldSchema),
    type: Type.Literal("request_information"),
  },
  { additionalProperties: false },
);

const CreateAppointmentRequestActionProposalSchema = Type.Object(
  {
    type: Type.Literal("create_appointment_request"),
  },
  { additionalProperties: false },
);

const ConfirmAppointmentActionProposalSchema = Type.Object(
  {
    appointment_request_id: embedSchemaAs<AppointmentRequestId>(AppointmentRequestIdSchema),
    type: Type.Literal("confirm_appointment"),
  },
  { additionalProperties: false },
);

const DeclineAppointmentActionProposalSchema = Type.Object(
  {
    appointment_request_id: embedSchemaAs<AppointmentRequestId>(AppointmentRequestIdSchema),
    type: Type.Literal("decline_appointment"),
  },
  { additionalProperties: false },
);

const RequestHandoffActionProposalSchema = Type.Object(
  {
    reason: embedSchema(AgentHandoffReasonSchema),
    type: Type.Literal("request_handoff"),
  },
  { additionalProperties: false },
);

/**
 * An action is an untrusted proposal only. Runtime schema validity never means
 * that a tenant, actor, resource, state transition, fact, or side effect is authorized.
 */
export const AgentDecisionActionSchema = Type.Union(
  [
    NoActionProposalSchema,
    RequestInformationActionProposalSchema,
    CreateAppointmentRequestActionProposalSchema,
    ConfirmAppointmentActionProposalSchema,
    DeclineAppointmentActionProposalSchema,
    RequestHandoffActionProposalSchema,
  ],
  {
    $id: "AgentDecisionAction.v1",
    description:
      "Exactly one runtime-discriminated application action proposal; no generic tool execution surface exists.",
  },
);
export type AgentDecisionAction = Type.Static<typeof AgentDecisionActionSchema>;
