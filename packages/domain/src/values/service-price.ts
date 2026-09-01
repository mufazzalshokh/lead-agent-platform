import type { Money } from "@lead-agent/contracts";

import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";
import { compareMoney, validateMoney, type MoneyInvariantError } from "./money.js";

export type FixedServicePrice = Readonly<{
  amount: Readonly<Money>;
  priceType: "fixed";
}>;

export type FromServicePrice = Readonly<{
  minimum: Readonly<Money>;
  priceType: "from";
}>;

export type RangeServicePrice = Readonly<{
  maximum: Readonly<Money>;
  minimum: Readonly<Money>;
  priceType: "range";
}>;

export type QuoteRequiredServicePrice = Readonly<{
  priceType: "quote_required";
}>;

export type ServicePrice =
  FixedServicePrice | FromServicePrice | QuoteRequiredServicePrice | RangeServicePrice;

export type ServicePriceInvariantReason = "invalid_service_price";

export type ServicePriceInvariantError =
  InvariantViolation<ServicePriceInvariantReason> | MoneyInvariantError;

export const createFixedServicePrice = (
  amount: Readonly<Money>,
): Result<FixedServicePrice, MoneyInvariantError> => {
  const validAmount = validateMoney(amount);
  if (!validAmount.ok) {
    return validAmount;
  }

  return success(Object.freeze({ amount: validAmount.value, priceType: "fixed" }));
};

export const createFromServicePrice = (
  minimum: Readonly<Money>,
): Result<FromServicePrice, MoneyInvariantError> => {
  const validMinimum = validateMoney(minimum);
  if (!validMinimum.ok) {
    return validMinimum;
  }

  return success(Object.freeze({ minimum: validMinimum.value, priceType: "from" }));
};

export const createRangeServicePrice = (
  minimum: Readonly<Money>,
  maximum: Readonly<Money>,
): Result<RangeServicePrice, ServicePriceInvariantError> => {
  const validMinimum = validateMoney(minimum);
  if (!validMinimum.ok) {
    return validMinimum;
  }

  const validMaximum = validateMoney(maximum);
  if (!validMaximum.ok) {
    return validMaximum;
  }

  const order = compareMoney(validMinimum.value, validMaximum.value);
  if (!order.ok) {
    return order;
  }
  if (order.value > 0) {
    return failure(invariantViolation("invalid_service_price"));
  }

  return success(
    Object.freeze({
      maximum: validMaximum.value,
      minimum: validMinimum.value,
      priceType: "range",
    }),
  );
};

export const createQuoteRequiredServicePrice = (): QuoteRequiredServicePrice =>
  Object.freeze({ priceType: "quote_required" });
