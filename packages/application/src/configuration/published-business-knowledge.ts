import {
  PublishedBusinessKnowledgeRequestSchema,
  PublishedBusinessKnowledgeV2Schema,
  UtcTimestampSchema,
  isSchemaValue,
  type Locale,
  type LocationId,
  type PublishedBusinessKnowledgeV2,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import {
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
} from "@lead-agent/security";

import type { ConfigurationResult, PublishedBusinessKnowledgeReader } from "./ports.js";

export type PublishedBusinessKnowledgeStoreQuery = Readonly<{
  authorization: AuthorizationContext;
  effectiveAt: UtcTimestamp;
  locale: Locale;
  /** Null means every active Location visible to an all-location actor. */
  locationIds: readonly LocationId[] | null;
}>;

export interface PublishedBusinessKnowledgeStore {
  readPublishedBusinessKnowledge(
    query: PublishedBusinessKnowledgeStoreQuery,
  ): Promise<ConfigurationResult<PublishedBusinessKnowledgeV2>>;
}

const failure = <Value>(
  code: "business_rule_failed" | "permission_denied" | "resource_not_found" | "validation_failed",
): ConfigurationResult<Value> => Object.freeze({ error: Object.freeze({ code }), ok: false });

const sameMembers = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
};

const isProjectionSafe = (
  value: PublishedBusinessKnowledgeV2,
  projectedLocationIds: readonly LocationId[] | null,
): boolean => {
  const visibleLocations = value.locations.map((location) => location.location_id);
  const visibleLocationSet = new Set(visibleLocations);
  if (
    projectedLocationIds !== null &&
    visibleLocations.some((locationId) => !projectedLocationIds.includes(locationId))
  ) {
    return false;
  }

  const visibleServiceIds = new Set(value.services.map((service) => service.service_id));
  for (const service of value.services) {
    const offeringLocations = service.location_offerings.map((offering) => offering.location_id);
    const resolutionLocations = service.price_resolutions.map(
      (resolution) => resolution.location_id,
    );
    if (
      (projectedLocationIds !== null && offeringLocations.length === 0) ||
      offeringLocations.some((locationId) => !visibleLocationSet.has(locationId)) ||
      !sameMembers(resolutionLocations, offeringLocations)
    ) {
      return false;
    }
    for (const resolution of service.price_resolutions) {
      if (
        resolution.prices.some(
          (price) => price.location_id !== null && price.location_id !== resolution.location_id,
        )
      ) {
        return false;
      }
    }
  }

  return value.faqs.every(
    (faq) =>
      (faq.location_id === null || visibleLocationSet.has(faq.location_id)) &&
      (faq.service_id === null || visibleServiceIds.has(faq.service_id)),
  );
};

export const createPublishedBusinessKnowledgeReader = (
  store: PublishedBusinessKnowledgeStore,
): PublishedBusinessKnowledgeReader => ({
  getPublishedBusinessKnowledge: async (query) => {
    if (
      !isAuthorizationContext(query.authorization) ||
      !hasPermission(query.authorization.role, "configuration.read")
    ) {
      return failure("permission_denied");
    }
    if (
      !isSchemaValue(PublishedBusinessKnowledgeRequestSchema, query.input) ||
      !isSchemaValue(UtcTimestampSchema, query.input.effective_at)
    ) {
      return failure("validation_failed");
    }
    const effectiveAt = query.input.effective_at;

    const requestedLocationIds = query.input.location_ids;
    if (
      query.authorization.locationScope === "restricted" &&
      requestedLocationIds?.some(
        (locationId) => !query.authorization.allowedLocationIds.includes(locationId),
      )
    ) {
      return failure("resource_not_found");
    }

    const projectedLocationIds =
      requestedLocationIds === undefined
        ? query.authorization.locationScope === "restricted"
          ? [...query.authorization.allowedLocationIds].sort()
          : null
        : [...requestedLocationIds].sort();
    const result = await store.readPublishedBusinessKnowledge(
      Object.freeze({
        authorization: query.authorization,
        effectiveAt,
        locale: query.input.locale,
        locationIds: projectedLocationIds === null ? null : Object.freeze(projectedLocationIds),
      }),
    );
    if (!result.ok) return result;
    if (
      !isSchemaValue(PublishedBusinessKnowledgeV2Schema, result.value) ||
      result.value.effective_at !== effectiveAt ||
      result.value.locale !== query.input.locale ||
      !isProjectionSafe(result.value, projectedLocationIds)
    ) {
      return failure("business_rule_failed");
    }
    return result;
  },
});
