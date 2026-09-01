import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ActorRefSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  DomainEventPayloadSchemas,
  DomainEventSchemas,
  EventIdSchema,
  HandoffIdSchema,
  LeadIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type CorrelationId,
  type EventId,
  type HandoffId,
  type LeadId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import {
  acceptCustomerMessage,
  closeConversation,
  conversationStateKey,
  createConversation,
  queueAiResponse,
  queueStaffResponse,
  recordStaffOwnership,
  recordSuccessorHandoff,
  reopenConversation,
  resolveConversation,
  resumeAi,
  routeToHuman,
  validateConversation,
  validateConversationClosureCode,
  validateConversationResolutionCode,
  type Conversation,
  type ConversationClosureCode,
  type ConversationCommandContext,
  type ConversationCommandResult,
  type ConversationCreationResult,
  type ConversationEventDraft,
  type ConversationHandoffReference,
  type ConversationMessageReference,
  type ConversationResolutionCode,
  type ConversationStateKey,
  type ExistingConversationCommandName,
  type RequestedConversationHandoffReference,
  type StaffOwnedConversationHandoffReference,
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

const requireContactId = (value: string): ContactId => {
  if (!isSchemaValue(ContactIdSchema, value)) {
    throw new TypeError("Invalid contact fixture");
  }
  return value;
};

const requireLeadId = (value: string): LeadId => {
  if (!isSchemaValue(LeadIdSchema, value)) {
    throw new TypeError("Invalid Lead fixture");
  }
  return value;
};

const requireChannelConnectionId = (value: string): ChannelConnectionId => {
  if (!isSchemaValue(ChannelConnectionIdSchema, value)) {
    throw new TypeError("Invalid channel-connection fixture");
  }
  return value;
};

const requireMessageId = (value: string): MessageId => {
  if (!isSchemaValue(MessageIdSchema, value)) {
    throw new TypeError("Invalid message fixture");
  }
  return value;
};

const requireHandoffId = (value: string): HandoffId => {
  if (!isSchemaValue(HandoffIdSchema, value)) {
    throw new TypeError("Invalid Handoff fixture");
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

const requireResolutionCode = (value: string): ConversationResolutionCode => {
  const result = validateConversationResolutionCode(value);
  if (!result.ok) {
    throw new TypeError("Invalid resolution fixture");
  }
  return result.value;
};

const requireClosureCode = (value: string): ConversationClosureCode => {
  const result = validateConversationClosureCode(value);
  if (!result.ok) {
    throw new TypeError("Invalid closure fixture");
  }
  return result.value;
};

const ORGANIZATION_A = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c41d01");
const ORGANIZATION_B = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c41d02");
const CONVERSATION_ID = requireConversationId("0193f1a8-7f65-7c28-a434-a10796c41d03");
const CONTACT_ID = requireContactId("0193f1a8-7f65-7c28-a434-a10796c41d04");
const LEAD_ID = requireLeadId("0193f1a8-7f65-7c28-a434-a10796c41d05");
const CHANNEL_CONNECTION_ID = requireChannelConnectionId("0193f1a8-7f65-7c28-a434-a10796c41d06");
const INBOUND_MESSAGE_ID = requireMessageId("0193f1a8-7f65-7c28-a434-a10796c41d07");
const OUTBOUND_MESSAGE_ID = requireMessageId("0193f1a8-7f65-7c28-a434-a10796c41d08");
const HANDOFF_ID = requireHandoffId("0193f1a8-7f65-7c28-a434-a10796c41d09");
const SUCCESSOR_HANDOFF_ID = requireHandoffId("0193f1a8-7f65-7c28-a434-a10796c41d0a");
const OTHER_HANDOFF_ID = requireHandoffId("0193f1a8-7f65-7c28-a434-a10796c41d0b");
const REOPEN_POLICY_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c41d0c");
const EVENT_ID = requireEventId("0193f1a8-7f65-7c28-a434-a10796c41d0d");
const CORRELATION_ID = requireCorrelationId("0193f1a8-7f65-7c28-a434-a10796c41d0e");
const OCCURRED_AT = requireUtcTimestamp("2026-09-01T12:00:00Z");
const RESOLUTION_CODE = requireResolutionCode("answered");
const CLOSURE_CODE = requireClosureCode("retention_archive");
const SYSTEM_ACTOR = Object.freeze({
  actor_id: null,
  actor_type: "system",
} as const satisfies ActorRef);

const INBOUND_MESSAGE = Object.freeze({
  messageId: INBOUND_MESSAGE_ID,
  organizationId: ORGANIZATION_A,
} satisfies ConversationMessageReference);

const OUTBOUND_MESSAGE = Object.freeze({
  messageId: OUTBOUND_MESSAGE_ID,
  organizationId: ORGANIZATION_A,
} satisfies ConversationMessageReference);

const REQUESTED_HANDOFF = Object.freeze({
  handoffId: HANDOFF_ID,
  organizationId: ORGANIZATION_A,
  status: "requested",
} satisfies RequestedConversationHandoffReference);

const ASSIGNED_HANDOFF = Object.freeze({
  handoffId: HANDOFF_ID,
  organizationId: ORGANIZATION_A,
  status: "assigned",
} satisfies StaffOwnedConversationHandoffReference);

const SUCCESSOR_HANDOFF = Object.freeze({
  handoffId: SUCCESSOR_HANDOFF_ID,
  organizationId: ORGANIZATION_A,
  status: "requested",
} satisfies RequestedConversationHandoffReference);

const CONVERSATION_STATES = [
  "open_ai",
  "awaiting_lead_ai",
  "awaiting_lead_staff",
  "awaiting_staff_paused",
  "awaiting_staff_staff",
  "resolved_paused",
  "closed_paused",
] as const satisfies readonly ConversationStateKey[];

const commandContext = (
  conversation: Conversation,
  expectedVersion: AggregateVersion = conversation.version,
): ConversationCommandContext => ({
  actor: SYSTEM_ACTOR,
  expectedVersion,
  occurredAt: OCCURRED_AT,
  organizationId: ORGANIZATION_A,
});

const requireNextConversation = (
  result: ConversationCommandResult | ConversationCreationResult,
): Conversation => {
  if (!result.ok) {
    throw new TypeError(`Expected a successful fixture transition: ${result.error.code}`);
  }
  return result.value.nextAggregate;
};

const createOpenConversation = (): Conversation =>
  requireNextConversation(
    createConversation({
      actor: SYSTEM_ACTOR,
      channelConnection: {
        channelConnectionId: CHANNEL_CONNECTION_ID,
        organizationId: ORGANIZATION_A,
      },
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
      conversationId: CONVERSATION_ID,
      initialMessage: INBOUND_MESSAGE,
      lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    }),
  );

const stateFixtures = (): Readonly<Record<ConversationStateKey, Conversation>> => {
  const open = createOpenConversation();
  const awaitingLeadAi = requireNextConversation(
    queueAiResponse(open, { ...commandContext(open), message: OUTBOUND_MESSAGE }),
  );
  const awaitingStaffPaused = requireNextConversation(
    routeToHuman(open, { ...commandContext(open), handoff: REQUESTED_HANDOFF }),
  );
  const awaitingStaffStaff = requireNextConversation(
    recordStaffOwnership(awaitingStaffPaused, {
      ...commandContext(awaitingStaffPaused),
      handoff: ASSIGNED_HANDOFF,
    }),
  );
  const awaitingLeadStaff = requireNextConversation(
    queueStaffResponse(awaitingStaffStaff, {
      ...commandContext(awaitingStaffStaff),
      message: OUTBOUND_MESSAGE,
    }),
  );
  const resolved = requireNextConversation(
    resolveConversation(open, {
      ...commandContext(open),
      handoffDisposition: null,
      resolutionCode: RESOLUTION_CODE,
    }),
  );
  const closed = requireNextConversation(
    closeConversation(resolved, {
      ...commandContext(resolved),
      closureCode: CLOSURE_CODE,
    }),
  );

  return Object.freeze({
    awaiting_lead_ai: awaitingLeadAi,
    awaiting_lead_staff: awaitingLeadStaff,
    awaiting_staff_paused: awaitingStaffPaused,
    awaiting_staff_staff: awaitingStaffStaff,
    closed_paused: closed,
    open_ai: open,
    resolved_paused: resolved,
  });
};

type ExpectedTransition = Readonly<{
  activeHandoff: "none" | "same" | "requested" | "staff" | "successor";
  eventTypes: readonly ConversationEventDraft["event_type"][];
  toAutomationMode: Conversation["automationMode"];
  toStatus: Conversation["status"];
}>;

type ExistingCommandCase = Readonly<{
  name: ExistingConversationCommandName;
  run: (
    conversation: Conversation,
    expectedVersion?: AggregateVersion,
  ) => ConversationCommandResult;
  successes: Partial<Record<ConversationStateKey, ExpectedTransition>>;
}>;

const COMMAND_CASES = [
  {
    name: "accept_customer_message",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      acceptCustomerMessage(conversation, {
        ...commandContext(conversation, expectedVersion),
        message: INBOUND_MESSAGE,
      }),
    successes: {
      awaiting_lead_ai: {
        activeHandoff: "none",
        eventTypes: ["message.received", "conversation.status_changed"],
        toAutomationMode: "ai",
        toStatus: "open",
      },
      awaiting_lead_staff: {
        activeHandoff: "same",
        eventTypes: ["message.received", "conversation.status_changed"],
        toAutomationMode: "staff",
        toStatus: "awaiting_staff",
      },
    },
  },
  {
    name: "queue_ai_response",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      queueAiResponse(conversation, {
        ...commandContext(conversation, expectedVersion),
        message: OUTBOUND_MESSAGE,
      }),
    successes: {
      open_ai: {
        activeHandoff: "none",
        eventTypes: ["message.response_queued", "conversation.status_changed"],
        toAutomationMode: "ai",
        toStatus: "awaiting_lead",
      },
    },
  },
  {
    name: "route_to_human",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      routeToHuman(conversation, {
        ...commandContext(conversation, expectedVersion),
        handoff: REQUESTED_HANDOFF,
      }),
    successes: Object.fromEntries(
      (["open_ai", "awaiting_lead_ai"] as const).map((state) => [
        state,
        {
          activeHandoff: "requested",
          eventTypes: ["conversation.status_changed"],
          toAutomationMode: "paused",
          toStatus: "awaiting_staff",
        },
      ]),
    ),
  },
  {
    name: "record_staff_ownership",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      recordStaffOwnership(conversation, {
        ...commandContext(conversation, expectedVersion),
        handoff: ASSIGNED_HANDOFF,
      }),
    successes: {
      awaiting_staff_paused: {
        activeHandoff: "staff",
        eventTypes: ["conversation.automation_mode_changed"],
        toAutomationMode: "staff",
        toStatus: "awaiting_staff",
      },
    },
  },
  {
    name: "queue_staff_response",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      queueStaffResponse(conversation, {
        ...commandContext(conversation, expectedVersion),
        message: OUTBOUND_MESSAGE,
      }),
    successes: {
      awaiting_staff_staff: {
        activeHandoff: "same",
        eventTypes: ["message.response_queued", "conversation.status_changed"],
        toAutomationMode: "staff",
        toStatus: "awaiting_lead",
      },
    },
  },
  {
    name: "resume_ai",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      resumeAi(conversation, {
        ...commandContext(conversation, expectedVersion),
        handoffDisposition: {
          disposition: "resume_ai",
          organizationId: ORGANIZATION_A,
          terminalizedHandoffId: conversation.activeHandoff?.handoffId ?? HANDOFF_ID,
        },
      }),
    successes: Object.fromEntries(
      (["awaiting_staff_paused", "awaiting_staff_staff"] as const).map((state) => [
        state,
        {
          activeHandoff: "none",
          eventTypes: ["conversation.status_changed"],
          toAutomationMode: "ai",
          toStatus: "open",
        },
      ]),
    ),
  },
  {
    name: "resolve_conversation",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      resolveConversation(conversation, {
        ...commandContext(conversation, expectedVersion),
        handoffDisposition:
          conversation.activeHandoff === null
            ? null
            : {
                disposition: "resolve_conversation",
                organizationId: ORGANIZATION_A,
                terminalizedHandoffId: conversation.activeHandoff.handoffId,
              },
        resolutionCode: RESOLUTION_CODE,
      }),
    successes: Object.fromEntries(
      (
        [
          "open_ai",
          "awaiting_lead_ai",
          "awaiting_lead_staff",
          "awaiting_staff_paused",
          "awaiting_staff_staff",
        ] as const
      ).map((state) => [
        state,
        {
          activeHandoff: "none",
          eventTypes: ["conversation.resolved"],
          toAutomationMode: "paused",
          toStatus: "resolved",
        },
      ]),
    ),
  },
  {
    name: "reopen_conversation",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      reopenConversation(conversation, {
        ...commandContext(conversation, expectedVersion),
        message: INBOUND_MESSAGE,
        reopenApproval: {
          approved: true,
          organizationId: ORGANIZATION_A,
          policyId: REOPEN_POLICY_ID,
        },
      }),
    successes: {
      resolved_paused: {
        activeHandoff: "none",
        eventTypes: ["message.received", "conversation.status_changed"],
        toAutomationMode: "ai",
        toStatus: "open",
      },
    },
  },
  {
    name: "close_conversation",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      closeConversation(conversation, {
        ...commandContext(conversation, expectedVersion),
        closureCode: CLOSURE_CODE,
      }),
    successes: {
      resolved_paused: {
        activeHandoff: "none",
        eventTypes: ["conversation.closed"],
        toAutomationMode: "paused",
        toStatus: "closed",
      },
    },
  },
  {
    name: "record_successor_handoff",
    run: (conversation: Conversation, expectedVersion = conversation.version) =>
      recordSuccessorHandoff(conversation, {
        ...commandContext(conversation, expectedVersion),
        handoffDisposition: {
          disposition: "successor_handoff",
          organizationId: ORGANIZATION_A,
          successorHandoff: SUCCESSOR_HANDOFF,
          terminalizedHandoffId: conversation.activeHandoff?.handoffId ?? HANDOFF_ID,
        },
      }),
    successes: {
      awaiting_staff_staff: {
        activeHandoff: "successor",
        eventTypes: ["conversation.automation_mode_changed"],
        toAutomationMode: "paused",
        toStatus: "awaiting_staff",
      },
    },
  },
] as const satisfies readonly ExistingCommandCase[];

const MATRIX_CASES = CONVERSATION_STATES.flatMap((state) =>
  COMMAND_CASES.map((command) => ({ command, state })),
);

const expectedTransitionFor = (
  command: ExistingCommandCase,
  state: ConversationStateKey,
): ExpectedTransition | undefined => command.successes[state];

const LEGAL_CASES = MATRIX_CASES.filter(
  ({ command, state }) => expectedTransitionFor(command, state) !== undefined,
);

const INVALID_CASES = MATRIX_CASES.filter(
  ({ command, state }) => expectedTransitionFor(command, state) === undefined,
);

const eventEnvelope = (
  conversation: Conversation,
  draft: ConversationEventDraft,
): Record<string, unknown> => ({
  actor: SYSTEM_ACTOR,
  aggregate_id: conversation.conversationId,
  aggregate_type: "conversation",
  aggregate_version: draft.aggregate_version,
  causation_id: null,
  correlation_id: CORRELATION_ID,
  event_id: EVENT_ID,
  event_type: draft.event_type,
  occurred_at: OCCURRED_AT,
  organization_id: conversation.organizationId,
  payload: draft.payload,
  request_id: null,
  schema_id: draft.schema_id,
  schema_version: draft.schema_version,
});

const expectCanonicalDraft = (conversation: Conversation, draft: ConversationEventDraft): void => {
  expect(isSchemaValue(DomainEventPayloadSchemas[draft.event_type], draft.payload)).toBe(true);
  expect(
    isSchemaValue(DomainEventSchemas[draft.event_type], eventEnvelope(conversation, draft)),
  ).toBe(true);
};

const expectFailureWithoutEffects = (
  conversation: Conversation,
  result: ConversationCommandResult,
  expectedError: unknown,
): void => {
  const before = JSON.stringify(conversation);

  expect(result).toEqual({ error: expectedError, ok: false });
  expect(result).not.toHaveProperty("value");
  expect(result).not.toHaveProperty("events");
  expect(result).not.toHaveProperty("transitionRecords");
  expect(JSON.stringify(conversation)).toBe(before);
};

const expectExpectedHandoff = (
  before: Conversation,
  after: Conversation,
  expected: ExpectedTransition["activeHandoff"],
): void => {
  switch (expected) {
    case "none":
      expect(after.activeHandoff).toBeNull();
      return;
    case "same":
      expect(after.activeHandoff).toEqual(before.activeHandoff);
      return;
    case "requested":
      expect(after.activeHandoff).toEqual(REQUESTED_HANDOFF);
      return;
    case "staff":
      expect(after.activeHandoff).toEqual(ASSIGNED_HANDOFF);
      return;
    case "successor":
      expect(after.activeHandoff).toEqual(SUCCESSOR_HANDOFF);
  }
};

describe("Conversation creation", () => {
  it("creates open AI ownership and emits exactly started then first-message facts", () => {
    const channelConnection = {
      channelConnectionId: CHANNEL_CONNECTION_ID,
      organizationId: ORGANIZATION_A,
    };
    const result = createConversation({
      actor: SYSTEM_ACTOR,
      channelConnection,
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
      conversationId: CONVERSATION_ID,
      initialMessage: INBOUND_MESSAGE,
      lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nextAggregate).toEqual({
      activeHandoff: null,
      automationMode: "ai",
      channelConnectionId: CHANNEL_CONNECTION_ID,
      contactId: CONTACT_ID,
      conversationId: CONVERSATION_ID,
      leadId: LEAD_ID,
      organizationId: ORGANIZATION_A,
      status: "open",
      version: 1,
    });
    expect(result.value.events).toEqual([
      {
        aggregate_version: 1,
        event_type: "conversation.started",
        payload: {
          channel_connection_id: CHANNEL_CONNECTION_ID,
          contact_id: CONTACT_ID,
          conversation_status: "open",
          lead_id: LEAD_ID,
        },
        schema_id: "ConversationStartedDomainEvent.v1",
        schema_version: "1",
      },
      {
        aggregate_version: 1,
        event_type: "message.received",
        payload: { message_direction: "inbound", message_id: INBOUND_MESSAGE_ID },
        schema_id: "MessageReceivedDomainEvent.v1",
        schema_version: "1",
      },
    ]);
    expect(result.value.transitionRecords).toEqual([
      {
        actor: SYSTEM_ACTOR,
        activeHandoffId: null,
        command: "create_conversation",
        conversationId: CONVERSATION_ID,
        fromAutomationMode: null,
        fromHandoffId: null,
        fromStatus: null,
        handoffDisposition: null,
        messageId: INBOUND_MESSAGE_ID,
        occurredAt: OCCURRED_AT,
        organizationId: ORGANIZATION_A,
        policyId: null,
        reasonCode: null,
        toAutomationMode: "ai",
        toStatus: "open",
        version: 1,
      },
    ]);
    for (const draft of result.value.events) {
      expectCanonicalDraft(result.value.nextAggregate, draft);
    }
    expect(Object.isFrozen(result.value.nextAggregate)).toBe(true);
    expect(Object.isFrozen(result.value.events)).toBe(true);
    expect(Object.isFrozen(result.value.events[0]?.payload)).toBe(true);
    expect(Object.isFrozen(result.value.transitionRecords[0])).toBe(true);
    expect(result.value.nextAggregate).not.toHaveProperty("events");
    expect(result.value.nextAggregate).not.toHaveProperty("pendingEvents");

    channelConnection.channelConnectionId = requireChannelConnectionId(
      "0193f1a8-7f65-7c28-a434-a10796c41d0f",
    );
    expect(result.value.nextAggregate.channelConnectionId).toBe(CHANNEL_CONNECTION_ID);
  });

  it.each([
    { field: "conversationId", value: "not-a-uuid" },
    { field: "occurredAt", value: "2026-09-01T17:00:00+05:00" },
    { field: "actor", value: { actor_id: null, actor_type: "model" } },
  ] as const)("rejects malformed creation $field without effects", ({ field, value }) => {
    const candidate: Record<string, unknown> = {
      actor: SYSTEM_ACTOR,
      channelConnection: {
        channelConnectionId: CHANNEL_CONNECTION_ID,
        organizationId: ORGANIZATION_A,
      },
      contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
      conversationId: CONVERSATION_ID,
      initialMessage: INBOUND_MESSAGE,
      lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
      occurredAt: OCCURRED_AT,
      organizationId: ORGANIZATION_A,
      [field]: value,
    };
    const result: unknown = Reflect.apply(createConversation, undefined, [candidate]);

    expect(result).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reference" },
      ok: false,
    });
  });
});

describe("exhaustive Conversation state/ownership by command matrix", () => {
  it("covers seven valid combinations, ten commands, seventeen legal edges, and fifty-three invalid pairs", () => {
    expect(CONVERSATION_STATES).toHaveLength(7);
    expect(COMMAND_CASES).toHaveLength(10);
    expect(MATRIX_CASES).toHaveLength(70);
    expect(LEGAL_CASES).toHaveLength(17);
    expect(INVALID_CASES).toHaveLength(53);
  });

  it.each(MATRIX_CASES)(
    "$state × $command.name has the exact accepted outcome",
    ({ command, state }) => {
      const conversation = stateFixtures()[state];
      const before = JSON.stringify(conversation);
      const result = command.run(conversation);
      const expected = expectedTransitionFor(command, state);

      expect(conversationStateKey(conversation)).toBe(state);

      if (expected === undefined) {
        expectFailureWithoutEffects(conversation, result, {
          code: "invalid_state_transition",
          command: command.name,
          currentState: state,
        });
        return;
      }

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.value.nextAggregate.status).toBe(expected.toStatus);
      expect(result.value.nextAggregate.automationMode).toBe(expected.toAutomationMode);
      expect(result.value.nextAggregate.version).toBe(conversation.version + 1);
      expectExpectedHandoff(conversation, result.value.nextAggregate, expected.activeHandoff);
      expect(result.value.events.map((event) => event.event_type)).toEqual(expected.eventTypes);
      expect(
        result.value.events.every((event) => event.aggregate_version === conversation.version + 1),
      ).toBe(true);
      expect(result.value.transitionRecords).toHaveLength(1);
      expect(result.value.transitionRecords[0]).toMatchObject({
        command: command.name,
        fromAutomationMode: conversation.automationMode,
        fromStatus: conversation.status,
        toAutomationMode: expected.toAutomationMode,
        toStatus: expected.toStatus,
        version: conversation.version + 1,
      });
      for (const draft of result.value.events) {
        expectCanonicalDraft(result.value.nextAggregate, draft);
      }
      expect(validateConversation(result.value.nextAggregate)).toEqual({
        ok: true,
        value: result.value.nextAggregate,
      });
      expect(JSON.stringify(conversation)).toBe(before);
      expect(result.value.nextAggregate).not.toBe(conversation);
    },
  );
});

describe("Conversation event and ownership semantics", () => {
  it.each([
    [
      "create",
      () =>
        createConversation({
          actor: SYSTEM_ACTOR,
          channelConnection: {
            channelConnectionId: CHANNEL_CONNECTION_ID,
            organizationId: ORGANIZATION_A,
          },
          contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
          conversationId: CONVERSATION_ID,
          initialMessage: INBOUND_MESSAGE,
          lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
          occurredAt: OCCURRED_AT,
          organizationId: ORGANIZATION_A,
        }),
    ],
    [
      "resolve",
      () => {
        const conversation = stateFixtures().open_ai;
        return resolveConversation(conversation, {
          ...commandContext(conversation),
          handoffDisposition: null,
          resolutionCode: RESOLUTION_CODE,
        });
      },
    ],
    [
      "close",
      () => {
        const conversation = stateFixtures().resolved_paused;
        return closeConversation(conversation, {
          ...commandContext(conversation),
          closureCode: CLOSURE_CODE,
        });
      },
    ],
  ] as const)("%s uses its specialized event and never a generic status event", (_name, invoke) => {
    const result = invoke();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events.map((event) => event.event_type)).not.toContain(
        "conversation.status_changed",
      );
    }
  });

  it("uses only the exact paused-to-staff ownership event with the same Handoff", () => {
    const conversation = stateFixtures().awaiting_staff_paused;
    const result = recordStaffOwnership(conversation, {
      ...commandContext(conversation),
      handoff: { ...ASSIGNED_HANDOFF, status: "in_progress" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toEqual([
        {
          aggregate_version: conversation.version + 1,
          event_type: "conversation.automation_mode_changed",
          payload: {
            automation_mode: "staff",
            conversation_status: "awaiting_staff",
            handoff_id: HANDOFF_ID,
            previous_automation_mode: "paused",
          },
          schema_id: "ConversationAutomationModeChangedDomainEvent.v1",
          schema_version: "1",
        },
      ]);
      expect(result.value.nextAggregate.activeHandoff?.status).toBe("in_progress");
    }
  });

  it("uses only the exact staff-to-paused ownership event with the successor Handoff", () => {
    const conversation = stateFixtures().awaiting_staff_staff;
    const result = recordSuccessorHandoff(conversation, {
      ...commandContext(conversation),
      handoffDisposition: {
        disposition: "successor_handoff",
        organizationId: ORGANIZATION_A,
        successorHandoff: SUCCESSOR_HANDOFF,
        terminalizedHandoffId: HANDOFF_ID,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events[0]).toEqual({
        aggregate_version: conversation.version + 1,
        event_type: "conversation.automation_mode_changed",
        payload: {
          automation_mode: "paused",
          conversation_status: "awaiting_staff",
          handoff_id: SUCCESSOR_HANDOFF_ID,
          previous_automation_mode: "staff",
        },
        schema_id: "ConversationAutomationModeChangedDomainEvent.v1",
        schema_version: "1",
      });
      expect(result.value.transitionRecords[0]).toMatchObject({
        activeHandoffId: SUCCESSOR_HANDOFF_ID,
        fromHandoffId: HANDOFF_ID,
        handoffDisposition: "successor_handoff",
      });
    }
  });

  it.each(["awaiting_lead_staff", "awaiting_staff_paused", "awaiting_staff_staff"] as const)(
    "resolves %s only with explicit active-Handoff disposition and one specialized event",
    (state) => {
      const conversation = stateFixtures()[state];
      const result = COMMAND_CASES[6].run(conversation);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.events.map((event) => event.event_type)).toEqual([
          "conversation.resolved",
        ]);
        expect(result.value.nextAggregate.activeHandoff).toBeNull();
        expect(result.value.transitionRecords[0]?.handoffDisposition).toBe("resolve_conversation");
      }
    },
  );
});

describe("Conversation version, terminal, and replay behavior", () => {
  it.each(LEGAL_CASES)(
    "$state → $command.name rejects every wrong valid version and advances exactly once",
    ({ command, state }) => {
      const conversation = stateFixtures()[state];
      const wrongVersions = [conversation.version + 1];
      if (conversation.version > 1) {
        wrongVersions.unshift(conversation.version - 1);
      }

      for (const wrongVersion of wrongVersions) {
        expectFailureWithoutEffects(conversation, command.run(conversation, wrongVersion), {
          code: "concurrency_conflict",
          currentVersion: conversation.version,
        });
      }

      const result = command.run(conversation, conversation.version);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextAggregate.version).toBe(conversation.version + 1);
        expect(
          result.value.events.every(
            (event) => event.aggregate_version === conversation.version + 1,
          ),
        ).toBe(true);
      }
    },
  );

  it("rejects version overflow without state, events, or transition records", () => {
    const conversation: Conversation = Object.freeze({
      ...stateFixtures().open_ai,
      version: Number.MAX_SAFE_INTEGER,
    });
    const result = queueAiResponse(conversation, {
      ...commandContext(conversation),
      message: OUTBOUND_MESSAGE,
    });

    expectFailureWithoutEffects(conversation, result, {
      code: "invariant_violation",
      reason: "version_overflow",
    });
  });

  it("rejects every existing command from closed terminal state", () => {
    const conversation = stateFixtures().closed_paused;

    for (const command of COMMAND_CASES) {
      expectFailureWithoutEffects(conversation, command.run(conversation), {
        code: "invalid_state_transition",
        command: command.name,
        currentState: "closed_paused",
      });
    }
  });

  it.each([
    ["AI response already queued", "awaiting_lead_ai", COMMAND_CASES[1]],
    ["Handoff already routed", "awaiting_staff_paused", COMMAND_CASES[2]],
    ["staff ownership already recorded", "awaiting_staff_staff", COMMAND_CASES[3]],
    ["Conversation already resolved", "resolved_paused", COMMAND_CASES[6]],
    ["Conversation already closed", "closed_paused", COMMAND_CASES[8]],
  ] as const)("rejects replay-like command: %s", (_label, state, command) => {
    const conversation = stateFixtures()[state];
    expectFailureWithoutEffects(conversation, command.run(conversation), {
      code: "invalid_state_transition",
      command: command.name,
      currentState: state,
    });
  });
});

describe("Conversation invariants and explicit Handoff dispositions", () => {
  it.each([
    { activeHandoff: null, automationMode: "paused", status: "open" },
    { activeHandoff: null, automationMode: "staff", status: "awaiting_lead" },
    { activeHandoff: null, automationMode: "paused", status: "awaiting_staff" },
    { activeHandoff: REQUESTED_HANDOFF, automationMode: "ai", status: "awaiting_staff" },
    { activeHandoff: REQUESTED_HANDOFF, automationMode: "paused", status: "resolved" },
    { activeHandoff: ASSIGNED_HANDOFF, automationMode: "paused", status: "closed" },
  ] as const)("rejects impossible aggregate combination %#", (changes) => {
    const candidate: Conversation = { ...createOpenConversation(), ...changes };
    expect(validateConversation(candidate)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_conversation" },
      ok: false,
    });
  });

  it("rejects an active Handoff from another tenant inside a reconstructed aggregate", () => {
    const candidate: Conversation = {
      ...stateFixtures().awaiting_staff_paused,
      activeHandoff: { ...REQUESTED_HANDOFF, organizationId: ORGANIZATION_B },
    };
    expect(validateConversation(candidate)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_conversation" },
      ok: false,
    });
  });

  it("requires the same Handoff when recording staff ownership", () => {
    const conversation = stateFixtures().awaiting_staff_paused;
    const result = recordStaffOwnership(conversation, {
      ...commandContext(conversation),
      handoff: { ...ASSIGNED_HANDOFF, handoffId: OTHER_HANDOFF_ID },
    });
    expectFailureWithoutEffects(conversation, result, {
      code: "invariant_violation",
      reason: "invalid_reference",
    });
  });

  it.each([
    ["missing", null],
    [
      "wrong Handoff",
      {
        disposition: "resolve_conversation",
        organizationId: ORGANIZATION_A,
        terminalizedHandoffId: OTHER_HANDOFF_ID,
      },
    ],
  ] as const)("rejects %s resolution disposition with active ownership", (_name, disposition) => {
    const conversation = stateFixtures().awaiting_staff_staff;
    const candidate = {
      ...commandContext(conversation),
      handoffDisposition: disposition,
      resolutionCode: RESOLUTION_CODE,
    };
    const result: ConversationCommandResult = Reflect.apply(resolveConversation, undefined, [
      conversation,
      candidate,
    ]);
    expectFailureWithoutEffects(conversation, result, {
      code: "invariant_violation",
      reason: "invalid_reference",
    });
  });

  it("rejects a terminal disposition when no Handoff exists", () => {
    const conversation = stateFixtures().open_ai;
    const result = resolveConversation(conversation, {
      ...commandContext(conversation),
      handoffDisposition: {
        disposition: "resolve_conversation",
        organizationId: ORGANIZATION_A,
        terminalizedHandoffId: HANDOFF_ID,
      },
      resolutionCode: RESOLUTION_CODE,
    });
    expectFailureWithoutEffects(conversation, result, {
      code: "invariant_violation",
      reason: "invalid_reference",
    });
  });

  it("rejects implicit or mismatched resume and preserves staff ownership", () => {
    const conversation = stateFixtures().awaiting_staff_staff;
    const result = resumeAi(conversation, {
      ...commandContext(conversation),
      handoffDisposition: {
        disposition: "resume_ai",
        organizationId: ORGANIZATION_A,
        terminalizedHandoffId: OTHER_HANDOFF_ID,
      },
    });
    expectFailureWithoutEffects(conversation, result, {
      code: "invariant_violation",
      reason: "invalid_reference",
    });
  });

  it("rejects a successor that reuses the terminalized Handoff identity", () => {
    const conversation = stateFixtures().awaiting_staff_staff;
    const result = recordSuccessorHandoff(conversation, {
      ...commandContext(conversation),
      handoffDisposition: {
        disposition: "successor_handoff",
        organizationId: ORGANIZATION_A,
        successorHandoff: { ...SUCCESSOR_HANDOFF, handoffId: HANDOFF_ID },
        terminalizedHandoffId: HANDOFF_ID,
      },
    });
    expectFailureWithoutEffects(conversation, result, {
      code: "invariant_violation",
      reason: "invalid_reference",
    });
  });
});

describe("Conversation tenant isolation and input validation", () => {
  const createCandidate = () => ({
    actor: SYSTEM_ACTOR,
    channelConnection: {
      channelConnectionId: CHANNEL_CONNECTION_ID,
      organizationId: ORGANIZATION_A,
    },
    contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_A },
    conversationId: CONVERSATION_ID,
    initialMessage: INBOUND_MESSAGE,
    lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
    occurredAt: OCCURRED_AT,
    organizationId: ORGANIZATION_A,
  });

  it.each([
    [
      "channelConnection",
      () => ({
        ...createCandidate(),
        channelConnection: {
          channelConnectionId: CHANNEL_CONNECTION_ID,
          organizationId: ORGANIZATION_B,
        },
      }),
    ],
    [
      "contact",
      () => ({
        ...createCandidate(),
        contact: { contactId: CONTACT_ID, organizationId: ORGANIZATION_B },
      }),
    ],
    [
      "initialMessage",
      () => ({
        ...createCandidate(),
        initialMessage: { ...INBOUND_MESSAGE, organizationId: ORGANIZATION_B },
      }),
    ],
    [
      "lead",
      () => ({
        ...createCandidate(),
        lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_B },
      }),
    ],
  ] as const)(
    "rejects a foreign-tenant creation %s reference without identifier leakage",
    (_referenceName, createForeignTenantCommand) => {
      const result: unknown = Reflect.apply(createConversation, undefined, [
        createForeignTenantCommand(),
      ]);

      expect(result).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
    },
  );

  it.each([
    [
      "command context",
      () => {
        const conversation = stateFixtures().open_ai;
        return [
          conversation,
          queueAiResponse(conversation, {
            ...commandContext(conversation),
            message: OUTBOUND_MESSAGE,
            organizationId: ORGANIZATION_B,
          }),
        ] as const;
      },
    ],
    [
      "message",
      () => {
        const conversation = stateFixtures().open_ai;
        return [
          conversation,
          queueAiResponse(conversation, {
            ...commandContext(conversation),
            message: { ...OUTBOUND_MESSAGE, organizationId: ORGANIZATION_B },
          }),
        ] as const;
      },
    ],
    [
      "requested Handoff",
      () => {
        const conversation = stateFixtures().open_ai;
        return [
          conversation,
          routeToHuman(conversation, {
            ...commandContext(conversation),
            handoff: { ...REQUESTED_HANDOFF, organizationId: ORGANIZATION_B },
          }),
        ] as const;
      },
    ],
    [
      "staff-owned Handoff",
      () => {
        const conversation = stateFixtures().awaiting_staff_paused;
        return [
          conversation,
          recordStaffOwnership(conversation, {
            ...commandContext(conversation),
            handoff: { ...ASSIGNED_HANDOFF, organizationId: ORGANIZATION_B },
          }),
        ] as const;
      },
    ],
    [
      "resume disposition",
      () => {
        const conversation = stateFixtures().awaiting_staff_staff;
        return [
          conversation,
          resumeAi(conversation, {
            ...commandContext(conversation),
            handoffDisposition: {
              disposition: "resume_ai",
              organizationId: ORGANIZATION_B,
              terminalizedHandoffId: HANDOFF_ID,
            },
          }),
        ] as const;
      },
    ],
    [
      "reopen approval",
      () => {
        const conversation = stateFixtures().resolved_paused;
        return [
          conversation,
          reopenConversation(conversation, {
            ...commandContext(conversation),
            message: INBOUND_MESSAGE,
            reopenApproval: {
              approved: true,
              organizationId: ORGANIZATION_B,
              policyId: REOPEN_POLICY_ID,
            },
          }),
        ] as const;
      },
    ],
    [
      "successor disposition",
      () => {
        const conversation = stateFixtures().awaiting_staff_staff;
        return [
          conversation,
          recordSuccessorHandoff(conversation, {
            ...commandContext(conversation),
            handoffDisposition: {
              disposition: "successor_handoff",
              organizationId: ORGANIZATION_B,
              successorHandoff: SUCCESSOR_HANDOFF,
              terminalizedHandoffId: HANDOFF_ID,
            },
          }),
        ] as const;
      },
    ],
  ] as const)(
    "rejects a foreign-tenant %s without leaking either organization",
    (_name, invoke) => {
      const [conversation, result] = invoke();
      expectFailureWithoutEffects(conversation, result, { code: "tenant_scope_violation" });
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
      expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
    },
  );

  it.each(["", "UPPERCASE", "contains-hyphen", "contains space", "x".repeat(101)])(
    "rejects noncanonical resolution/closure code %j without echoing it",
    (candidate) => {
      expect(validateConversationResolutionCode(candidate)).toEqual({
        error: { code: "invariant_violation", reason: "invalid_reason_code" },
        ok: false,
      });
      expect(validateConversationClosureCode(candidate)).toEqual({
        error: { code: "invariant_violation", reason: "invalid_reason_code" },
        ok: false,
      });
    },
  );

  it("keeps canonical identifier types distinct at compile time", () => {
    expectTypeOf<ConversationMessageReference["messageId"]>().toEqualTypeOf<MessageId>();
    expectTypeOf<ConversationMessageReference["messageId"]>().not.toEqualTypeOf<HandoffId>();
    expectTypeOf<ConversationHandoffReference["handoffId"]>().toEqualTypeOf<HandoffId>();
    expectTypeOf<ConversationHandoffReference["handoffId"]>().not.toEqualTypeOf<ConversationId>();
    expect(isSchemaValue(ActorRefSchema, SYSTEM_ACTOR)).toBe(true);
  });
});
