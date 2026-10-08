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
