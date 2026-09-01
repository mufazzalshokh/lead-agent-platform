import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ActorRefSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  DomainEventPayloadSchemas,
  DomainEventSchemas,
  EventIdSchema,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type ConversationId,
  type CorrelationId,
  type EventId,
  type HandoffId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import {
  assignHandoff,
  cancelHandoff,
  claimAndStartHandoff,
  expireHandoff,
  isActiveHandoffStatus,
  isTerminalHandoffStatus,
  reassignHandoff,
  requestHandoff,
  resolveHandoff,
  startHandoff,
  validateHandoff,
  validateHandoffQueueKey,
  validateHandoffReasonCode,
  validateHandoffResolutionCode,
  type CreateHandoffCommand,
  type ExistingHandoffCommandName,
  type Handoff,
  type HandoffAssigneeReference,
  type HandoffCommandContext,
  type HandoffCommandResult,
  type HandoffConversationReference,
  type HandoffCreationResult,
  type HandoffEventDraft,
  type HandoffLeadReference,
  type HandoffLocationReference,
  type HandoffQueueKey,
  type HandoffReasonCode,
  type HandoffResolutionCode,
  type HandoffStatus,
  type HandoffTriggerReason,
} from "../../packages/domain/src/index.js";

const requireOrganizationId = (value: string): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, value)) {
    throw new TypeError("Invalid organization fixture");
  }
  return value;
};

const requireConversationId = (value: string): ConversationId => {
  if (!isSchemaValue(ConversationIdSchema, value)) {
    throw new TypeError("Invalid Conversation fixture");
  }
  return value;
};

const requireLeadId = (value: string): LeadId => {
  if (!isSchemaValue(LeadIdSchema, value)) {
    throw new TypeError("Invalid Lead fixture");
  }
  return value;
};

const requireHandoffId = (value: string): HandoffId => {
  if (!isSchemaValue(HandoffIdSchema, value)) {
    throw new TypeError("Invalid Handoff fixture");
  }
  return value;
};

const requireMembershipId = (value: string): MembershipId => {
  if (!isSchemaValue(MembershipIdSchema, value)) {
    throw new TypeError("Invalid membership fixture");
  }
  return value;
};

const requireLocationId = (value: string): LocationId => {
  if (!isSchemaValue(LocationIdSchema, value)) {
    throw new TypeError("Invalid location fixture");
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
    throw new TypeError("Invalid timestamp fixture");
  }
  return value;
};

const requireActorRef = (value: unknown): ActorRef => {
  if (!isSchemaValue(ActorRefSchema, value)) {
    throw new TypeError("Invalid actor fixture");
  }
  return value;
};

const requireQueueKey = (value: string): HandoffQueueKey => {
  const result = validateHandoffQueueKey(value);
  if (!result.ok) {
    throw new TypeError("Invalid queue fixture");
  }
  return result.value;
};

const requireReasonCode = (value: string): HandoffReasonCode => {
  const result = validateHandoffReasonCode(value);
  if (!result.ok) {
    throw new TypeError("Invalid reason fixture");
  }
  return result.value;
};

const requireResolutionCode = (value: string): HandoffResolutionCode => {
  const result = validateHandoffResolutionCode(value);
  if (!result.ok) {
    throw new TypeError("Invalid resolution fixture");
  }
  return result.value;
};

const ORGANIZATION_A = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c42d01");
const ORGANIZATION_B = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c42d02");
const CONVERSATION_ID = requireConversationId("0193f1a8-7f65-7c28-a434-a10796c42d03");
const LEAD_ID = requireLeadId("0193f1a8-7f65-7c28-a434-a10796c42d04");
const HANDOFF_ID = requireHandoffId("0193f1a8-7f65-7c28-a434-a10796c42d05");
const LOCATION_ID = requireLocationId("0193f1a8-7f65-7c28-a434-a10796c42d06");
const ASSIGNEE_A_ID = requireMembershipId("0193f1a8-7f65-7c28-a434-a10796c42d07");
const ASSIGNEE_B_ID = requireMembershipId("0193f1a8-7f65-7c28-a434-a10796c42d08");
const EVENT_ID = requireEventId("0193f1a8-7f65-7c28-a434-a10796c42d09");
const CORRELATION_ID = requireCorrelationId("0193f1a8-7f65-7c28-a434-a10796c42d0a");

const REQUESTED_AT = requireUtcTimestamp("2026-09-01T10:00:00Z");
const ASSIGNED_AT = requireUtcTimestamp("2026-09-01T10:05:00Z");
const STARTED_AT = requireUtcTimestamp("2026-09-01T10:10:00Z");
const RESOLVED_AT = requireUtcTimestamp("2026-09-01T10:15:00Z");
const COMMAND_AT = requireUtcTimestamp("2026-09-01T10:20:00Z");
const SLA_DUE_AT = requireUtcTimestamp("2026-09-01T10:30:00Z");
const AFTER_SLA_AT = requireUtcTimestamp("2026-09-01T10:31:00Z");
const BEFORE_REQUEST_AT = requireUtcTimestamp("2026-09-01T09:59:59Z");

const QUEUE_KEY = requireQueueKey("clinic_front_desk");
const CANCEL_REASON = requireReasonCode("customer_withdrew");
const EXPIRE_REASON = requireReasonCode("sla_elapsed");
const RESOLUTION_CODE = requireResolutionCode("answered_by_staff");

const SYSTEM_ACTOR = requireActorRef({ actor_id: null, actor_type: "system" });
const MEMBER_ACTOR = requireActorRef({
  actor_id: ASSIGNEE_A_ID,
  actor_type: "member",
});

const CONVERSATION = Object.freeze({
  conversationId: CONVERSATION_ID,
  organizationId: ORGANIZATION_A,
} satisfies HandoffConversationReference);

const LEAD = Object.freeze({
  leadId: LEAD_ID,
  organizationId: ORGANIZATION_A,
} satisfies HandoffLeadReference);

const LOCATION = Object.freeze({
  locationId: LOCATION_ID,
  organizationId: ORGANIZATION_A,
} satisfies HandoffLocationReference);

const ASSIGNEE_A = Object.freeze({
  membershipId: ASSIGNEE_A_ID,
  organizationId: ORGANIZATION_A,
} satisfies HandoffAssigneeReference);

const ASSIGNEE_B = Object.freeze({
  membershipId: ASSIGNEE_B_ID,
  organizationId: ORGANIZATION_A,
} satisfies HandoffAssigneeReference);

const HANDOFF_STATUSES = [
  "requested",
  "assigned",
  "in_progress",
  "resolved",
  "cancelled",
  "expired",
] as const satisfies readonly HandoffStatus[];

const TRIGGER_REASONS = [
  "customer_requested",
  "missing_authoritative_information",
  "medical_or_safety",
  "low_confidence",
  "policy_blocked",
  "ai_unavailable",
  "delivery_problem",
  "staff_created",
  "other",
] as const satisfies readonly HandoffTriggerReason[];

const createCommand = (changes: Partial<CreateHandoffCommand> = {}): CreateHandoffCommand => ({
  actor: SYSTEM_ACTOR,
  conversation: CONVERSATION,
  handoffId: HANDOFF_ID,
  lead: LEAD,
  location: LOCATION,
  occurredAt: REQUESTED_AT,
  organizationId: ORGANIZATION_A,
  queueKey: QUEUE_KEY,
  slaDueAt: SLA_DUE_AT,
  triggerReason: "customer_requested",
  ...changes,
});

const commandContext = (
  handoff: Handoff,
  occurredAt: UtcTimestamp = COMMAND_AT,
  expectedVersion: AggregateVersion = handoff.version,
  actor: ActorRef = SYSTEM_ACTOR,
): HandoffCommandContext => ({
  actor,
  expectedVersion,
  occurredAt,
  organizationId: ORGANIZATION_A,
});

const requireNextHandoff = (result: HandoffCommandResult | HandoffCreationResult): Handoff => {
  if (!result.ok) {
    throw new TypeError(`Expected successful fixture transition: ${result.error.code}`);
  }
  return result.value.nextAggregate;
};

const createRequestedHandoff = (): Handoff => requireNextHandoff(requestHandoff(createCommand()));

const stateFixtures = (): Readonly<Record<HandoffStatus, Handoff>> => {
  const requested = createRequestedHandoff();
  const assigned = requireNextHandoff(
    assignHandoff(requested, {
      ...commandContext(requested, ASSIGNED_AT),
      assignee: ASSIGNEE_A,
    }),
  );
  const inProgress = requireNextHandoff(
    startHandoff(assigned, {
      ...commandContext(assigned, STARTED_AT),
      starter: ASSIGNEE_A,
    }),
  );
  const resolved = requireNextHandoff(
    resolveHandoff(inProgress, {
      ...commandContext(inProgress, RESOLVED_AT, inProgress.version, MEMBER_ACTOR),
      resolutionCode: RESOLUTION_CODE,
    }),
  );
  const cancelled = requireNextHandoff(
    cancelHandoff(requested, {
      ...commandContext(requested, RESOLVED_AT),
      reasonCode: CANCEL_REASON,
    }),
  );
  const expired = requireNextHandoff(
    expireHandoff(requested, {
      actor: SYSTEM_ACTOR,
      expectedVersion: requested.version,
      now: SLA_DUE_AT,
      organizationId: ORGANIZATION_A,
      reasonCode: EXPIRE_REASON,
    }),
  );

  return Object.freeze({
    assigned,
    cancelled,
    expired,
    in_progress: inProgress,
    requested,
    resolved,
  });
};

type ExpectedTransition = Readonly<{
  eventTypes: readonly HandoffEventDraft["event_type"][];
  toStatus: HandoffStatus;
  versionIncrement: 1 | 2;
}>;

type ExistingCommandCase = Readonly<{
  name: ExistingHandoffCommandName;
  run: (handoff: Handoff, expectedVersion?: AggregateVersion) => HandoffCommandResult;
  successes: Partial<Record<HandoffStatus, ExpectedTransition>>;
}>;

const COMMAND_CASES = [
  {
    name: "assign_handoff",
    run: (handoff: Handoff, expectedVersion = handoff.version) =>
      assignHandoff(handoff, {
        ...commandContext(handoff, COMMAND_AT, expectedVersion),
        assignee: ASSIGNEE_A,
      }),
    successes: {
      requested: {
        eventTypes: ["handoff.assigned"],
        toStatus: "assigned",
        versionIncrement: 1,
      },
    },
  },
  {
    name: "claim_and_start_handoff",
    run: (handoff: Handoff, expectedVersion = handoff.version) =>
      claimAndStartHandoff(handoff, {
        ...commandContext(handoff, COMMAND_AT, expectedVersion),
        assignee: ASSIGNEE_A,
      }),
    successes: {
      requested: {
        eventTypes: ["handoff.assigned", "handoff.started"],
        toStatus: "in_progress",
        versionIncrement: 2,
      },
    },
  },
  {
    name: "reassign_handoff",
    run: (handoff: Handoff, expectedVersion = handoff.version) =>
      reassignHandoff(handoff, {
        ...commandContext(handoff, COMMAND_AT, expectedVersion),
        assignee: ASSIGNEE_B,
      }),
    successes: {
      assigned: {
        eventTypes: ["handoff.assigned"],
        toStatus: "assigned",
        versionIncrement: 1,
      },
    },
  },
  {
    name: "start_handoff",
    run: (handoff: Handoff, expectedVersion = handoff.version) =>
      startHandoff(handoff, {
        ...commandContext(handoff, COMMAND_AT, expectedVersion),
        starter: ASSIGNEE_A,
      }),
    successes: {
      assigned: {
        eventTypes: ["handoff.started"],
        toStatus: "in_progress",
        versionIncrement: 1,
      },
    },
  },
  {
    name: "resolve_handoff",
    run: (handoff: Handoff, expectedVersion = handoff.version) =>
      resolveHandoff(handoff, {
        ...commandContext(handoff, COMMAND_AT, expectedVersion, MEMBER_ACTOR),
        resolutionCode: RESOLUTION_CODE,
      }),
    successes: {
      in_progress: {
        eventTypes: ["handoff.resolved"],
        toStatus: "resolved",
        versionIncrement: 1,
      },
    },
  },
  {
    name: "cancel_handoff",
    run: (handoff: Handoff, expectedVersion = handoff.version) =>
      cancelHandoff(handoff, {
        ...commandContext(handoff, COMMAND_AT, expectedVersion),
        reasonCode: CANCEL_REASON,
      }),
    successes: Object.fromEntries(
      (["requested", "assigned", "in_progress"] as const).map((status) => [
        status,
        {
          eventTypes: ["handoff.cancelled"],
          toStatus: "cancelled",
          versionIncrement: 1,
        },
      ]),
    ),
  },
  {
    name: "expire_handoff",
    run: (handoff: Handoff, expectedVersion = handoff.version) =>
      expireHandoff(handoff, {
        actor: SYSTEM_ACTOR,
        expectedVersion,
        now: SLA_DUE_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: EXPIRE_REASON,
      }),
    successes: Object.fromEntries(
      (["requested", "assigned", "in_progress"] as const).map((status) => [
        status,
        {
          eventTypes: ["handoff.expired"],
          toStatus: "expired",
          versionIncrement: 1,
        },
      ]),
    ),
  },
] as const satisfies readonly ExistingCommandCase[];

const MATRIX_CASES = HANDOFF_STATUSES.flatMap((status) =>
  COMMAND_CASES.map((command) => ({ command, status })),
);

const expectedTransitionFor = (
  command: ExistingCommandCase,
  status: HandoffStatus,
): ExpectedTransition | undefined => command.successes[status];

const LEGAL_CASES = MATRIX_CASES.filter(
  ({ command, status }) => expectedTransitionFor(command, status) !== undefined,
);

const INVALID_CASES = MATRIX_CASES.filter(
  ({ command, status }) => expectedTransitionFor(command, status) === undefined,
);

const eventEnvelope = (handoff: Handoff, draft: HandoffEventDraft): Record<string, unknown> => ({
  actor: SYSTEM_ACTOR,
  aggregate_id: handoff.handoffId,
  aggregate_type: "handoff",
  aggregate_version: draft.aggregate_version,
  causation_id: null,
  correlation_id: CORRELATION_ID,
  event_id: EVENT_ID,
  event_type: draft.event_type,
  occurred_at: COMMAND_AT,
  organization_id: handoff.organizationId,
  payload: draft.payload,
  request_id: null,
  schema_id: draft.schema_id,
  schema_version: draft.schema_version,
});

const expectCanonicalDraft = (handoff: Handoff, draft: HandoffEventDraft): void => {
  expect(isSchemaValue(DomainEventPayloadSchemas[draft.event_type], draft.payload)).toBe(true);
  expect(isSchemaValue(DomainEventSchemas[draft.event_type], eventEnvelope(handoff, draft))).toBe(
    true,
  );
};

const expectFailureWithoutEffects = (
  handoff: Handoff,
  result: HandoffCommandResult,
  expectedError: unknown,
): void => {
  const before = JSON.stringify(handoff);

  expect(result).toEqual({ error: expectedError, ok: false });
  expect(result).not.toHaveProperty("value");
  expect(result).not.toHaveProperty("events");
  expect(result).not.toHaveProperty("transitionRecords");
  expect(JSON.stringify(handoff)).toBe(before);
};

describe("Handoff creation and canonical vocabulary", () => {
  it.each(TRIGGER_REASONS)("creates requested Handoff for trigger %s", (triggerReason) => {
    const result = requestHandoff(createCommand({ triggerReason }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nextAggregate).toEqual({
      assignedAt: null,
      assignedMembershipId: null,
      conversationId: CONVERSATION_ID,
      handoffId: HANDOFF_ID,
      leadId: LEAD_ID,
      locationId: LOCATION_ID,
      organizationId: ORGANIZATION_A,
      queueKey: QUEUE_KEY,
      requestedAt: REQUESTED_AT,
      resolutionCode: null,
      resolvedAt: null,
      slaDueAt: SLA_DUE_AT,
      startedAt: null,
      status: "requested",
      triggerReason,
      version: 1,
    });
    expect(result.value.events).toEqual([
      {
        aggregate_version: 1,
        event_type: "handoff.requested",
        payload: {
          conversation_id: CONVERSATION_ID,
          handoff_status: "requested",
          lead_id: LEAD_ID,
          trigger_reason: triggerReason,
        },
        schema_id: "HandoffRequestedDomainEvent.v1",
        schema_version: "1",
      },
    ]);
    expect(result.value.transitionRecords).toEqual([
      {
        actor: SYSTEM_ACTOR,
        command: "request_handoff",
        fromAssigneeMembershipId: null,
        fromStatus: null,
        handoffId: HANDOFF_ID,
        occurredAt: REQUESTED_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: null,
        toAssigneeMembershipId: null,
        toStatus: "requested",
        version: 1,
      },
    ]);
    expectCanonicalDraft(result.value.nextAggregate, result.value.events[0]!);
  });

  it("supports an organization-wide queue without a location", () => {
    const result = requestHandoff(createCommand({ location: null }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextAggregate.locationId).toBeNull();
    }
  });

  it.each(HANDOFF_STATUSES)("classifies %s activity and terminality exactly", (status) => {
    expect(isActiveHandoffStatus(status)).toBe(
      status === "requested" || status === "assigned" || status === "in_progress",
    );
    expect(isTerminalHandoffStatus(status)).toBe(
      status === "resolved" || status === "cancelled" || status === "expired",
    );
  });
});

describe("exhaustive Handoff state by command matrix", () => {
  it("covers six states, seven commands, eleven legal edges, and thirty-one invalid pairs", () => {
    expect(HANDOFF_STATUSES).toHaveLength(6);
    expect(COMMAND_CASES).toHaveLength(7);
    expect(MATRIX_CASES).toHaveLength(42);
    expect(LEGAL_CASES).toHaveLength(11);
    expect(INVALID_CASES).toHaveLength(31);
  });

  it.each(LEGAL_CASES)("allows $status → $command.name", ({ command, status }) => {
    const handoff = stateFixtures()[status];
    const expected = expectedTransitionFor(command, status)!;
    const result = command.run(handoff);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nextAggregate.status).toBe(expected.toStatus);
    expect(result.value.nextAggregate.version).toBe(handoff.version + expected.versionIncrement);
    expect(result.value.events.map((event) => event.event_type)).toEqual(expected.eventTypes);
    expect(result.value.transitionRecords).toHaveLength(expected.versionIncrement);
    result.value.events.forEach((event) => expectCanonicalDraft(handoff, event));
  });

  it.each(INVALID_CASES)("rejects $status → $command.name", ({ command, status }) => {
    const handoff = stateFixtures()[status];
    expectFailureWithoutEffects(handoff, command.run(handoff), {
      code: "invalid_state_transition",
      command: command.name,
      currentState: status,
    });
  });
});

describe("Handoff multi-edge claim/start and reassignment provenance", () => {
  it("records requested-to-assigned-to-in-progress as two ordered versioned edges", () => {
    const requested = createRequestedHandoff();
    const result = claimAndStartHandoff(requested, {
      ...commandContext(requested, ASSIGNED_AT),
      assignee: ASSIGNEE_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nextAggregate).toMatchObject({
      assignedAt: ASSIGNED_AT,
      assignedMembershipId: ASSIGNEE_A_ID,
      startedAt: ASSIGNED_AT,
      status: "in_progress",
      version: requested.version + 2,
    });
    expect(result.value.events.map((event) => [event.event_type, event.aggregate_version])).toEqual(
      [
        ["handoff.assigned", requested.version + 1],
        ["handoff.started", requested.version + 2],
      ],
    );
    expect(result.value.transitionRecords).toEqual([
      expect.objectContaining({
        fromAssigneeMembershipId: null,
        fromStatus: "requested",
        toAssigneeMembershipId: ASSIGNEE_A_ID,
        toStatus: "assigned",
        version: requested.version + 1,
      }),
      expect.objectContaining({
        fromAssigneeMembershipId: ASSIGNEE_A_ID,
        fromStatus: "assigned",
        toAssigneeMembershipId: ASSIGNEE_A_ID,
        toStatus: "in_progress",
        version: requested.version + 2,
      }),
    ]);
  });

  it("fails claim/start atomically when the second version would overflow", () => {
    const requested: Handoff = Object.freeze({
      ...createRequestedHandoff(),
      version: Number.MAX_SAFE_INTEGER - 1,
    });
    const result = claimAndStartHandoff(requested, {
      ...commandContext(requested, ASSIGNED_AT),
      assignee: ASSIGNEE_A,
    });

    expectFailureWithoutEffects(requested, result, {
      code: "invariant_violation",
      reason: "version_overflow",
    });
  });

  it("reassigns through a real assigned-to-assigned edge with both assignees in history", () => {
    const assigned = stateFixtures().assigned;
    const result = reassignHandoff(assigned, {
      ...commandContext(assigned, COMMAND_AT),
      assignee: ASSIGNEE_B,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nextAggregate).toMatchObject({
      assignedAt: COMMAND_AT,
      assignedMembershipId: ASSIGNEE_B_ID,
      status: "assigned",
      version: assigned.version + 1,
    });
    expect(result.value.events[0]).toEqual({
      aggregate_version: assigned.version + 1,
      event_type: "handoff.assigned",
      payload: {
        assignee_membership_id: ASSIGNEE_B_ID,
        handoff_status: "assigned",
      },
      schema_id: "HandoffAssignedDomainEvent.v1",
      schema_version: "1",
    });
    expect(result.value.transitionRecords[0]).toMatchObject({
      fromAssigneeMembershipId: ASSIGNEE_A_ID,
      fromStatus: "assigned",
      toAssigneeMembershipId: ASSIGNEE_B_ID,
      toStatus: "assigned",
    });
  });

  it("rejects same-assignee reassignment without a false version or event", () => {
    const assigned = stateFixtures().assigned;
    expectFailureWithoutEffects(
      assigned,
      reassignHandoff(assigned, {
        ...commandContext(assigned),
        assignee: ASSIGNEE_A,
      }),
      { code: "invariant_violation", reason: "invalid_reference" },
    );
  });

  it("starts only when the starter is the current assignee", () => {
    const assigned = stateFixtures().assigned;
    expectFailureWithoutEffects(
      assigned,
      startHandoff(assigned, {
        ...commandContext(assigned),
        starter: ASSIGNEE_B,
      }),
      { code: "invariant_violation", reason: "invalid_reference" },
    );
  });
});

describe("Handoff and Conversation boundary", () => {
  it("terminalizes the Handoff without choosing a Conversation disposition", () => {
    const handoff = stateFixtures().in_progress;
    const result = resolveHandoff(handoff, {
      ...commandContext(handoff, COMMAND_AT, handoff.version, MEMBER_ACTOR),
      resolutionCode: RESOLUTION_CODE,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transitionRecords[0]).toMatchObject({
        reasonCode: RESOLUTION_CODE,
        toStatus: "resolved",
      });
      expect(result.value.transitionRecords[0]).not.toHaveProperty("conversationDisposition");
      expect(result.value.events.map((event) => event.event_type)).toEqual(["handoff.resolved"]);
    }
  });

  it("never mutates a Conversation or emits a Conversation event", () => {
    const conversationSnapshot = Object.freeze({
      automationMode: "staff",
      conversationId: CONVERSATION_ID,
      status: "awaiting_staff",
    });
    const before = JSON.stringify(conversationSnapshot);
    const handoff = stateFixtures().in_progress;
    const result = resolveHandoff(handoff, {
      ...commandContext(handoff, COMMAND_AT, handoff.version, MEMBER_ACTOR),
      resolutionCode: RESOLUTION_CODE,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(conversationSnapshot)).toBe(before);
    if (result.ok) {
      expect(result.value.nextAggregate).not.toHaveProperty("conversationStatus");
      expect(result.value.events.every((event) => event.event_type.startsWith("handoff."))).toBe(
        true,
      );
    }
  });
});

describe("Handoff expiry clock semantics", () => {
  it("rejects expiry immediately before SLA due time", () => {
    const handoff = createRequestedHandoff();
    expectFailureWithoutEffects(
      handoff,
      expireHandoff(handoff, {
        actor: SYSTEM_ACTOR,
        expectedVersion: handoff.version,
        now: COMMAND_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: EXPIRE_REASON,
      }),
      { code: "invariant_violation", reason: "handoff_not_due" },
    );
  });

  it.each([SLA_DUE_AT, AFTER_SLA_AT])("allows deterministic expiry at %s", (now) => {
    const handoff = createRequestedHandoff();
    const result = expireHandoff(handoff, {
      actor: SYSTEM_ACTOR,
      expectedVersion: handoff.version,
      now,
      organizationId: ORGANIZATION_A,
      reasonCode: EXPIRE_REASON,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextAggregate.status).toBe("expired");
      expect(result.value.transitionRecords[0]?.occurredAt).toBe(now);
    }
  });

  it("requires deterministic system attribution for expiry", () => {
    const handoff = createRequestedHandoff();
    expectFailureWithoutEffects(
      handoff,
      expireHandoff(handoff, {
        actor: MEMBER_ACTOR,
        expectedVersion: handoff.version,
        now: SLA_DUE_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: EXPIRE_REASON,
      }),
      { code: "invariant_violation", reason: "invalid_reference" },
    );
  });
});

describe("Handoff version, terminal, and replay behavior", () => {
  it.each(LEGAL_CASES)(
    "$status → $command.name rejects stale version and advances by its exact edge count",
    ({ command, status }) => {
      const handoff = stateFixtures()[status];
      const expected = expectedTransitionFor(command, status)!;
      const staleVersion = handoff.version === 1 ? handoff.version + 1 : handoff.version - 1;

      expectFailureWithoutEffects(handoff, command.run(handoff, staleVersion), {
        code: "concurrency_conflict",
        currentVersion: handoff.version,
      });

      const result = command.run(handoff, handoff.version);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextAggregate.version).toBe(
          handoff.version + expected.versionIncrement,
        );
        expect(result.value.events.map((event) => event.aggregate_version)).toEqual(
          expected.versionIncrement === 2
            ? [handoff.version + 1, handoff.version + 2]
            : [handoff.version + 1],
        );
      }
    },
  );

  it("rejects single-edge version overflow without effects", () => {
    const requested: Handoff = Object.freeze({
      ...createRequestedHandoff(),
      version: Number.MAX_SAFE_INTEGER,
    });
    expectFailureWithoutEffects(
      requested,
      assignHandoff(requested, {
        ...commandContext(requested),
        assignee: ASSIGNEE_A,
      }),
      { code: "invariant_violation", reason: "version_overflow" },
    );
  });

  it.each(["resolved", "cancelled", "expired"] as const)(
    "keeps %s terminal against all seven commands",
    (status) => {
      const handoff = stateFixtures()[status];

      for (const command of COMMAND_CASES) {
        expectFailureWithoutEffects(handoff, command.run(handoff), {
          code: "invalid_state_transition",
          command: command.name,
          currentState: status,
        });
      }
    },
  );
});

describe("Handoff aggregate invariants and input validation", () => {
  it.each([
    { assignedAt: ASSIGNED_AT, status: "requested" },
    { assignedMembershipId: null, status: "assigned" },
    { startedAt: null, status: "in_progress" },
    { resolutionCode: null, status: "resolved" },
    { resolvedAt: RESOLVED_AT, status: "cancelled" },
    { resolutionCode: RESOLUTION_CODE, status: "expired" },
  ] as const)("rejects impossible lifecycle shape %#", (changes) => {
    const base = stateFixtures()[changes.status];
    const candidate: Handoff = { ...base, ...changes };
    expect(validateHandoff(candidate)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_handoff" },
      ok: false,
    });
  });

  it.each([
    ["SLA not after request", { slaDueAt: REQUESTED_AT }],
    ["assignment before request", { assignedAt: BEFORE_REQUEST_AT }],
    ["start before assignment", { startedAt: REQUESTED_AT }],
    ["resolution before start", { resolvedAt: ASSIGNED_AT }],
  ] as const)("rejects invalid chronology: %s", (_name, changes) => {
    const candidate: Handoff = { ...stateFixtures().resolved, ...changes };
    expect(validateHandoff(candidate)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_handoff" },
      ok: false,
    });
  });

  it("rejects command occurrence before the latest aggregate transition", () => {
    const assigned = stateFixtures().assigned;
    expectFailureWithoutEffects(
      assigned,
      startHandoff(assigned, {
        ...commandContext(assigned, REQUESTED_AT),
        starter: ASSIGNEE_A,
      }),
      { code: "invariant_violation", reason: "invalid_handoff" },
    );
  });

  it("requires an attributable actor for resolution and reserves system actor for expiry", () => {
    const handoff = stateFixtures().in_progress;
    expectFailureWithoutEffects(
      handoff,
      resolveHandoff(handoff, {
        ...commandContext(handoff),
        resolutionCode: RESOLUTION_CODE,
      }),
      { code: "invariant_violation", reason: "invalid_reference" },
    );
  });

  it.each(["", "UPPERCASE", "contains-hyphen", "contains space", "x".repeat(101)])(
    "rejects noncanonical bounded code %j without echoing it",
    (candidate) => {
      expect(validateHandoffQueueKey(candidate)).toEqual({
        error: { code: "invariant_violation", reason: "invalid_handoff" },
        ok: false,
      });
      expect(validateHandoffReasonCode(candidate)).toEqual({
        error: { code: "invariant_violation", reason: "invalid_reason_code" },
        ok: false,
      });
      expect(validateHandoffResolutionCode(candidate)).toEqual({
        error: { code: "invariant_violation", reason: "invalid_reason_code" },
        ok: false,
      });
      if (candidate.length > 0) {
        expect(JSON.stringify(validateHandoffReasonCode(candidate))).not.toContain(candidate);
      }
    },
  );
});

describe("Handoff tenant isolation", () => {
  it.each([
    ["conversation", { conversation: { ...CONVERSATION, organizationId: ORGANIZATION_B } }],
    ["lead", { lead: { ...LEAD, organizationId: ORGANIZATION_B } }],
    ["location", { location: { ...LOCATION, organizationId: ORGANIZATION_B } }],
  ] as const)("rejects foreign-tenant creation %s reference", (_name, changes) => {
    const result: unknown = Reflect.apply(requestHandoff, undefined, [
      createCommand(changes as Partial<CreateHandoffCommand>),
    ]);

    expect(result).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
  });

  it("rejects a foreign-tenant command context", () => {
    const requested = createRequestedHandoff();
    const result = assignHandoff(requested, {
      ...commandContext(requested),
      assignee: ASSIGNEE_A,
      organizationId: ORGANIZATION_B,
    });

    expectFailureWithoutEffects(requested, result, { code: "tenant_scope_violation" });
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
  });

  it.each(["assign", "claim", "reassign", "start"] as const)(
    "rejects a foreign-tenant %s membership reference",
    (commandName) => {
      const handoff =
        commandName === "reassign" || commandName === "start"
          ? stateFixtures().assigned
          : stateFixtures().requested;
      const foreignAssignee = { ...ASSIGNEE_A, organizationId: ORGANIZATION_B };
      const result =
        commandName === "assign"
          ? assignHandoff(handoff, {
              ...commandContext(handoff),
              assignee: foreignAssignee,
            })
          : commandName === "claim"
            ? claimAndStartHandoff(handoff, {
                ...commandContext(handoff),
                assignee: foreignAssignee,
              })
            : commandName === "reassign"
              ? reassignHandoff(handoff, {
                  ...commandContext(handoff),
                  assignee: foreignAssignee,
                })
              : startHandoff(handoff, {
                  ...commandContext(handoff),
                  starter: foreignAssignee,
                });

      expectFailureWithoutEffects(handoff, result, { code: "tenant_scope_violation" });
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
    },
  );
});

describe("Handoff event semantics and immutability", () => {
  it.each(LEGAL_CASES)(
    "emits canonical drafts for $status → $command.name",
    ({ command, status }) => {
      const handoff = stateFixtures()[status];
      const result = command.run(handoff);

      expect(result.ok).toBe(true);
      if (result.ok) {
        result.value.events.forEach((event) => expectCanonicalDraft(handoff, event));
        expect(result.value.events.every((event) => event.event_type.startsWith("handoff."))).toBe(
          true,
        );
      }
    },
  );

  it("preserves previous state and bounded reason in cancellation/expiry events", () => {
    const inProgress = stateFixtures().in_progress;
    const cancelled = cancelHandoff(inProgress, {
      ...commandContext(inProgress),
      reasonCode: CANCEL_REASON,
    });
    const expired = expireHandoff(inProgress, {
      actor: SYSTEM_ACTOR,
      expectedVersion: inProgress.version,
      now: SLA_DUE_AT,
      organizationId: ORGANIZATION_A,
      reasonCode: EXPIRE_REASON,
    });

    expect(cancelled.ok).toBe(true);
    expect(expired.ok).toBe(true);
    if (cancelled.ok && expired.ok) {
      expect(cancelled.value.events[0]?.payload).toEqual({
        handoff_status: "cancelled",
        previous_handoff_status: "in_progress",
        reason_code: CANCEL_REASON,
      });
      expect(expired.value.events[0]?.payload).toEqual({
        handoff_status: "expired",
        previous_handoff_status: "in_progress",
        reason_code: EXPIRE_REASON,
      });
    }
  });

  it("deep-copies and freezes aggregate, events, payloads, and transition history", () => {
    const requested = createRequestedHandoff();
    const mutableAssignee = {
      membershipId: ASSIGNEE_A_ID,
      organizationId: ORGANIZATION_A,
    };
    const before = JSON.stringify(requested);
    const result = assignHandoff(requested, {
      ...commandContext(requested),
      assignee: mutableAssignee,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    mutableAssignee.membershipId = ASSIGNEE_B_ID;
    expect(JSON.stringify(requested)).toBe(before);
    expect(result.value.nextAggregate.assignedMembershipId).toBe(ASSIGNEE_A_ID);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.nextAggregate)).toBe(true);
    expect(Object.isFrozen(result.value.events)).toBe(true);
    expect(Object.isFrozen(result.value.events[0]?.payload)).toBe(true);
    expect(Object.isFrozen(result.value.transitionRecords)).toBe(true);
    expect(Object.isFrozen(result.value.transitionRecords[0])).toBe(true);
  });

  it("keeps canonical identifier types distinct at compile time", () => {
    expectTypeOf<HandoffConversationReference["conversationId"]>().toEqualTypeOf<ConversationId>();
    expectTypeOf<HandoffConversationReference["conversationId"]>().not.toEqualTypeOf<HandoffId>();
    expectTypeOf<HandoffAssigneeReference["membershipId"]>().toEqualTypeOf<MembershipId>();
    expectTypeOf<HandoffAssigneeReference["membershipId"]>().not.toEqualTypeOf<LocationId>();
  });
});
