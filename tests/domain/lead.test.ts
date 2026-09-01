import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ActorRefSchema,
  AppointmentRequestIdSchema,
  ContactIdSchema,
  CorrelationIdSchema,
  DomainEventPayloadSchemas,
  DomainEventSchemas,
  EventIdSchema,
  LeadIdSchema,
  LeadReopenedDomainEventPayloadV2Schema,
  LeadReopenedDomainEventV2Schema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type AppointmentRequestId,
  type ContactId,
  type CorrelationId,
  type EventId,
  type LeadId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import {
  closeLead,
  convertLead,
  createLead,
  disqualifyLead,
  qualifyLead,
  recordAppointmentRequest,
  recordEngagement,
  reopenDisqualifiedLead,
  restoreAfterAppointmentRequest,
  validateLeadReasonCode,
  type ExistingLeadCommandName,
  type Lead,
  type LeadAppointmentRequestReference,
  type LeadCommandContext,
  type LeadCommandResult,
  type LeadCreationResult,
  type LeadEventDraft,
  type LeadMessageReference,
  type LeadQualificationEvidence,
  type LeadReasonCode,
  type LeadStatus,
} from "../../packages/domain/src/index.js";

const requireOrganizationId = (value: string): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, value)) {
    throw new TypeError("Invalid organization fixture");
  }
  return value;
};

const requireLeadId = (value: string): LeadId => {
  if (!isSchemaValue(LeadIdSchema, value)) {
    throw new TypeError("Invalid Lead fixture");
  }
  return value;
};

const requireContactId = (value: string): ContactId => {
  if (!isSchemaValue(ContactIdSchema, value)) {
    throw new TypeError("Invalid contact fixture");
  }
  return value;
};

const requireMessageId = (value: string): MessageId => {
  if (!isSchemaValue(MessageIdSchema, value)) {
    throw new TypeError("Invalid message fixture");
  }
  return value;
};

const requireAppointmentRequestId = (value: string): AppointmentRequestId => {
  if (!isSchemaValue(AppointmentRequestIdSchema, value)) {
    throw new TypeError("Invalid appointment-request fixture");
  }
  return value;
};

const requireResourceId = (value: string): ResourceId => {
  if (!isSchemaValue(ResourceIdSchema, value)) {
    throw new TypeError("Invalid resource fixture");
  }
  return value;
};

const requireEventId = (value: string): EventId => {
  if (!isSchemaValue(EventIdSchema, value)) {
    throw new TypeError("Invalid event fixture");
  }
  return value;
};

const requireCorrelationId = (value: string): CorrelationId => {
  if (!isSchemaValue(CorrelationIdSchema, value)) {
    throw new TypeError("Invalid correlation fixture");
  }
  return value;
};

const requireUtcTimestamp = (value: string): UtcTimestamp => {
  if (!isSchemaValue(UtcTimestampSchema, value)) {
    throw new TypeError("Invalid time fixture");
  }
  return value;
};

const requireReasonCode = (value: string): LeadReasonCode => {
  const result = validateLeadReasonCode(value);
  if (!result.ok) {
    throw new TypeError("Invalid reason fixture");
  }
  return result.value;
};

const ORGANIZATION_A = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c41c2b");
const ORGANIZATION_B = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c41c2c");
const LEAD_ID = requireLeadId("0193f1a8-7f65-7c28-a434-a10796c41c2d");
const CONTACT_ID = requireContactId("0193f1a8-7f65-7c28-a434-a10796c41c2e");
const OTHER_CONTACT_ID = requireContactId("0193f1a8-7f65-7c28-a434-a10796c41c2f");
const MESSAGE_ID = requireMessageId("0193f1a8-7f65-7c28-a434-a10796c41c30");
const APPOINTMENT_REQUEST_ID = requireAppointmentRequestId("0193f1a8-7f65-7c28-a434-a10796c41c31");
const OTHER_APPOINTMENT_REQUEST_ID = requireAppointmentRequestId(
  "0193f1a8-7f65-7c28-a434-a10796c41c32",
);
const POLICY_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c41c33");
const EVALUATION_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c41c34");
const EVENT_ID = requireEventId("0193f1a8-7f65-7c28-a434-a10796c41c35");
const CORRELATION_ID = requireCorrelationId("0193f1a8-7f65-7c28-a434-a10796c41c36");
const OCCURRED_AT = requireUtcTimestamp("2026-09-01T12:00:00Z");
const DISQUALIFICATION_REASON = requireReasonCode("outside_service_area");
const REOPEN_REASON = requireReasonCode("new_evidence");
const RESTORE_REASON = requireReasonCode("request_ended_retry_allowed");
const CLOSE_REASON = requireReasonCode("staff_closed");
const SYSTEM_ACTOR = Object.freeze({
  actor_id: null,
  actor_type: "system",
} as const satisfies ActorRef);

const SOURCE_MESSAGE = Object.freeze({
  messageId: MESSAGE_ID,
  organizationId: ORGANIZATION_A,
} satisfies LeadMessageReference);

const APPOINTMENT_REQUEST = Object.freeze({
  appointmentRequestId: APPOINTMENT_REQUEST_ID,
  organizationId: ORGANIZATION_A,
} satisfies LeadAppointmentRequestReference);

const QUALIFICATION = Object.freeze({
  evaluationId: EVALUATION_ID,
  organizationId: ORGANIZATION_A,
  policyId: POLICY_ID,
} satisfies LeadQualificationEvidence);

const LEAD_STATUSES = [
  "new",
  "engaged",
  "qualified",
  "disqualified",
  "booking_requested",
  "converted",
  "closed",
] as const satisfies readonly LeadStatus[];

const commandContext = (
  lead: Lead,
  expectedVersion: AggregateVersion = lead.version,
): LeadCommandContext => ({
  actor: SYSTEM_ACTOR,
  expectedVersion,
  occurredAt: OCCURRED_AT,
  organizationId: ORGANIZATION_A,
});

const requireNextLead = (result: LeadCommandResult | LeadCreationResult): Lead => {
  if (!result.ok) {
    throw new TypeError(`Expected a successful fixture transition: ${result.error.code}`);
  }
  return result.value.nextAggregate;
};

const createNewLead = (): Lead =>
  requireNextLead(
    createLead({
      actor: SYSTEM_ACTOR,
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
      leadId: LEAD_ID,
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    }),
  );

const stateFixtures = (): Readonly<Record<LeadStatus, Lead>> => {
  const newLead = createNewLead();
  const engaged = requireNextLead(
    recordEngagement(newLead, { ...commandContext(newLead), sourceMessage: SOURCE_MESSAGE }),
  );
  const qualified = requireNextLead(
    qualifyLead(engaged, { ...commandContext(engaged), qualification: QUALIFICATION }),
  );
  const disqualified = requireNextLead(
    disqualifyLead(newLead, {
      ...commandContext(newLead),
      qualification: QUALIFICATION,
      reasonCodes: [DISQUALIFICATION_REASON],
    }),
  );
  const bookingRequested = requireNextLead(
    recordAppointmentRequest(qualified, {
      ...commandContext(qualified),
      appointmentRequest: APPOINTMENT_REQUEST,
    }),
  );
  const converted = requireNextLead(
    convertLead(bookingRequested, {
      ...commandContext(bookingRequested),
      appointmentRequest: APPOINTMENT_REQUEST,
    }),
  );
  const closed = requireNextLead(
    closeLead(newLead, { ...commandContext(newLead), reasonCode: CLOSE_REASON }),
  );

  return Object.freeze({
    booking_requested: bookingRequested,
    closed,
    converted,
    disqualified,
    engaged,
    new: newLead,
    qualified,
  });
};

type ExpectedTransition = Readonly<{
  eventType: LeadEventDraft["event_type"];
  payload: (lead: Lead) => unknown;
  toStatus: LeadStatus;
}>;

type ExistingCommandCase = Readonly<{
  name: ExistingLeadCommandName;
  run: (lead: Lead, expectedVersion?: AggregateVersion) => LeadCommandResult;
  successes: Partial<Record<LeadStatus, ExpectedTransition>>;
}>;

const COMMAND_CASES = [
  {
    name: "record_engagement",
    run: (lead: Lead, expectedVersion = lead.version) =>
      recordEngagement(lead, {
        ...commandContext(lead, expectedVersion),
        sourceMessage: SOURCE_MESSAGE,
      }),
    successes: {
      new: {
        eventType: "lead.engaged",
        payload: () => ({ lead_status: "engaged", source_message_id: MESSAGE_ID }),
        toStatus: "engaged",
      },
    },
  },
  {
    name: "disqualify_lead",
    run: (lead: Lead, expectedVersion = lead.version) =>
      disqualifyLead(lead, {
        ...commandContext(lead, expectedVersion),
        qualification: QUALIFICATION,
        reasonCodes: [DISQUALIFICATION_REASON],
      }),
    successes: Object.fromEntries(
      (["new", "engaged"] as const).map((status) => [
        status,
        {
          eventType: "lead.disqualified",
          payload: () => ({
            lead_status: "disqualified",
            policy_id: POLICY_ID,
            qualification_evaluation_id: EVALUATION_ID,
            reason_codes: [DISQUALIFICATION_REASON],
          }),
          toStatus: "disqualified",
        },
      ]),
    ),
  },
  {
    name: "qualify_lead",
    run: (lead: Lead, expectedVersion = lead.version) =>
      qualifyLead(lead, {
        ...commandContext(lead, expectedVersion),
        qualification: QUALIFICATION,
      }),
    successes: {
      engaged: {
        eventType: "lead.qualified",
        payload: () => ({
          lead_status: "qualified",
          policy_id: POLICY_ID,
          qualification_evaluation_id: EVALUATION_ID,
        }),
        toStatus: "qualified",
      },
    },
  },
  {
    name: "reopen_disqualified_lead",
    run: (lead: Lead, expectedVersion = lead.version) =>
      reopenDisqualifiedLead(lead, {
        ...commandContext(lead, expectedVersion),
        reasonCode: REOPEN_REASON,
      }),
    successes: {
      disqualified: {
        eventType: "lead.reopened",
        payload: () => ({
          lead_status: "engaged",
          previous_lead_status: "disqualified",
          reason_code: REOPEN_REASON,
        }),
        toStatus: "engaged",
      },
    },
  },
  {
    name: "record_appointment_request",
    run: (lead: Lead, expectedVersion = lead.version) =>
      recordAppointmentRequest(lead, {
        ...commandContext(lead, expectedVersion),
        appointmentRequest: APPOINTMENT_REQUEST,
      }),
    successes: {
      qualified: {
        eventType: "lead.booking_requested",
        payload: () => ({
          appointment_request_id: APPOINTMENT_REQUEST_ID,
          lead_status: "booking_requested",
        }),
        toStatus: "booking_requested",
      },
    },
  },
  {
    name: "restore_after_appointment_request",
    run: (lead: Lead, expectedVersion = lead.version) =>
      restoreAfterAppointmentRequest(lead, {
        ...commandContext(lead, expectedVersion),
        appointmentRequest: APPOINTMENT_REQUEST,
        reasonCode: RESTORE_REASON,
      }),
    successes: {
      booking_requested: {
        eventType: "lead.reopened",
        payload: () => ({
          appointment_request_id: APPOINTMENT_REQUEST_ID,
          lead_status: "qualified",
          previous_lead_status: "booking_requested",
          reason_code: RESTORE_REASON,
        }),
        toStatus: "qualified",
      },
    },
  },
  {
    name: "convert_lead",
    run: (lead: Lead, expectedVersion = lead.version) =>
      convertLead(lead, {
        ...commandContext(lead, expectedVersion),
        appointmentRequest: APPOINTMENT_REQUEST,
      }),
    successes: {
      booking_requested: {
        eventType: "lead.converted",
        payload: () => ({
          appointment_request_id: APPOINTMENT_REQUEST_ID,
          lead_status: "converted",
        }),
        toStatus: "converted",
      },
    },
  },
  {
    name: "close_lead",
    run: (lead: Lead, expectedVersion = lead.version) =>
      closeLead(lead, {
        ...commandContext(lead, expectedVersion),
        reasonCode: CLOSE_REASON,
      }),
    successes: Object.fromEntries(
      (["new", "engaged", "qualified", "booking_requested"] as const).map((status) => [
        status,
        {
          eventType: "lead.closed",
          payload: (lead: Lead) => ({
            lead_status: "closed",
            previous_lead_status: lead.status,
            reason_code: CLOSE_REASON,
          }),
          toStatus: "closed",
        },
      ]),
    ),
  },
] as const satisfies readonly ExistingCommandCase[];

const MATRIX_CASES = LEAD_STATUSES.flatMap((status) =>
  COMMAND_CASES.map((command) => ({ command, status })),
);

const expectedTransitionFor = (
  command: ExistingCommandCase,
  status: LeadStatus,
): ExpectedTransition | undefined => command.successes[status];

const LEGAL_CASES = MATRIX_CASES.filter(
  ({ command, status }) => expectedTransitionFor(command, status) !== undefined,
);

const INVALID_CASES = MATRIX_CASES.filter(
  ({ command, status }) => expectedTransitionFor(command, status) === undefined,
);

const eventEnvelope = (lead: Lead, draft: LeadEventDraft): Record<string, unknown> => ({
  actor: SYSTEM_ACTOR,
  aggregate_id: lead.leadId,
  aggregate_type: "lead",
  aggregate_version: draft.aggregate_version,
  causation_id: null,
  correlation_id: CORRELATION_ID,
  event_id: EVENT_ID,
  event_type: draft.event_type,
  occurred_at: OCCURRED_AT,
  organization_id: lead.organizationId,
  payload: draft.payload,
  request_id: null,
  schema_id: draft.schema_id,
  schema_version: draft.schema_version,
});

const expectCanonicalDraft = (lead: Lead, draft: LeadEventDraft): void => {
  const envelope = eventEnvelope(lead, draft);

  if (draft.event_type === "lead.reopened") {
    expect(isSchemaValue(LeadReopenedDomainEventPayloadV2Schema, draft.payload)).toBe(true);
    expect(isSchemaValue(LeadReopenedDomainEventV2Schema, envelope)).toBe(true);
    return;
  }

  expect(isSchemaValue(DomainEventPayloadSchemas[draft.event_type], draft.payload)).toBe(true);
  expect(isSchemaValue(DomainEventSchemas[draft.event_type], envelope)).toBe(true);
};

const expectFailureWithoutEffects = (
  lead: Lead,
  result: LeadCommandResult,
  expectedError: unknown,
): void => {
  const before = JSON.stringify(lead);

  expect(result).toEqual({ error: expectedError, ok: false });
  expect(result).not.toHaveProperty("value");
  expect(result).not.toHaveProperty("events");
  expect(result).not.toHaveProperty("transitionRecords");
  expect(JSON.stringify(lead)).toBe(before);
};

describe("Lead creation", () => {
  it("creates exactly one immutable new Lead, canonical event draft, and transition record", () => {
    const contact = { contactId: CONTACT_ID, organizationId: ORGANIZATION_A };
    const result = createLead({
      actor: SYSTEM_ACTOR,
      contact,
      leadId: LEAD_ID,
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nextAggregate).toEqual({
      appointmentRequestId: null,
      contactId: CONTACT_ID,
      leadId: LEAD_ID,
      organizationId: ORGANIZATION_A,
      qualification: null,
      status: "new",
      version: 1,
    });
    expect(result.value.events).toEqual([
      {
        aggregate_version: 1,
        event_type: "lead.created",
        payload: { contact_id: CONTACT_ID, lead_status: "new" },
        schema_id: "LeadCreatedDomainEvent.v1",
        schema_version: "1",
      },
    ]);
    expect(result.value.transitionRecords).toEqual([
      {
        actor: SYSTEM_ACTOR,
        appointmentRequestId: null,
        command: "create_lead",
        fromStatus: null,
        leadId: LEAD_ID,
        occurredAt: OCCURRED_AT,
        organizationId: ORGANIZATION_A,
        policyId: null,
        qualificationEvaluationId: null,
        reasonCodes: [],
        sourceMessageId: null,
        toStatus: "new",
        version: 1,
      },
    ]);
    expectCanonicalDraft(result.value.nextAggregate, result.value.events[0]!);
    expect(Object.isFrozen(result.value.nextAggregate)).toBe(true);
    expect(Object.isFrozen(result.value.events)).toBe(true);
    expect(Object.isFrozen(result.value.events[0]?.payload)).toBe(true);
    expect(Object.isFrozen(result.value.transitionRecords[0])).toBe(true);
    expect(result.value.nextAggregate).not.toHaveProperty("pendingEvents");
    expect(result.value.nextAggregate).not.toHaveProperty("events");

    contact.contactId = OTHER_CONTACT_ID;
    expect(result.value.nextAggregate.contactId).toBe(CONTACT_ID);
    expect(result.value.events[0]?.payload).toEqual({
      contact_id: CONTACT_ID,
      lead_status: "new",
    });
  });

  it.each([
    {
      actor: SYSTEM_ACTOR,
      contact: { contactId: "not-a-uuid", organizationId: ORGANIZATION_A },
      leadId: LEAD_ID,
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    },
    {
      actor: { actor_id: null, actor_type: "model" },
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
      leadId: LEAD_ID,
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    },
    {
      actor: SYSTEM_ACTOR,
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
      leadId: "not-a-uuid",
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    },
    {
      actor: SYSTEM_ACTOR,
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
      leadId: LEAD_ID,
      occurredAt: "2026-09-01T17:00:00+05:00",
      organizationId: ORGANIZATION_A,
    },
  ])("rejects malformed creation input without a state or event %#", (candidate) => {
    const result: unknown = Reflect.apply(createLead, undefined, [candidate]);

    expect(result).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reference" },
      ok: false,
    });
    expect(result).not.toHaveProperty("value");
  });

  it("rejects a cross-organization contact reference without exposing either tenant", () => {
    const result = createLead({
      actor: SYSTEM_ACTOR,
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_B },
      leadId: LEAD_ID,
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    });

    expect(result).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
  });
});

describe("exhaustive Lead state by command matrix", () => {
  it("covers exactly seven states, eight existing-transition commands, twelve legal edges, and forty-four invalid pairs", () => {
    expect(LEAD_STATUSES).toHaveLength(7);
    expect(COMMAND_CASES).toHaveLength(8);
    expect(MATRIX_CASES).toHaveLength(56);
    expect(LEGAL_CASES).toHaveLength(12);
    expect(INVALID_CASES).toHaveLength(44);
  });

  it.each(MATRIX_CASES)(
    "$status × $command.name has the exact accepted outcome",
    ({ command, status }) => {
      const lead = stateFixtures()[status];
      const before = JSON.stringify(lead);
      const result = command.run(lead);
      const expected = expectedTransitionFor(command, status);

      if (expected === undefined) {
        expectFailureWithoutEffects(lead, result, {
          code: "invalid_state_transition",
          command: command.name,
          currentState: status,
        });
        return;
      }

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.value.nextAggregate.status).toBe(expected.toStatus);
      expect(result.value.nextAggregate.version).toBe(lead.version + 1);
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]).toMatchObject({
        aggregate_version: lead.version + 1,
        event_type: expected.eventType,
        payload: expected.payload(lead),
        schema_version: expected.eventType === "lead.reopened" ? "2" : "1",
      });
      expect(result.value.transitionRecords).toHaveLength(1);
      expect(result.value.transitionRecords[0]).toMatchObject({
        command: command.name,
        fromStatus: status,
        toStatus: expected.toStatus,
        version: lead.version + 1,
      });
      expectCanonicalDraft(result.value.nextAggregate, result.value.events[0]!);
      expect(JSON.stringify(lead)).toBe(before);
      expect(result.value.nextAggregate).not.toBe(lead);
    },
  );
});

describe("Lead version and concurrency semantics", () => {
  it.each(LEGAL_CASES)(
    "$status → $command.successes uses the exact expected version and rejects every wrong valid version",
    ({ command, status }) => {
      const lead = stateFixtures()[status];
      const wrongVersions = [lead.version + 1];
      if (lead.version > 1) {
        wrongVersions.unshift(lead.version - 1);
      }

      for (const wrongVersion of wrongVersions) {
        const result = command.run(lead, wrongVersion);
        expectFailureWithoutEffects(lead, result, {
          code: "concurrency_conflict",
          currentVersion: lead.version,
        });
      }

      const success = command.run(lead, lead.version);
      expect(success.ok).toBe(true);
      if (success.ok) {
        expect(success.value.nextAggregate.version).toBe(lead.version + 1);
        expect(success.value.events[0]?.aggregate_version).toBe(lead.version + 1);
        expect(success.value.transitionRecords[0]?.version).toBe(lead.version + 1);
      }
    },
  );

  it("rejects version overflow without exposing next state, event, or transition record", () => {
    const lead = createNewLead();
    const maximumVersionLead: Lead = Object.freeze({
      ...lead,
      version: Number.MAX_SAFE_INTEGER,
    });
    const result = recordEngagement(maximumVersionLead, {
      ...commandContext(maximumVersionLead),
      sourceMessage: SOURCE_MESSAGE,
    });

    expectFailureWithoutEffects(maximumVersionLead, result, {
      code: "invariant_violation",
      reason: "version_overflow",
    });
  });
});

describe("Lead reopen V2 and appointment linkage", () => {
  it("emits only the exact V2 disqualified-to-engaged variant and preserves prior evidence", () => {
    const disqualified = stateFixtures().disqualified;
    const result = reopenDisqualifiedLead(disqualified, {
      ...commandContext(disqualified),
      reasonCode: REOPEN_REASON,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const draft = result.value.events[0]!;
    expect(draft).toEqual({
      aggregate_version: disqualified.version + 1,
      event_type: "lead.reopened",
      payload: {
        lead_status: "engaged",
        previous_lead_status: "disqualified",
        reason_code: REOPEN_REASON,
      },
      schema_id: "LeadReopenedDomainEvent.v2",
      schema_version: "2",
    });
    expect(result.value.nextAggregate.qualification).toEqual(disqualified.qualification);
    expect(isSchemaValue(LeadReopenedDomainEventV2Schema, eventEnvelope(disqualified, draft))).toBe(
      true,
    );
    expect(
      isSchemaValue(DomainEventSchemas["lead.reopened"], eventEnvelope(disqualified, draft)),
    ).toBe(false);
  });

  it("emits only the exact V2 booking-requested-to-qualified variant and clears active linkage", () => {
    const bookingRequested = stateFixtures().booking_requested;
    const result = restoreAfterAppointmentRequest(bookingRequested, {
      ...commandContext(bookingRequested),
      appointmentRequest: APPOINTMENT_REQUEST,
      reasonCode: RESTORE_REASON,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const draft = result.value.events[0]!;
    expect(draft).toEqual({
      aggregate_version: bookingRequested.version + 1,
      event_type: "lead.reopened",
      payload: {
        appointment_request_id: APPOINTMENT_REQUEST_ID,
        lead_status: "qualified",
        previous_lead_status: "booking_requested",
        reason_code: RESTORE_REASON,
      },
      schema_id: "LeadReopenedDomainEvent.v2",
      schema_version: "2",
    });
    expect(result.value.nextAggregate.appointmentRequestId).toBeNull();
    expect(
      isSchemaValue(LeadReopenedDomainEventV2Schema, eventEnvelope(bookingRequested, draft)),
    ).toBe(true);
    expect(
      isSchemaValue(DomainEventSchemas["lead.reopened"], eventEnvelope(bookingRequested, draft)),
    ).toBe(false);
  });

  it.each([
    [
      "restore",
      (lead: Lead) =>
        restoreAfterAppointmentRequest(lead, {
          ...commandContext(lead),
          appointmentRequest: {
            appointmentRequestId: OTHER_APPOINTMENT_REQUEST_ID,
            organizationId: ORGANIZATION_A,
          },
          reasonCode: RESTORE_REASON,
        }),
    ],
    [
      "convert",
      (lead: Lead) =>
        convertLead(lead, {
          ...commandContext(lead),
          appointmentRequest: {
            appointmentRequestId: OTHER_APPOINTMENT_REQUEST_ID,
            organizationId: ORGANIZATION_A,
          },
        }),
    ],
  ] as const)("rejects mismatched appointment linkage for %s", (_name, invoke) => {
    const lead = stateFixtures().booking_requested;
    const result = invoke(lead);

    expectFailureWithoutEffects(lead, result, {
      code: "invariant_violation",
      reason: "invalid_reference",
    });
  });

  it("keeps canonical appointment linkage through conversion without implementing booking behavior", () => {
    const bookingRequested = stateFixtures().booking_requested;
    const result = convertLead(bookingRequested, {
      ...commandContext(bookingRequested),
      appointmentRequest: APPOINTMENT_REQUEST,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextAggregate.appointmentRequestId).toBe(APPOINTMENT_REQUEST_ID);
      expect(Object.keys(result.value.nextAggregate).sort()).toEqual([
        "appointmentRequestId",
        "contactId",
        "leadId",
        "organizationId",
        "qualification",
        "status",
        "version",
      ]);
    }
  });
});

describe("Lead terminal and replay-like behavior", () => {
  it.each(["converted", "closed"] as const)(
    "rejects every command from terminal state %s",
    (status) => {
      const lead = stateFixtures()[status];

      for (const command of COMMAND_CASES) {
        expectFailureWithoutEffects(lead, command.run(lead), {
          code: "invalid_state_transition",
          command: command.name,
          currentState: status,
        });
      }
    },
  );

  it.each([
    ["engage already engaged", "engaged", COMMAND_CASES[0]],
    ["qualify already qualified", "qualified", COMMAND_CASES[2]],
    ["request already recorded", "booking_requested", COMMAND_CASES[4]],
    ["convert already converted", "converted", COMMAND_CASES[6]],
    ["close already closed", "closed", COMMAND_CASES[7]],
    ["reopen an engaged Lead", "engaged", COMMAND_CASES[3]],
  ] as const)("rejects replay-like command: %s", (_label, status, command) => {
    const lead = stateFixtures()[status];
    expectFailureWithoutEffects(lead, command.run(lead), {
      code: "invalid_state_transition",
      command: command.name,
      currentState: status,
    });
  });
});

describe("Lead qualification, reasons, and tenant-safe references", () => {
  it("stores only validated policy/evaluation evidence and bounded outcome facts", () => {
    const engaged = stateFixtures().engaged;
    const result = qualifyLead(engaged, {
      ...commandContext(engaged),
      qualification: QUALIFICATION,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextAggregate.qualification).toEqual({
        evaluationId: EVALUATION_ID,
        policyId: POLICY_ID,
        reasonCodes: [],
        result: "qualified",
      });
      expect(JSON.stringify(result.value)).not.toContain("confidence");
      expect(JSON.stringify(result.value)).not.toContain("prompt");
      expect(JSON.stringify(result.value)).not.toContain("reasoning");
      expect(JSON.stringify(result.value)).not.toContain("tool");
    }
  });

  it.each([
    "",
    "UPPERCASE",
    "contains-hyphen",
    "contains space",
    "raw_customer_text\n",
    "r".repeat(101),
  ])("rejects noncanonical reason input without echoing it %j", (candidate) => {
    const result = validateLeadReasonCode(candidate);

    expect(result).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reason_code" },
      ok: false,
    });
    if (candidate.length > 0) {
      expect(JSON.stringify(result)).not.toContain(candidate);
    }
  });

  it.each([
    [],
    [DISQUALIFICATION_REASON, DISQUALIFICATION_REASON],
    Array.from({ length: 17 }, (_, index) => requireReasonCode(`reason_${index}`)),
  ])("rejects an invalid disqualification reason set %#", (reasonCodes) => {
    const lead = createNewLead();
    const candidate = {
      ...commandContext(lead),
      qualification: QUALIFICATION,
      reasonCodes,
    };
    const result: unknown = Reflect.apply(disqualifyLead, undefined, [lead, candidate]);

    expect(result).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reason_code" },
      ok: false,
    });
    expect(JSON.stringify(lead)).toBe(JSON.stringify(createNewLead()));
  });

  it("deep-copies qualification reasons so caller mutation cannot alter state, events, or records", () => {
    const lead = createNewLead();
    const reasons = [DISQUALIFICATION_REASON];
    const result = disqualifyLead(lead, {
      ...commandContext(lead),
      qualification: QUALIFICATION,
      reasonCodes: reasons,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    reasons.push(requireReasonCode("another_reason"));
    expect(result.value.nextAggregate.qualification?.reasonCodes).toEqual([
      DISQUALIFICATION_REASON,
    ]);
    expect(result.value.events[0]?.payload).toMatchObject({
      reason_codes: [DISQUALIFICATION_REASON],
    });
    expect(result.value.transitionRecords[0]?.reasonCodes).toEqual([DISQUALIFICATION_REASON]);
    expect(Object.isFrozen(result.value.nextAggregate.qualification?.reasonCodes)).toBe(true);
  });

  it("returns QualificationIncomplete for malformed policy/evaluation evidence", () => {
    const engaged = stateFixtures().engaged;
    const candidate = {
      ...commandContext(engaged),
      qualification: {
        evaluationId: "not-a-uuid",
        organizationId: ORGANIZATION_A,
        policyId: POLICY_ID,
      },
    };
    const result: unknown = Reflect.apply(qualifyLead, undefined, [engaged, candidate]);

    expect(result).toEqual({ error: { code: "qualification_incomplete" }, ok: false });
    expect(result).not.toHaveProperty("value");
  });

  it.each([
    [
      "command context",
      (lead: Lead) =>
        closeLead(lead, {
          ...commandContext(lead),
          organizationId: ORGANIZATION_B,
          reasonCode: CLOSE_REASON,
        }),
    ],
    [
      "message",
      (lead: Lead) =>
        recordEngagement(lead, {
          ...commandContext(lead),
          sourceMessage: { messageId: MESSAGE_ID, organizationId: ORGANIZATION_B },
        }),
    ],
    [
      "qualification",
      (lead: Lead) =>
        qualifyLead(lead, {
          ...commandContext(lead),
          qualification: { ...QUALIFICATION, organizationId: ORGANIZATION_B },
        }),
    ],
    [
      "appointment request",
      (lead: Lead) =>
        recordAppointmentRequest(lead, {
          ...commandContext(lead),
          appointmentRequest: {
            appointmentRequestId: APPOINTMENT_REQUEST_ID,
            organizationId: ORGANIZATION_B,
          },
        }),
    ],
  ] as const)(
    "rejects a foreign-organization %s reference without identifier leakage",
    (kind, invoke) => {
      const lead =
        kind === "message"
          ? stateFixtures().new
          : kind === "qualification"
            ? stateFixtures().engaged
            : kind === "appointment request"
              ? stateFixtures().qualified
              : stateFixtures().new;
      const result = invoke(lead);

      expectFailureWithoutEffects(lead, result, { code: "tenant_scope_violation" });
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
    },
  );

  it("keeps nominal reference types distinct at compile time", () => {
    expectTypeOf<
      LeadAppointmentRequestReference["appointmentRequestId"]
    >().toEqualTypeOf<AppointmentRequestId>();
    expectTypeOf<
      LeadAppointmentRequestReference["appointmentRequestId"]
    >().not.toEqualTypeOf<ContactId>();
    expectTypeOf<LeadMessageReference["messageId"]>().toEqualTypeOf<MessageId>();
    expectTypeOf<LeadMessageReference["messageId"]>().not.toEqualTypeOf<LeadId>();
    expect(isSchemaValue(ActorRefSchema, SYSTEM_ACTOR)).toBe(true);
  });
});
