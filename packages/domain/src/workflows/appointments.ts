import {
  OrganizationIdSchema,
  ResourceIdSchema,
  isSchemaValue,
  type OrganizationId,
  type ResourceId,
} from "@lead-agent/contracts";

import {
  cancelAppointmentRequest,
  confirmAppointmentRequest,
  createAppointmentRequest,
  expireAppointmentRequest,
  rejectAppointmentRequest,
  type AppointmentRequest,
  type AppointmentRequestCommandError,
  type AppointmentRequestCreationError,
  type AppointmentRequestEventDraft,
  type AppointmentRequestTransitionRecord,
  type CancelAppointmentRequestCommand,
  type ConfirmAppointmentRequestCommand,
  type CreateAppointmentRequestCommand,
  type ExpireAppointmentRequestCommand,
  type RejectAppointmentRequestCommand,
} from "../appointments/index.js";
import {
  invalidStateTransition,
  invariantViolation,
  type ConcurrencyConflict,
  type InvalidStateTransition,
  type InvariantViolation,
  type TenantScopeViolation,
} from "../foundation/errors.js";
import { cloneAndFreeze, type DeepReadonly } from "../foundation/immutable.js";
import { failure, success, type Result } from "../foundation/result.js";
import { checkExpectedAggregateVersion } from "../foundation/version.js";
import {
  convertLead,
  recordAppointmentRequest,
  restoreAfterAppointmentRequest,
  type Lead,
  type LeadCommandContext,
  type LeadCommandError,
  type LeadEventDraft,
  type LeadReasonCode,
  type LeadTransitionRecord,
} from "../leads/index.js";
import { requireSameOrganization } from "../values/tenant.js";

type AppointmentWorkflowEventDraft = AppointmentRequestEventDraft | LeadEventDraft;
type AppointmentWorkflowTransitionRecord =
  AppointmentRequestTransitionRecord | LeadTransitionRecord;

type AppointmentWorkflowPlan = Readonly<{
  appointmentRequest: DeepReadonly<AppointmentRequest>;
  events: readonly DeepReadonly<AppointmentWorkflowEventDraft>[];
  lead: DeepReadonly<Lead>;
  transitionRecords: readonly DeepReadonly<AppointmentWorkflowTransitionRecord>[];
}>;

type AppointmentWorkflowVersionError = ConcurrencyConflict | InvariantViolation<"invalid_version">;

export type CreateAppointmentRequestWorkflowError =
  AppointmentRequestCreationError | LeadCommandError;

export type ConfirmAppointmentRequestWorkflowError =
  AppointmentRequestCommandError | LeadCommandError;

export type AppointmentRetryPolicyDecision =
  | Readonly<{
      approved: false;
      organizationId: OrganizationId;
    }>
  | Readonly<{
      approved: true;
      organizationId: OrganizationId;
      policyId: ResourceId;
      reasonCode: LeadReasonCode;
    }>;

export type EndAppointmentRequestAction =
  | Readonly<{ action: "cancelled"; command: CancelAppointmentRequestCommand }>
  | Readonly<{ action: "expired"; command: ExpireAppointmentRequestCommand }>
  | Readonly<{ action: "rejected"; command: RejectAppointmentRequestCommand }>;

export type EndAppointmentRequestWorkflowError =
  AppointmentRequestCommandError | LeadCommandError | AppointmentWorkflowVersionError;

export type CancelConfirmedAppointmentRequestWorkflowError =
  | AppointmentRequestCommandError
  | AppointmentWorkflowVersionError
  | InvalidStateTransition<Lead["status"], "cancel_confirmed_appointment_request">;

export type CreateAppointmentRequestWorkflowCommand = Readonly<{
  appointmentRequest: CreateAppointmentRequestCommand;
  lead: LeadCommandContext;
}>;

export type ConfirmAppointmentRequestWorkflowCommand = Readonly<{
  appointmentRequest: ConfirmAppointmentRequestCommand;
  lead: LeadCommandContext;
}>;

export type EndAppointmentRequestWorkflowCommand = Readonly<{
  appointmentRequest: EndAppointmentRequestAction;
  lead: LeadCommandContext;
  retryPolicy: AppointmentRetryPolicyDecision;
}>;

export type CancelConfirmedAppointmentRequestWorkflowCommand = Readonly<{
  appointmentRequest: CancelAppointmentRequestCommand;
  lead: LeadCommandContext;
}>;

export type CreateAppointmentRequestWorkflowResult = Result<
  AppointmentWorkflowPlan,
  DeepReadonly<CreateAppointmentRequestWorkflowError>
>;

export type ConfirmAppointmentRequestWorkflowResult = Result<
  AppointmentWorkflowPlan,
  DeepReadonly<ConfirmAppointmentRequestWorkflowError>
>;

export type EndAppointmentRequestWorkflowResult = Result<
  AppointmentWorkflowPlan,
  DeepReadonly<EndAppointmentRequestWorkflowError>
>;

export type CancelConfirmedAppointmentRequestWorkflowResult = Result<
  AppointmentWorkflowPlan,
  DeepReadonly<CancelConfirmedAppointmentRequestWorkflowError>
>;

const invalidReference = (): InvariantViolation<"invalid_reference"> =>
  invariantViolation("invalid_reference");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const workflowFailure = <Error>(error: Error) => failure(cloneAndFreeze(error));

const workflowSuccess = (
  appointmentRequest: AppointmentRequest,
  lead: Lead,
  events: readonly AppointmentWorkflowEventDraft[],
  transitionRecords: readonly AppointmentWorkflowTransitionRecord[],
) =>
  success(
    cloneAndFreeze({
      appointmentRequest,
      events,
      lead,
      transitionRecords,
    }),
  );

const validateLeadAppointmentLink = (
  lead: Lead,
  appointmentRequest: Pick<
    AppointmentRequest,
    "appointmentRequestId" | "contactId" | "leadId" | "organizationId"
  >,
): Result<void, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  const sameOrganization = requireSameOrganization(
    lead.organizationId,
    appointmentRequest.organizationId,
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  return lead.leadId === appointmentRequest.leadId &&
    lead.contactId === appointmentRequest.contactId
    ? success(undefined)
    : failure(invalidReference());
};

const validateExistingAppointmentLink = (
  lead: Lead,
  appointmentRequest: AppointmentRequest,
): Result<void, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  const linked = validateLeadAppointmentLink(lead, appointmentRequest);
  if (!linked.ok) {
    return linked;
  }

  return lead.appointmentRequestId === appointmentRequest.appointmentRequestId
    ? success(undefined)
    : failure(invalidReference());
};

const validateLeadContext = (
  lead: Lead,
  context: LeadCommandContext,
): Result<void, AppointmentWorkflowVersionError | TenantScopeViolation> => {
  const sameOrganization = requireSameOrganization(lead.organizationId, context.organizationId);
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  const version = checkExpectedAggregateVersion(lead.version, context.expectedVersion);
  return version.ok ? success(undefined) : failure(version.error);
};

const validateRetryPolicy = (
  decision: AppointmentRetryPolicyDecision,
  organizationId: OrganizationId,
): Result<
  AppointmentRetryPolicyDecision,
  InvariantViolation<"invalid_reference"> | TenantScopeViolation
> => {
  if (
    !isRecord(decision) ||
    typeof decision["approved"] !== "boolean" ||
    !isSchemaValue(OrganizationIdSchema, decision["organizationId"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(organizationId, decision["organizationId"]);
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  if (decision["approved"] === false) {
    return success(decision);
  }

  return isSchemaValue(ResourceIdSchema, decision["policyId"]) &&
    typeof decision["reasonCode"] === "string"
    ? success(decision)
    : failure(invalidReference());
};

const endAppointmentRequest = (
  appointmentRequest: AppointmentRequest,
  action: EndAppointmentRequestAction,
) => {
  switch (action.action) {
    case "cancelled":
      return cancelAppointmentRequest(appointmentRequest, action.command);
    case "expired":
      return expireAppointmentRequest(appointmentRequest, action.command);
    case "rejected":
      return rejectAppointmentRequest(appointmentRequest, action.command);
  }
};

export const createAppointmentRequestWorkflow = (
  lead: Lead,
  command: CreateAppointmentRequestWorkflowCommand,
): CreateAppointmentRequestWorkflowResult => {
  const sameOrganization = requireSameOrganization(
    lead.organizationId,
    command.appointmentRequest.organizationId,
  );
  if (!sameOrganization.ok) {
    return workflowFailure(sameOrganization.error);
  }
  if (
    lead.leadId !== command.appointmentRequest.lead.leadId ||
    lead.contactId !== command.appointmentRequest.contact.contactId
  ) {
    return workflowFailure(invalidReference());
  }

  const appointmentTransition = createAppointmentRequest(command.appointmentRequest);
  if (!appointmentTransition.ok) {
    return workflowFailure(appointmentTransition.error);
  }

  const linked = validateLeadAppointmentLink(lead, appointmentTransition.value.nextAggregate);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }

  const leadTransition = recordAppointmentRequest(lead, {
    ...command.lead,
    appointmentRequest: {
      appointmentRequestId: appointmentTransition.value.nextAggregate.appointmentRequestId,
      organizationId: appointmentTransition.value.nextAggregate.organizationId,
    },
  });
  if (!leadTransition.ok) {
    return workflowFailure(leadTransition.error);
  }

  return workflowSuccess(
    appointmentTransition.value.nextAggregate,
    leadTransition.value.nextAggregate,
    [...appointmentTransition.value.events, ...leadTransition.value.events],
    [...appointmentTransition.value.transitionRecords, ...leadTransition.value.transitionRecords],
  );
};

export const confirmAppointmentRequestWorkflow = (
  appointmentRequest: AppointmentRequest,
  lead: Lead,
  command: ConfirmAppointmentRequestWorkflowCommand,
): ConfirmAppointmentRequestWorkflowResult => {
  const linked = validateExistingAppointmentLink(lead, appointmentRequest);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }

  const appointmentTransition = confirmAppointmentRequest(
    appointmentRequest,
    command.appointmentRequest,
  );
  if (!appointmentTransition.ok) {
    return workflowFailure(appointmentTransition.error);
  }

  const leadTransition = convertLead(lead, {
    ...command.lead,
    appointmentRequest: {
      appointmentRequestId: appointmentTransition.value.nextAggregate.appointmentRequestId,
      organizationId: appointmentTransition.value.nextAggregate.organizationId,
    },
  });
  if (!leadTransition.ok) {
    return workflowFailure(leadTransition.error);
  }

  return workflowSuccess(
    appointmentTransition.value.nextAggregate,
    leadTransition.value.nextAggregate,
    [...appointmentTransition.value.events, ...leadTransition.value.events],
    [...appointmentTransition.value.transitionRecords, ...leadTransition.value.transitionRecords],
  );
};

export const endAppointmentRequestWorkflow = (
  appointmentRequest: AppointmentRequest,
  lead: Lead,
  command: EndAppointmentRequestWorkflowCommand,
): EndAppointmentRequestWorkflowResult => {
  const linked = validateExistingAppointmentLink(lead, appointmentRequest);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }
  const validLeadContext = validateLeadContext(lead, command.lead);
  if (!validLeadContext.ok) {
    return workflowFailure(validLeadContext.error);
  }
  const retryPolicy = validateRetryPolicy(command.retryPolicy, lead.organizationId);
  if (!retryPolicy.ok) {
    return workflowFailure(retryPolicy.error);
  }

  const appointmentTransition = endAppointmentRequest(
    appointmentRequest,
    command.appointmentRequest,
  );
  if (!appointmentTransition.ok) {
    return workflowFailure(appointmentTransition.error);
  }

  if (!retryPolicy.value.approved) {
    return workflowSuccess(
      appointmentTransition.value.nextAggregate,
      lead,
      appointmentTransition.value.events,
      appointmentTransition.value.transitionRecords,
    );
  }

  const leadTransition = restoreAfterAppointmentRequest(lead, {
    ...command.lead,
    appointmentRequest: {
      appointmentRequestId: appointmentTransition.value.nextAggregate.appointmentRequestId,
      organizationId: appointmentTransition.value.nextAggregate.organizationId,
    },
    reasonCode: retryPolicy.value.reasonCode,
  });
  if (!leadTransition.ok) {
    return workflowFailure(leadTransition.error);
  }

  return workflowSuccess(
    appointmentTransition.value.nextAggregate,
    leadTransition.value.nextAggregate,
    [...appointmentTransition.value.events, ...leadTransition.value.events],
    [...appointmentTransition.value.transitionRecords, ...leadTransition.value.transitionRecords],
  );
};

export const cancelConfirmedAppointmentRequestWorkflow = (
  appointmentRequest: AppointmentRequest,
  lead: Lead,
  command: CancelConfirmedAppointmentRequestWorkflowCommand,
): CancelConfirmedAppointmentRequestWorkflowResult => {
  const linked = validateExistingAppointmentLink(lead, appointmentRequest);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }
  const validLeadContext = validateLeadContext(lead, command.lead);
  if (!validLeadContext.ok) {
    return workflowFailure(validLeadContext.error);
  }
  if (lead.status !== "converted") {
    return workflowFailure(
      invalidStateTransition(lead.status, "cancel_confirmed_appointment_request"),
    );
  }

  const appointmentTransition = cancelAppointmentRequest(
    appointmentRequest,
    command.appointmentRequest,
  );
  if (!appointmentTransition.ok) {
    return workflowFailure(appointmentTransition.error);
  }

  return workflowSuccess(
    appointmentTransition.value.nextAggregate,
    lead,
    appointmentTransition.value.events,
    appointmentTransition.value.transitionRecords,
  );
};
