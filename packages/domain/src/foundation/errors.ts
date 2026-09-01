export type InvariantViolationReason =
  | "currency_mismatch"
  | "invalid_contact"
  | "invalid_conversation"
  | "invalid_lead"
  | "invalid_money"
  | "invalid_organization"
  | "invalid_reference"
  | "invalid_reason_code"
  | "invalid_service_price"
  | "invalid_version"
  | "money_must_be_positive"
  | "money_overflow"
  | "version_overflow";

export type InvalidTimePreferenceReason =
  "invalid_iana_time_zone" | "invalid_utc_timestamp" | "invalid_utc_window";

export type InvariantViolation<Reason extends InvariantViolationReason = InvariantViolationReason> =
  Readonly<{
    code: "invariant_violation";
    reason: Reason;
  }>;

export type ConcurrencyConflict<Version extends number = number> = Readonly<{
  code: "concurrency_conflict";
  currentVersion: Version;
}>;

export type TenantScopeViolation = Readonly<{
  code: "tenant_scope_violation";
}>;

export type InvalidStateTransition<
  State extends string = string,
  Command extends string = string,
> = Readonly<{
  code: "invalid_state_transition";
  command: Command;
  currentState: State;
}>;

export type QualificationIncomplete = Readonly<{
  code: "qualification_incomplete";
}>;

export type InvalidTimePreference<
  Reason extends InvalidTimePreferenceReason = InvalidTimePreferenceReason,
> = Readonly<{
  code: "invalid_time_preference";
  reason: Reason;
}>;

export type OfferExpired = Readonly<{
  code: "offer_expired";
}>;

export type DomainFoundationError =
  | InvariantViolation
  | ConcurrencyConflict
  | TenantScopeViolation
  | InvalidStateTransition
  | QualificationIncomplete
  | InvalidTimePreference
  | OfferExpired;

export const invariantViolation = <const Reason extends InvariantViolationReason>(
  reason: Reason,
): InvariantViolation<Reason> =>
  Object.freeze({
    code: "invariant_violation",
    reason,
  });

export const concurrencyConflict = <Version extends number>(
  currentVersion: Version,
): ConcurrencyConflict<Version> =>
  Object.freeze({
    code: "concurrency_conflict",
    currentVersion,
  });

export const tenantScopeViolation = (): TenantScopeViolation =>
  Object.freeze({
    code: "tenant_scope_violation",
  });

export const invalidStateTransition = <const State extends string, const Command extends string>(
  currentState: State,
  command: Command,
): InvalidStateTransition<State, Command> =>
  Object.freeze({
    code: "invalid_state_transition",
    command,
    currentState,
  });

export const qualificationIncomplete = (): QualificationIncomplete =>
  Object.freeze({
    code: "qualification_incomplete",
  });

export const invalidTimePreference = <const Reason extends InvalidTimePreferenceReason>(
  reason: Reason,
): InvalidTimePreference<Reason> =>
  Object.freeze({
    code: "invalid_time_preference",
    reason,
  });

export const offerExpired = (): OfferExpired =>
  Object.freeze({
    code: "offer_expired",
  });
