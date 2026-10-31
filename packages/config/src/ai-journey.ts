import { ConfigurationValidationError } from "./database.js";

/** Owner-approved independent Widget lane; original ledger is never reset. */
export const S22_WIDGET_ALLOWANCE = Object.freeze({
  maximumMessages: 2,
  maximumCalls: 4,
  additionalReserveMicros: 3_205_728n,
  maximumCombinedExposureMicros: 4_247_838n,
  previousKnownCostMicros: 8_714n,
  previousCalls: 4,
  previousMessages: 4,
} as const);

/** One additive, owner-approved replacement; never resets the retired ledger.
 * Inactive until an exact retired-baseline check and attributed selection commit. */
export const S22_WIDGET_REPLACEMENT = Object.freeze({
  profile: "s22-widget-replacement.v1",
  retiredSessionId: "01a12a04-d2ae-7cba-aded-0c48a410be0c",
  retiredConversationId: "01a12a13-2f0a-7cb4-a8c7-8f0051168d39",
  retiredMessageId: "01a12a13-2f0a-728c-9cdb-30fa521911c2",
  retiredRunId: "01a12a13-389a-7ede-8073-99fe1edf5672",
  retiredRequestId: "01a12a13-498e-7d43-83cf-85b13307bd7b",
  retiredKnownCostMicros: 2_250n,
  maximumMessages: 2,
  maximumCalls: 3,
  additionalReserveMicros: 2_404_296n,
} as const);

/** Prepared one-turn amendment for the already-consumed replacement only.
 * Never widens paid-message, physical-attempt or money limits; no new selection. */
export const S22_WIDGET_DATE_CONTINUATION = Object.freeze({
  profile: "s22-widget-date-continuation.v1",
  sessionId: "01a12c02-3e50-7663-99f4-c35024796c23",
  conversationId: "01a12c14-1edf-7609-a7d3-6354deaa7006",
  firstMessageId: "01a12c14-1edf-76bb-a51c-cc92a70975ea",
  firstRunId: "01a12c14-24bc-77f1-b1bb-b040e2b7d588",
  firstKnownCostMicros: 2_277n,
  maximumCustomerMessages: 3,
} as const);

/** Stable, reviewed staging authorization envelope. The old unused SID is an
 * anchor only: it never renews or authenticates a browser. A fresh SID must be
 * explicitly selected by the owner through the audited application command. */
export const S22_WIDGET_SELECTION_ENVELOPE = Object.freeze({
  profile: "s22-widget-selection.v1",
  anchorSessionId: "01a11c48-dbc2-76de-a873-f41664da5ccb",
  channelConnectionId: "01a11771-2c02-7240-86f7-19f95690d22e",
  allowedOriginId: "01a11771-2c02-7765-b999-7dc9895ee49d",
} as const);

/** Internal, one-off staging profile; not a tenant billing/booking policy. */
export const S22_BOOKING_COHORT = Object.freeze({
  profile: "s22-synthetic-booking.v1",
  organizationId: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  conversationId: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7",
  historicalRunIds: Object.freeze([
    "01a1067f-dfc8-7e14-9e12-89a0e30fd27e",
    "01a10af4-5126-7ce8-ab52-0424e07ab3d9",
  ]),
  // Planning reserve only. Activating booking requires the owner's exception
  // and exact-plan approval; this value never replaces ai_runs NULL costs.
  historicalReserveMicros: 1_033_396n,
  hardCeilingMicros: 10_000_000n,
  // Owner-approved continuation: retain the three consumed messages/calls and
  // allow one additional message with at most two physical attempts. Same ledger.
  maximumCalls: 5,
  maximumMessages: 4,
  maximumCallsPerMessage: 2,
  inputTokenLimit: 1_048_576,
  outputTokenLimit: 4_000,
  validUntil: "2027-01-01T00:00:00Z",
} as const);

export type AIJourneyCohortConfig = Readonly<{
  mode: "paused" | "booking" | "widget_booking";
  /** Non-secret UUID from the reviewed runtime-role session reader, never a browser parameter. */
  widgetSessionId?: string;
  profile: string;
  organizationId: string;
  conversationId: string;
  historicalRunIds: readonly string[];
  historicalReserveMicros: bigint;
  hardCeilingMicros: bigint;
  maximumCalls: number;
  maximumMessages: number;
  maximumCallsPerMessage: number;
  inputTokenLimit: number;
  outputTokenLimit: number;
  validUntil: string;
}>;

export const loadAIJourneyCohortConfig = (
  environment: NodeJS.ProcessEnv,
): AIJourneyCohortConfig | null => {
  const mode = environment["AI_JOURNEY_MODE"];
  const widgetSessionId = environment["AI_JOURNEY_WIDGET_SESSION_ID"];
  const staging = environment["DEPLOYMENT_ENVIRONMENT"] === "staging";
  if (!staging) {
    if (mode !== undefined || widgetSessionId !== undefined)
      throw new ConfigurationValidationError("AI_JOURNEY_MODE");
    return null;
  }
  if (mode !== undefined && mode !== "paused" && mode !== "booking" && mode !== "widget_booking")
    throw new ConfigurationValidationError("AI_JOURNEY_MODE");
  if (
    mode === "widget_booking"
      ? widgetSessionId === undefined ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          widgetSessionId,
        )
      : widgetSessionId !== undefined
  )
    throw new ConfigurationValidationError("AI_JOURNEY_WIDGET_SESSION_ID");
  if (
    environment["AI_REQUEST_TIMEOUT_MS"] !== undefined &&
    environment["AI_REQUEST_TIMEOUT_MS"] !== "15000"
  )
    throw new ConfigurationValidationError("AI_REQUEST_TIMEOUT_MS");
  // New staging images cannot resume paid dispatch by mere deployment.
  return Object.freeze({
    ...S22_BOOKING_COHORT,
    mode: mode ?? "paused",
    ...(widgetSessionId === undefined ? {} : { widgetSessionId }),
  });
};
