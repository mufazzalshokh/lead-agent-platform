import { MoneySchema, isSchemaValue, type Money } from "@lead-agent/contracts";

import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";

export type MoneyInvariantReason =
  "currency_mismatch" | "invalid_money" | "money_must_be_positive" | "money_overflow";

export type MoneyInvariantError = InvariantViolation<MoneyInvariantReason>;

const immutableMoney = (money: Readonly<Money>): Readonly<Money> =>
  Object.freeze({
    amount_minor: money.amount_minor,
    currency: money.currency,
  });

export const validateMoney = (value: unknown): Result<Readonly<Money>, MoneyInvariantError> =>
  isSchemaValue(MoneySchema, value)
    ? success(immutableMoney(value))
    : failure(invariantViolation("invalid_money"));

const requireMatchingCurrency = (
  left: Readonly<Money>,
  right: Readonly<Money>,
): Result<void, MoneyInvariantError> =>
  left.currency === right.currency
    ? success(undefined)
    : failure(invariantViolation("currency_mismatch"));

export const compareMoney = (
  left: Readonly<Money>,
  right: Readonly<Money>,
): Result<-1 | 0 | 1, MoneyInvariantError> => {
  const validLeft = validateMoney(left);
  if (!validLeft.ok) {
    return validLeft;
  }

  const validRight = validateMoney(right);
  if (!validRight.ok) {
    return validRight;
  }

  const matchingCurrency = requireMatchingCurrency(validLeft.value, validRight.value);
  if (!matchingCurrency.ok) {
    return matchingCurrency;
  }

  if (validLeft.value.amount_minor < validRight.value.amount_minor) {
    return success(-1);
  }
  if (validLeft.value.amount_minor > validRight.value.amount_minor) {
    return success(1);
  }
  return success(0);
};

const calculateMoney = (
  left: Readonly<Money>,
  right: Readonly<Money>,
  operation: "add" | "subtract",
): Result<Readonly<Money>, MoneyInvariantError> => {
  const validLeft = validateMoney(left);
  if (!validLeft.ok) {
    return validLeft;
  }

  const validRight = validateMoney(right);
  if (!validRight.ok) {
    return validRight;
  }

  const matchingCurrency = requireMatchingCurrency(validLeft.value, validRight.value);
  if (!matchingCurrency.ok) {
    return matchingCurrency;
  }

  const amountMinor =
    operation === "add"
      ? validLeft.value.amount_minor + validRight.value.amount_minor
      : validLeft.value.amount_minor - validRight.value.amount_minor;

  if (!Number.isSafeInteger(amountMinor)) {
    return failure(invariantViolation("money_overflow"));
  }

  return success(
    immutableMoney({
      amount_minor: amountMinor,
      currency: validLeft.value.currency,
    }),
  );
};

export const addMoney = (
  left: Readonly<Money>,
  right: Readonly<Money>,
): Result<Readonly<Money>, MoneyInvariantError> => calculateMoney(left, right, "add");

export const subtractMoney = (
  left: Readonly<Money>,
  right: Readonly<Money>,
): Result<Readonly<Money>, MoneyInvariantError> => calculateMoney(left, right, "subtract");

export const requirePositiveMoney = (
  money: Readonly<Money>,
): Result<Readonly<Money>, MoneyInvariantError> => {
  const validMoney = validateMoney(money);
  if (!validMoney.ok) {
    return validMoney;
  }

  return validMoney.value.amount_minor > 0
    ? validMoney
    : failure(invariantViolation("money_must_be_positive"));
};
