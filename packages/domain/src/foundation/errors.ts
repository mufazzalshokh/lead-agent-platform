export type InvariantViolationReason =
  | "currency_mismatch"
  | "invalid_contact"
  | "invalid_money"
  | "invalid_organization"
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
