import { describe, expect, expectTypeOf, it } from "vitest";

import {
  MoneySchema,
  OrganizationIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type DomainEventPayloadByName,
  type Locale,
  type Money,
  type OrganizationId,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import {
  addMoney,
  compareMoney,
  compareUtcTimestamps,
  createFixedServicePrice,
  createFromServicePrice,
  createQuoteRequiredServicePrice,
  createRangeServicePrice,
  createUnverifiedPhoneNumber,
  isCanonicalE164PhoneNumber,
  isExpiredAt,
  isNamedIanaTimeZone,
  isOrganizationStatus,
  isSupportedLocale,
  isWithinHalfOpenInterval,
  requirePositiveMoney,
  requireSameOrganization,
  requireUnexpired,
  subtractMoney,
  validateCanonicalE164PhoneNumber,
  validateIanaTimeZone,
  validateMoney,
  validateOrganizationValues,
  validateUtcTimestamp,
  validateUtcTimeWindow,
  type CanonicalE164PhoneNumber,
  type IanaTimeZone,
  type OrganizationStatus,
  type SupportedLocale,
} from "../../packages/domain/src/index.js";

const requireUtcTimestamp = (candidate: string): UtcTimestamp => {
  if (!isSchemaValue(UtcTimestampSchema, candidate)) {
    throw new TypeError("Invalid synthetic UTC timestamp fixture");
  }

  return candidate;
};

const requireMoney = (candidate: unknown): Money => {
  if (!isSchemaValue(MoneySchema, candidate)) {
    throw new TypeError("Invalid synthetic money fixture");
  }

  return candidate;
};

const requireOrganizationId = (candidate: string): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, candidate)) {
    throw new TypeError("Invalid synthetic organization ID fixture");
  }

  return candidate;
};

const BEFORE_EXPIRY = requireUtcTimestamp("2026-09-01T09:59:59.999999999Z");
const AT_EXPIRY = requireUtcTimestamp("2026-09-01T10:00:00Z");
const AFTER_EXPIRY = requireUtcTimestamp("2026-09-01T10:00:00.000000001Z");
const ORGANIZATION_A = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c41c2b");
const ORGANIZATION_B = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c41c2c");

describe("canonical UTC ordering and expiry", () => {
  it("compares canonical instants at their full accepted fractional precision", () => {
    const validated = validateUtcTimestamp("2026-09-01T10:00:00Z");

    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expectTypeOf(validated.value).toEqualTypeOf<UtcTimestamp>();
    }
    expect(
      compareUtcTimestamps(
        requireUtcTimestamp("2026-09-01T10:00:00.1Z"),
        requireUtcTimestamp("2026-09-01T10:00:00.100000000Z"),
      ),
    ).toEqual({ ok: true, value: 0 });
    expect(
      compareUtcTimestamps(
        requireUtcTimestamp("2026-09-01T10:00:00.000000001Z"),
        requireUtcTimestamp("2026-09-01T10:00:00.000000002Z"),
      ),
    ).toEqual({ ok: true, value: -1 });
    expect(compareUtcTimestamps(AT_EXPIRY, BEFORE_EXPIRY)).toEqual({
      ok: true,
      value: 1,
    });
    expect(
      compareUtcTimestamps(
        requireUtcTimestamp("0000-01-01T00:00:00Z"),
        requireUtcTimestamp("0001-01-01T00:00:00Z"),
      ),
    ).toEqual({ ok: true, value: -1 });
  });

  it("implements the exact now-before-expiry half-open boundary", () => {
    expect(isExpiredAt(BEFORE_EXPIRY, AT_EXPIRY)).toEqual({ ok: true, value: false });
    expect(isExpiredAt(AT_EXPIRY, AT_EXPIRY)).toEqual({ ok: true, value: true });
    expect(isExpiredAt(AFTER_EXPIRY, AT_EXPIRY)).toEqual({ ok: true, value: true });
    expect(requireUnexpired(BEFORE_EXPIRY, AT_EXPIRY)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(requireUnexpired(AT_EXPIRY, AT_EXPIRY)).toEqual({
      error: { code: "offer_expired" },
      ok: false,
    });
  });

  it("validates half-open intervals and strict UTC windows", () => {
    const issuedAt = requireUtcTimestamp("2026-09-01T09:00:00Z");
    const windowInput = { end: AT_EXPIRY, start: issuedAt } as const;
    const validWindow = validateUtcTimeWindow(windowInput);

    expect(validWindow).toEqual({ ok: true, value: windowInput });
    expect(validWindow.ok && Object.isFrozen(validWindow.value)).toBe(true);
    expect(Object.isFrozen(windowInput)).toBe(false);
    expect(isWithinHalfOpenInterval(issuedAt, issuedAt, AT_EXPIRY)).toEqual({
      ok: true,
      value: true,
    });
    expect(isWithinHalfOpenInterval(AT_EXPIRY, issuedAt, AT_EXPIRY)).toEqual({
      ok: true,
      value: false,
    });
    expect(validateUtcTimeWindow({ end: AT_EXPIRY, start: AT_EXPIRY })).toEqual({
      error: { code: "invalid_time_preference", reason: "invalid_utc_window" },
      ok: false,
    });
    expect(validateUtcTimeWindow({ end: issuedAt, start: AT_EXPIRY })).toEqual({
      error: { code: "invalid_time_preference", reason: "invalid_utc_window" },
      ok: false,
    });
  });

  it.each([
    "2026-02-29T00:00:00Z",
    "2026-09-01T10:00:00z",
    "2026-09-01T10:00:00+05:00",
    "2026-09-01T10:00:00.1234567890Z",
    "2026-09-01T10:00:00Z\n",
  ])("rejects malformed or noncanonical UTC input %j", (candidate) => {
    expect(isSchemaValue(UtcTimestampSchema, candidate)).toBe(false);
    expect(validateUtcTimestamp(candidate)).toEqual({
      error: { code: "invalid_time_preference", reason: "invalid_utc_timestamp" },
      ok: false,
    });
  });
});

describe("business time-zone values", () => {
  it.each(["Asia/Tashkent", "America/Argentina/Buenos_Aires", "Etc/UTC", "UTC"])(
    "accepts structurally named time zone %s without claiming registry resolution",
    (candidate) => {
      const result = validateIanaTimeZone(candidate);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expectTypeOf(result.value).toEqualTypeOf<IanaTimeZone>();
      }
      expect(isNamedIanaTimeZone(candidate)).toBe(true);
    },
  );

  it.each([
    "",
    "+05:00",
    "GMT+5",
    "Asia",
    "Asia//Tashkent",
    "/Asia/Tashkent",
    "Asia/Tashkent\n",
    `Area/${"a".repeat(96)}`,
  ])("rejects ambiguous, offset-only, malformed, or oversized zone %j", (candidate) => {
    expect(validateIanaTimeZone(candidate)).toEqual({
      error: { code: "invalid_time_preference", reason: "invalid_iana_time_zone" },
      ok: false,
    });
  });
});

describe("Money invariants and arithmetic", () => {
  const zeroUsd = requireMoney({ amount_minor: 0, currency: "USD" });
  const oneUsd = requireMoney({ amount_minor: 1, currency: "USD" });
  const tenUsd = requireMoney({ amount_minor: 10, currency: "USD" });
  const twentyUsd = requireMoney({ amount_minor: 20, currency: "USD" });
  const tenUzs = requireMoney({ amount_minor: 10, currency: "UZS" });

  it("keeps generic Money sign-neutral and freezes a new validated copy", () => {
    const negative = requireMoney({ amount_minor: -1, currency: "USD" });
    const result = validateMoney(zeroUsd);

    expect(result).toEqual({ ok: true, value: zeroUsd });
    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(zeroUsd)).toBe(false);
    expect(validateMoney(negative).ok).toBe(true);
    expect(requirePositiveMoney(oneUsd).ok).toBe(true);
    expect(requirePositiveMoney(zeroUsd)).toEqual({
      error: { code: "invariant_violation", reason: "money_must_be_positive" },
      ok: false,
    });
    expect(requirePositiveMoney(negative)).toEqual({
      error: { code: "invariant_violation", reason: "money_must_be_positive" },
      ok: false,
    });
  });

  it("compares, adds, and subtracts same-currency integer minor units", () => {
    expect(compareMoney(tenUsd, twentyUsd)).toEqual({ ok: true, value: -1 });
    expect(compareMoney(tenUsd, tenUsd)).toEqual({ ok: true, value: 0 });
    expect(compareMoney(twentyUsd, tenUsd)).toEqual({ ok: true, value: 1 });
    expect(addMoney(tenUsd, twentyUsd)).toEqual({
      ok: true,
      value: { amount_minor: 30, currency: "USD" },
    });
    expect(subtractMoney(tenUsd, twentyUsd)).toEqual({
      ok: true,
      value: { amount_minor: -10, currency: "USD" },
    });

    const sum = addMoney(tenUsd, twentyUsd);
    if (sum.ok) {
      const canonicalMoney: Money = sum.value;
      expectTypeOf(canonicalMoney).toEqualTypeOf<Money>();
      expect(Object.isFrozen(sum.value)).toBe(true);
    }
  });

  it("rejects cross-currency operations and safe-integer overflow", () => {
    for (const result of [
      compareMoney(tenUsd, tenUzs),
      addMoney(tenUsd, tenUzs),
      subtractMoney(tenUsd, tenUzs),
    ]) {
      expect(result).toEqual({
        error: { code: "invariant_violation", reason: "currency_mismatch" },
        ok: false,
      });
    }

    const maximumUsd = requireMoney({
      amount_minor: Number.MAX_SAFE_INTEGER,
      currency: "USD",
    });
    expect(addMoney(maximumUsd, oneUsd)).toEqual({
      error: { code: "invariant_violation", reason: "money_overflow" },
      ok: false,
    });
  });

  it.each([
    { amount_minor: 1.5, currency: "USD" },
    { amount_minor: Number.MAX_SAFE_INTEGER + 1, currency: "USD" },
    { amount_minor: 1, currency: "usd" },
    { amount_minor: 1, currency: "USD\n" },
  ])("rejects noncanonical runtime money input %j", (candidate) => {
    expect(validateMoney(candidate)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_money" },
      ok: false,
    });
  });
});

describe("service-price values", () => {
  const zeroUsd = requireMoney({ amount_minor: 0, currency: "USD" });
  const tenUsd = requireMoney({ amount_minor: 10, currency: "USD" });
  const twentyUsd = requireMoney({ amount_minor: 20, currency: "USD" });
  const tenUzs = requireMoney({ amount_minor: 10, currency: "UZS" });

  it("constructs fixed, from, and quote-required forms without extra policy", () => {
    expect(createFixedServicePrice(tenUsd)).toEqual({
      ok: true,
      value: { amount: tenUsd, priceType: "fixed" },
    });
    expect(createFromServicePrice(zeroUsd)).toEqual({
      ok: true,
      value: { minimum: zeroUsd, priceType: "from" },
    });

    const quoteRequired = createQuoteRequiredServicePrice();
    expect(quoteRequired).toEqual({ priceType: "quote_required" });
    expect(Object.keys(quoteRequired)).toEqual(["priceType"]);
    expect(Object.isFrozen(quoteRequired)).toBe(true);
    expect(quoteRequired).not.toHaveProperty("amount");
    expect(quoteRequired).not.toHaveProperty("minimum");
    expect(quoteRequired).not.toHaveProperty("maximum");
  });

  it("accepts equal and increasing ranges and freezes copied amounts", () => {
    const equal = createRangeServicePrice(tenUsd, tenUsd);
    const increasing = createRangeServicePrice(tenUsd, twentyUsd);

    expect(equal.ok).toBe(true);
    expect(increasing.ok).toBe(true);
    if (increasing.ok) {
      expect(increasing.value.priceType).toBe("range");
      expect(Object.isFrozen(increasing.value)).toBe(true);
      expect(Object.isFrozen(increasing.value.minimum)).toBe(true);
      expect(Object.isFrozen(increasing.value.maximum)).toBe(true);
    }
  });

  it("rejects reversed and cross-currency ranges", () => {
    expect(createRangeServicePrice(twentyUsd, tenUsd)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_service_price" },
      ok: false,
    });
    expect(createRangeServicePrice(tenUsd, tenUzs)).toEqual({
      error: { code: "invariant_violation", reason: "currency_mismatch" },
      ok: false,
    });
  });
});

describe("organization and tenant structural values", () => {
  it("validates accepted status, locale, ID, and named-zone values without lifecycle logic", () => {
    const input = {
      defaultLocale: "uz",
      defaultTimeZone: "Asia/Tashkent",
      organizationId: ORGANIZATION_A,
      status: "active",
    } as const;
    const result = validateOrganizationValues(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const organizationId: OrganizationId = result.value.organizationId;
      expect(organizationId).toBe(ORGANIZATION_A);
      expect(result.value).toEqual(input);
      expect(Object.isFrozen(result.value)).toBe(true);
      expectTypeOf(result.value.defaultTimeZone).toEqualTypeOf<IanaTimeZone>();
      expectTypeOf(result.value.defaultLocale).toEqualTypeOf<Locale>();
      expectTypeOf(result.value.status).toEqualTypeOf<OrganizationStatus>();
    }
    expectTypeOf<SupportedLocale>().toEqualTypeOf<Locale>();
    expectTypeOf<OrganizationStatus>().toEqualTypeOf<
      DomainEventPayloadByName["organization.created"]["organization_status"]
    >();
    expect(Object.isFrozen(input)).toBe(false);
    expect(isOrganizationStatus("suspended")).toBe(true);
    expect(isOrganizationStatus("closed")).toBe(true);
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("de")).toBe(false);
  });

  it.each([
    {
      defaultLocale: "uz",
      defaultTimeZone: "Asia/Tashkent",
      organizationId: "550e8400-e29b-41d4-a716-446655440000",
      status: "active",
    },
    {
      defaultLocale: "de",
      defaultTimeZone: "Asia/Tashkent",
      organizationId: ORGANIZATION_A,
      status: "active",
    },
    {
      defaultLocale: "uz",
      defaultTimeZone: "+05:00",
      organizationId: ORGANIZATION_A,
      status: "active",
    },
    {
      defaultLocale: "uz",
      defaultTimeZone: "Asia/Tashkent",
      organizationId: ORGANIZATION_A,
      status: "disabled",
    },
  ])("rejects invalid organization value input without echoing it %#", (candidate) => {
    const result = validateOrganizationValues(candidate);

    expect(result).toEqual({
      error: { code: "invariant_violation", reason: "invalid_organization" },
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain(candidate.organizationId);
    expect(JSON.stringify(result)).not.toContain(candidate.defaultTimeZone);
  });

  it("checks same-organization equality without claiming authorization", () => {
    expect(requireSameOrganization(ORGANIZATION_A, ORGANIZATION_A)).toEqual({
      ok: true,
      value: undefined,
    });

    const mismatch = requireSameOrganization(ORGANIZATION_A, ORGANIZATION_B);
    const serialized = JSON.stringify(mismatch);

    expect(mismatch).toEqual({
      error: { code: "tenant_scope_violation" },
      ok: false,
    });
    expect(serialized).not.toContain(ORGANIZATION_A);
    expect(serialized).not.toContain(ORGANIZATION_B);
    expect(serialized).not.toContain("authorized");
  });
});

describe("conservative contact values", () => {
  it("accepts only an already-canonical E.164 form and marks it unverified", () => {
    const candidate = "+998901234567";
    const first = createUnverifiedPhoneNumber(candidate);
    const second = createUnverifiedPhoneNumber(candidate);

    expect(first).toEqual(second);
    expect(first).toEqual({
      ok: true,
      value: { e164: candidate, verificationStatus: "unverified" },
    });
    expect(first.ok && Object.isFrozen(first.value)).toBe(true);
    expect(candidate).toBe("+998901234567");
    if (first.ok) {
      expectTypeOf(first.value.e164).toEqualTypeOf<CanonicalE164PhoneNumber>();
      expect(first.value).not.toHaveProperty("verifiedAt");
      expect(first.value).not.toHaveProperty("owner");
      expect(first.value).not.toHaveProperty("organizationId");
    }
  });

  it("enforces E.164 structural length without guessing country semantics", () => {
    expect(isCanonicalE164PhoneNumber("+12")).toBe(true);
    expect(isCanonicalE164PhoneNumber(`+${"1".repeat(15)}`)).toBe(true);
    expect(isCanonicalE164PhoneNumber(`+${"1".repeat(16)}`)).toBe(false);
  });

  it.each([
    "",
    "998901234567",
    "+098901234567",
    "+998 90 123 45 67",
    "+998-90-123-45-67",
    "+998901234567x1",
    "+１２３４５６７８",
    "\u202e+998901234567",
    "+998901234567\n",
    `+${"1".repeat(16)}`,
  ])("rejects noncanonical contact input without leaking it %j", (candidate) => {
    const result = validateCanonicalE164PhoneNumber(candidate);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      error: { code: "invariant_violation", reason: "invalid_contact" },
      ok: false,
    });
    if (candidate.length > 0) {
      expect(serialized).not.toContain(candidate);
    }
  });
});
