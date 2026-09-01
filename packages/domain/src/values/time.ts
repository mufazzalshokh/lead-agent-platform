import { UtcTimestampSchema, isSchemaValue, type UtcTimestamp } from "@lead-agent/contracts";

import {
  invalidTimePreference,
  offerExpired,
  type InvalidTimePreference,
  type OfferExpired,
} from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";

const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?Z(?![\s\S])/;

const STRUCTURAL_IANA_TIME_ZONE_PATTERN =
  /^(?:UTC|[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+-]*)+)(?![\s\S])/;

const MAX_IANA_TIME_ZONE_LENGTH = 100;

declare const ianaTimeZoneBrand: unique symbol;

/**
 * A structurally valid named IANA-zone representation. This brand does not
 * claim registry membership or resolve local-time/DST ambiguity.
 */
export type IanaTimeZone = string & {
  readonly [ianaTimeZoneBrand]: "IanaTimeZone";
};

export type TimestampComparison = -1 | 0 | 1;

export type UtcTimestampValidationError = InvalidTimePreference<
  "invalid_utc_timestamp" | "invalid_utc_window"
>;

type IanaTimeZoneValidationError = InvalidTimePreference<"invalid_iana_time_zone">;

interface UtcComponents {
  readonly day: number;
  readonly fractionNanoseconds: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly second: number;
  readonly year: number;
}

const parseCanonicalUtcTimestamp = (value: unknown): UtcComponents | undefined => {
  if (!isSchemaValue(UtcTimestampSchema, value)) {
    return undefined;
  }

  const match = CANONICAL_UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  const hourText = match[4];
  const minuteText = match[5];
  const secondText = match[6];
  const fractionText = match[7] ?? "";

  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    secondText === undefined
  ) {
    return undefined;
  }

  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const second = Number.parseInt(secondText, 10);
  const fractionNanoseconds = Number.parseInt(fractionText.padEnd(9, "0") || "0", 10);

  return Object.freeze({
    day,
    fractionNanoseconds,
    hour,
    minute,
    month,
    second,
    year,
  });
};

const compareComponents = (left: UtcComponents, right: UtcComponents): TimestampComparison => {
  const orderedParts = [
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
    "fractionNanoseconds",
  ] as const;

  for (const part of orderedParts) {
    const leftPart = left[part];
    const rightPart = right[part];

    if (leftPart < rightPart) {
      return -1;
    }
    if (leftPart > rightPart) {
      return 1;
    }
  }

  return 0;
};

const invalidUtcTimestamp = (): UtcTimestampValidationError =>
  invalidTimePreference("invalid_utc_timestamp");

const invalidUtcWindow = (): UtcTimestampValidationError =>
  invalidTimePreference("invalid_utc_window");

export const isCanonicalUtcTimestamp = (value: unknown): value is UtcTimestamp =>
  isSchemaValue(UtcTimestampSchema, value);

export const validateUtcTimestamp = (
  value: unknown,
): Result<UtcTimestamp, UtcTimestampValidationError> =>
  isCanonicalUtcTimestamp(value) ? success(value) : failure(invalidUtcTimestamp());

export const compareUtcTimestamps = (
  left: UtcTimestamp,
  right: UtcTimestamp,
): Result<TimestampComparison, UtcTimestampValidationError> => {
  const leftComponents = parseCanonicalUtcTimestamp(left);
  const rightComponents = parseCanonicalUtcTimestamp(right);

  if (leftComponents === undefined || rightComponents === undefined) {
    return failure(invalidUtcTimestamp());
  }

  return success(compareComponents(leftComponents, rightComponents));
};

export const isExpiredAt = (
  now: UtcTimestamp,
  expiresAt: UtcTimestamp,
): Result<boolean, UtcTimestampValidationError> => {
  const comparison = compareUtcTimestamps(now, expiresAt);
  if (!comparison.ok) {
    return comparison;
  }

  return success(comparison.value >= 0);
};

export const requireUnexpired = (
  now: UtcTimestamp,
  expiresAt: UtcTimestamp,
): Result<void, UtcTimestampValidationError | OfferExpired> => {
  const expired = isExpiredAt(now, expiresAt);
  if (!expired.ok) {
    return expired;
  }

  return expired.value ? failure(offerExpired()) : success(undefined);
};

export const isWithinHalfOpenInterval = (
  now: UtcTimestamp,
  issuedAt: UtcTimestamp,
  expiresAt: UtcTimestamp,
): Result<boolean, UtcTimestampValidationError> => {
  const intervalOrder = compareUtcTimestamps(issuedAt, expiresAt);
  if (!intervalOrder.ok) {
    return intervalOrder;
  }
  if (intervalOrder.value >= 0) {
    return failure(invalidUtcWindow());
  }

  const issuedOrder = compareUtcTimestamps(now, issuedAt);
  if (!issuedOrder.ok) {
    return issuedOrder;
  }

  const expiryOrder = compareUtcTimestamps(now, expiresAt);
  if (!expiryOrder.ok) {
    return expiryOrder;
  }

  return success(issuedOrder.value >= 0 && expiryOrder.value < 0);
};

export const validateUtcTimeWindow = (
  window: Readonly<{ end: UtcTimestamp; start: UtcTimestamp }>,
): Result<Readonly<{ end: UtcTimestamp; start: UtcTimestamp }>, UtcTimestampValidationError> => {
  const order = compareUtcTimestamps(window.start, window.end);
  if (!order.ok) {
    return order;
  }
  if (order.value >= 0) {
    return failure(invalidUtcWindow());
  }

  return success(Object.freeze({ end: window.end, start: window.start }));
};

export const isNamedIanaTimeZone = (value: unknown): value is IanaTimeZone =>
  typeof value === "string" &&
  value.length <= MAX_IANA_TIME_ZONE_LENGTH &&
  STRUCTURAL_IANA_TIME_ZONE_PATTERN.test(value);

export const validateIanaTimeZone = (
  value: unknown,
): Result<IanaTimeZone, IanaTimeZoneValidationError> =>
  isNamedIanaTimeZone(value)
    ? success(value)
    : failure(invalidTimePreference("invalid_iana_time_zone"));
