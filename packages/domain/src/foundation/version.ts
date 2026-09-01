import {
  AggregateVersionSchema,
  ResourceVersionSchema,
  isSchemaValue,
  type AggregateVersion,
  type ResourceVersion,
} from "@lead-agent/contracts";

import {
  concurrencyConflict,
  invariantViolation,
  type ConcurrencyConflict,
  type InvariantViolation,
} from "./errors.js";
import { failure, success, type Result } from "./result.js";

const INITIAL_AGGREGATE_VERSION: AggregateVersion = 1;
const INITIAL_RESOURCE_VERSION: ResourceVersion = 1;
const MAX_VERSION = Number.MAX_SAFE_INTEGER;

type InvalidVersion = InvariantViolation<"invalid_version">;
type VersionOverflow = InvariantViolation<"version_overflow">;
type VersionFailure = InvalidVersion | VersionOverflow;

type VersionPredicate<Version extends number> = (value: unknown) => value is Version;

const isAggregateVersion = (value: unknown): value is AggregateVersion =>
  isSchemaValue(AggregateVersionSchema, value);

const isResourceVersion = (value: unknown): value is ResourceVersion =>
  isSchemaValue(ResourceVersionSchema, value);

const validateVersion = <Version extends number>(
  value: unknown,
  isVersion: VersionPredicate<Version>,
): Result<Version, InvalidVersion> =>
  isVersion(value) ? success(value) : failure(invariantViolation("invalid_version"));

const checkExpectedVersion = <Version extends number>(
  currentVersion: unknown,
  expectedVersion: unknown,
  isVersion: VersionPredicate<Version>,
): Result<Version, InvalidVersion | ConcurrencyConflict<Version>> => {
  const validCurrentVersion = validateVersion(currentVersion, isVersion);
  if (!validCurrentVersion.ok) {
    return validCurrentVersion;
  }

  const validExpectedVersion = validateVersion(expectedVersion, isVersion);
  if (!validExpectedVersion.ok) {
    return validExpectedVersion;
  }

  return validCurrentVersion.value === validExpectedVersion.value
    ? success(validCurrentVersion.value)
    : failure(concurrencyConflict(validCurrentVersion.value));
};

const incrementVersion = <Version extends number>(
  currentVersion: unknown,
  isVersion: VersionPredicate<Version>,
): Result<Version, VersionFailure> => {
  const validCurrentVersion = validateVersion(currentVersion, isVersion);
  if (!validCurrentVersion.ok) {
    return validCurrentVersion;
  }

  if (validCurrentVersion.value === MAX_VERSION) {
    return failure(invariantViolation("version_overflow"));
  }

  return validateVersion(validCurrentVersion.value + 1, isVersion);
};

const advanceVersion = <Version extends number>(
  currentVersion: unknown,
  expectedVersion: unknown,
  isVersion: VersionPredicate<Version>,
): Result<Version, VersionFailure | ConcurrencyConflict<Version>> => {
  const matchingVersion = checkExpectedVersion(currentVersion, expectedVersion, isVersion);
  if (!matchingVersion.ok) {
    return matchingVersion;
  }

  return incrementVersion(matchingVersion.value, isVersion);
};

export const initialAggregateVersion = (): AggregateVersion => INITIAL_AGGREGATE_VERSION;

export const validateAggregateVersion = (
  value: unknown,
): Result<AggregateVersion, InvalidVersion> => validateVersion(value, isAggregateVersion);

export const checkExpectedAggregateVersion = (
  currentVersion: AggregateVersion,
  expectedVersion: AggregateVersion,
): Result<AggregateVersion, InvalidVersion | ConcurrencyConflict<AggregateVersion>> =>
  checkExpectedVersion(currentVersion, expectedVersion, isAggregateVersion);

export const incrementAggregateVersion = (
  currentVersion: AggregateVersion,
): Result<AggregateVersion, VersionFailure> => incrementVersion(currentVersion, isAggregateVersion);

export const advanceAggregateVersion = (
  currentVersion: AggregateVersion,
  expectedVersion: AggregateVersion,
): Result<AggregateVersion, VersionFailure | ConcurrencyConflict<AggregateVersion>> =>
  advanceVersion(currentVersion, expectedVersion, isAggregateVersion);

export const initialResourceVersion = (): ResourceVersion => INITIAL_RESOURCE_VERSION;

export const validateResourceVersion = (value: unknown): Result<ResourceVersion, InvalidVersion> =>
  validateVersion(value, isResourceVersion);

export const checkExpectedResourceVersion = (
  currentVersion: ResourceVersion,
  expectedVersion: ResourceVersion,
): Result<ResourceVersion, InvalidVersion | ConcurrencyConflict<ResourceVersion>> =>
  checkExpectedVersion(currentVersion, expectedVersion, isResourceVersion);

export const incrementResourceVersion = (
  currentVersion: ResourceVersion,
): Result<ResourceVersion, VersionFailure> => incrementVersion(currentVersion, isResourceVersion);

export const advanceResourceVersion = (
  currentVersion: ResourceVersion,
  expectedVersion: ResourceVersion,
): Result<ResourceVersion, VersionFailure | ConcurrencyConflict<ResourceVersion>> =>
  advanceVersion(currentVersion, expectedVersion, isResourceVersion);
