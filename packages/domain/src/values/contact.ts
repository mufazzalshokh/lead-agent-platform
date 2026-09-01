import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";

const CANONICAL_E164_PATTERN = /^\+[1-9][0-9]{1,14}(?![\s\S])/;
const MAX_E164_LENGTH = 16;

declare const canonicalE164PhoneNumberBrand: unique symbol;

export type CanonicalE164PhoneNumber = string & {
  readonly [canonicalE164PhoneNumberBrand]: "CanonicalE164PhoneNumber";
};

export type UnverifiedPhoneNumber = Readonly<{
  e164: CanonicalE164PhoneNumber;
  verificationStatus: "unverified";
}>;

export type ContactInvariantReason = "invalid_contact";

export type ContactInvariantError = InvariantViolation<ContactInvariantReason>;

export const isCanonicalE164PhoneNumber = (value: unknown): value is CanonicalE164PhoneNumber =>
  typeof value === "string" &&
  value.length <= MAX_E164_LENGTH &&
  CANONICAL_E164_PATTERN.test(value);

export const validateCanonicalE164PhoneNumber = (
  value: string,
): Result<CanonicalE164PhoneNumber, ContactInvariantError> =>
  isCanonicalE164PhoneNumber(value)
    ? success(value)
    : failure(invariantViolation("invalid_contact"));

/** Structural validity never establishes deliverability, ownership, or consent. */
export const createUnverifiedPhoneNumber = (
  value: string,
): Result<UnverifiedPhoneNumber, ContactInvariantError> => {
  const validPhone = validateCanonicalE164PhoneNumber(value);
  if (!validPhone.ok) {
    return validPhone;
  }

  return success(
    Object.freeze({
      e164: validPhone.value,
      verificationStatus: "unverified",
    }),
  );
};
