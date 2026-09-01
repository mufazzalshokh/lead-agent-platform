import {
  DomainEventPayloadSchemas,
  LocaleSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type DomainEventPayloadByName,
  type Locale,
  type OrganizationId,
} from "@lead-agent/contracts";

import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";
import { validateIanaTimeZone, type IanaTimeZone } from "./time.js";

const OrganizationStatusSchema =
  DomainEventPayloadSchemas["organization.created"].properties.organization_status;

export type OrganizationStatus =
  DomainEventPayloadByName["organization.created"]["organization_status"];
export type SupportedLocale = Locale;

type OrganizationValuesInput = Readonly<{
  defaultLocale: unknown;
  defaultTimeZone: unknown;
  organizationId: unknown;
  status: unknown;
}>;

export type OrganizationValues = Readonly<{
  defaultLocale: Locale;
  defaultTimeZone: IanaTimeZone;
  organizationId: OrganizationId;
  status: OrganizationStatus;
}>;

export type OrganizationInvariantReason = "invalid_organization";

export type OrganizationInvariantError = InvariantViolation<OrganizationInvariantReason>;

export const isUuidV7 = (value: unknown): value is OrganizationId =>
  isSchemaValue(OrganizationIdSchema, value);

export const isOrganizationStatus = (value: unknown): value is OrganizationStatus =>
  isSchemaValue(OrganizationStatusSchema, value);

export const isSupportedLocale = (value: unknown): value is Locale =>
  isSchemaValue(LocaleSchema, value);

export const validateOrganizationId = (
  value: unknown,
): Result<OrganizationId, OrganizationInvariantError> =>
  isUuidV7(value) ? success(value) : failure(invariantViolation("invalid_organization"));

export const validateOrganizationStatus = (
  value: unknown,
): Result<OrganizationStatus, OrganizationInvariantError> =>
  isOrganizationStatus(value)
    ? success(value)
    : failure(invariantViolation("invalid_organization"));

export const validateSupportedLocale = (
  value: unknown,
): Result<Locale, OrganizationInvariantError> =>
  isSupportedLocale(value) ? success(value) : failure(invariantViolation("invalid_organization"));

export const validateOrganizationValues = (
  values: OrganizationValuesInput,
): Result<OrganizationValues, OrganizationInvariantError> => {
  const validOrganizationId = validateOrganizationId(values.organizationId);
  const validStatus = validateOrganizationStatus(values.status);
  const validLocale = validateSupportedLocale(values.defaultLocale);

  if (!validOrganizationId.ok || !validStatus.ok || !validLocale.ok) {
    return failure(invariantViolation("invalid_organization"));
  }

  const validTimeZone = validateIanaTimeZone(values.defaultTimeZone);
  if (!validTimeZone.ok) {
    return failure(invariantViolation("invalid_organization"));
  }

  return success(
    Object.freeze({
      defaultLocale: validLocale.value,
      defaultTimeZone: validTimeZone.value,
      organizationId: validOrganizationId.value,
      status: validStatus.value,
    }),
  );
};
