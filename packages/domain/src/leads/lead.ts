import {
  AggregateVersionSchema,
  AppointmentRequestIdSchema,
  ContactIdSchema,
  DomainEventPayloadSchemas,
  LeadIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type AggregateVersion,
  type AppointmentRequestId,
  type ContactId,
  type DomainEventPayloadByName,
  type LeadId,
  type OrganizationId,
  type ResourceId,
} from "@lead-agent/contracts";

import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";

const LeadStatusSchema = DomainEventPayloadSchemas["lead.closed"].properties.previous_lead_status;

export type LeadStatus = DomainEventPayloadByName["lead.closed"]["previous_lead_status"];

export type QualifiedLeadEvidence = Readonly<{
  evaluationId: ResourceId;
  policyId: ResourceId;
  reasonCodes: readonly [];
  result: "qualified";
}>;

export type DisqualifiedLeadEvidence = Readonly<{
  evaluationId: ResourceId;
  policyId: ResourceId;
  reasonCodes: readonly string[];
  result: "disqualified";
}>;

export type LeadQualification = QualifiedLeadEvidence | DisqualifiedLeadEvidence;

export type Lead = Readonly<{
  appointmentRequestId: AppointmentRequestId | null;
  contactId: ContactId;
  leadId: LeadId;
  organizationId: OrganizationId;
  qualification: LeadQualification | null;
  status: LeadStatus;
  version: AggregateVersion;
}>;

export type InvalidLead = InvariantViolation<"invalid_lead">;

export const isLeadStatus = (value: unknown): value is LeadStatus =>
  isSchemaValue(LeadStatusSchema, value);

const isQualification = (value: LeadQualification | null): boolean => {
  if (value === null) {
    return true;
  }

  if (value.result === "qualified") {
    return (
      value.reasonCodes.length === 0 &&
      isSchemaValue(DomainEventPayloadSchemas["lead.qualified"], {
        lead_status: "qualified",
        policy_id: value.policyId,
        qualification_evaluation_id: value.evaluationId,
      })
    );
  }

  return isSchemaValue(DomainEventPayloadSchemas["lead.disqualified"], {
    lead_status: "disqualified",
    policy_id: value.policyId,
    qualification_evaluation_id: value.evaluationId,
    reason_codes: value.reasonCodes,
  });
};

const hasConsistentLifecycleShape = (lead: Lead): boolean => {
  switch (lead.status) {
    case "new":
      return lead.appointmentRequestId === null && lead.qualification === null;
    case "engaged":
      return lead.appointmentRequestId === null;
    case "qualified":
      return lead.appointmentRequestId === null && lead.qualification?.result === "qualified";
    case "disqualified":
      return lead.appointmentRequestId === null && lead.qualification?.result === "disqualified";
    case "booking_requested":
    case "converted":
      return lead.appointmentRequestId !== null && lead.qualification?.result === "qualified";
    case "closed":
      return true;
  }
};

export const validateLead = (lead: Lead): Result<Lead, InvalidLead> => {
  const appointmentRequestIdIsValid =
    lead.appointmentRequestId === null ||
    isSchemaValue(AppointmentRequestIdSchema, lead.appointmentRequestId);

  if (
    !isSchemaValue(LeadIdSchema, lead.leadId) ||
    !isSchemaValue(OrganizationIdSchema, lead.organizationId) ||
    !isSchemaValue(ContactIdSchema, lead.contactId) ||
    !isLeadStatus(lead.status) ||
    !isSchemaValue(AggregateVersionSchema, lead.version) ||
    !appointmentRequestIdIsValid ||
    !isQualification(lead.qualification) ||
    !hasConsistentLifecycleShape(lead)
  ) {
    return failure(invariantViolation("invalid_lead"));
  }

  return success(lead);
};
