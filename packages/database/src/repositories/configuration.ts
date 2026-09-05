import type {
  ChannelConnectionId,
  CurrencyCode,
  LocationId,
  MembershipId,
  OrganizationId,
  ResourceId,
  ResourceVersion,
  ServiceId,
  UtcTimestamp,
} from "@lead-agent/contracts";
import type { TenantDbSession } from "../runtime/tenant.js";
import type { QueryResultRow } from "pg";

import {
  createRepositoryPage,
  executeTenantRead,
  executeTenantRootRead,
  mapAggregateVersion,
  mapChannelConnectionId,
  mapCurrencyCode,
  mapEnum,
  mapJsonObject,
  mapLocaleMap,
  mapLocationId,
  mapMembershipId,
  mapNullableIdentifier,
  mapNullableString,
  mapNullableUtcTimestamp,
  mapOrganizationId,
  mapPositiveInteger,
  mapResourceId,
  mapSafeBigInt,
  mapServiceId,
  mapString,
  mapUtcTimestamp,
  requireFound,
  requireLocalDateRange,
  resolvePageLimit,
  type LocaleMap,
  type RepositoryPage,
  type RepositoryPageRequest,
} from "./shared.js";

const ORGANIZATION_STATUSES = ["active", "suspended", "closed"] as const;
const CONFIGURATION_STATUSES = ["active", "inactive"] as const;
const MEMBERSHIP_ROLES = ["owner", "admin", "staff", "analyst"] as const;
const MEMBERSHIP_STATUSES = ["invited", "active", "suspended", "revoked"] as const;
const LOCATION_SCOPES = ["all", "restricted"] as const;
const CHANNEL_TYPES = ["widget", "telegram", "instagram", "whatsapp"] as const;
const CHANNEL_STATUSES = ["pending", "active", "disabled", "revoked"] as const;
const WIDGET_SESSION_STATUSES = ["active", "expired", "revoked"] as const;
const WIDGET_ORIGIN_STATUSES = ["active", "disabled"] as const;
const WIDGET_ORIGIN_MATCH_TYPES = ["exact", "subdomain_wildcard"] as const;
const PRICE_TYPES = ["fixed", "from", "range", "quote_required"] as const;
const POLICY_TYPES = ["qualification", "booking", "handoff", "safety", "consent"] as const;
const RETENTION_STATUSES = ["draft", "published", "retired"] as const;
const EXPIRY_ACTIONS = ["purge", "anonymize", "aggregate"] as const;

export type OrganizationConfiguration = Readonly<{
  organizationId: OrganizationId;
  slug: string;
  displayName: string;
  status: (typeof ORGANIZATION_STATUSES)[number];
  defaultLocale: "en" | "ru" | "uz";
  defaultTimeZone: string;
  currentRetentionPolicyId: ResourceId | null;
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type MembershipRecord = Readonly<{
  membershipId: MembershipId;
  userId: ResourceId;
  role: (typeof MEMBERSHIP_ROLES)[number];
  status: (typeof MEMBERSHIP_STATUSES)[number];
  locationScope: (typeof LOCATION_SCOPES)[number];
  version: ResourceVersion;
}>;

export type LocationConfiguration = Readonly<{
  locationId: LocationId;
  code: string;
  status: (typeof CONFIGURATION_STATUSES)[number];
  currentVersionId: ResourceId | null;
  version: ResourceVersion;
  name: LocaleMap | null;
  address: LocaleMap | null;
  publicContact: Readonly<Record<string, unknown>> | null;
  timeZone: string | null;
  publishedAt: UtcTimestamp | null;
}>;

export type LocationKeyset = Readonly<{ code: string; locationId: LocationId }>;

export type LocationHour = Readonly<{
  hourId: ResourceId;
  dayOfWeek: number;
  opensAtLocal: string;
  closesAtLocal: string;
  sequenceNo: number;
}>;

export type LocationHourKeyset = Readonly<{
  dayOfWeek: number;
  sequenceNo: number;
  hourId: ResourceId;
}>;

export type LocationClosure = Readonly<{
  closureId: ResourceId;
  localDate: string;
  kind: "closed" | "override";
  opensAtLocal: string | null;
  closesAtLocal: string | null;
  reason: LocaleMap;
}>;

export type LocationClosureKeyset = Readonly<{
  localDate: string;
  closureId: ResourceId;
}>;

export type ServiceConfiguration = Readonly<{
  serviceId: ServiceId;
  code: string;
  status: (typeof CONFIGURATION_STATUSES)[number];
  currentVersionId: ResourceId | null;
  version: ResourceVersion;
  name: LocaleMap | null;
  description: LocaleMap | null;
  disclaimer: LocaleMap | null;
  durationGuidanceMinutes: number | null;
  publishedAt: UtcTimestamp | null;
}>;

export type ServiceKeyset = Readonly<{ code: string; serviceId: ServiceId }>;

export type ServiceLocation = Readonly<{
  locationId: LocationId;
  effectiveFrom: UtcTimestamp;
  effectiveTo: UtcTimestamp | null;
}>;

export type ServiceLocationKeyset = Readonly<{ locationId: LocationId }>;

export type ServicePrice = Readonly<{
  priceId: ResourceId;
  locationId: LocationId | null;
  priceType: (typeof PRICE_TYPES)[number];
  currency: CurrencyCode;
  minAmountMinor: number | null;
  maxAmountMinor: number | null;
  displayText: LocaleMap;
  effectiveFrom: UtcTimestamp;
  effectiveTo: UtcTimestamp | null;
  versionNo: number;
}>;

export type ServicePriceKeyset = Readonly<{
  effectiveFrom: UtcTimestamp;
  priceId: ResourceId;
}>;

export type PublishedFaq = Readonly<{
  faqId: ResourceId;
  faqKey: string;
  versionNo: number;
  serviceId: ServiceId | null;
  locationId: LocationId | null;
  question: LocaleMap;
  answer: LocaleMap;
  effectiveFrom: UtcTimestamp;
  effectiveTo: UtcTimestamp | null;
}>;

export type FaqKeyset = Readonly<{ faqKey: string; faqId: ResourceId }>;

export type PublishedBusinessPolicy = Readonly<{
  policyId: ResourceId;
  policyKey: string;
  versionNo: number;
  policyType: (typeof POLICY_TYPES)[number];
  schemaVersion: number;
  rules: Readonly<Record<string, unknown>>;
  effectiveFrom: UtcTimestamp;
  effectiveTo: UtcTimestamp | null;
}>;

export type PolicyKeyset = Readonly<{ policyKey: string; policyId: ResourceId }>;

export type ChannelConnectionRecord = Readonly<{
  channelConnectionId: ChannelConnectionId;
  channelType: (typeof CHANNEL_TYPES)[number];
  status: (typeof CHANNEL_STATUSES)[number];
  displayName: string;
  configuration: Readonly<Record<string, unknown>>;
  verifiedAt: UtcTimestamp | null;
  credentialVersion: number;
  version: ResourceVersion;
}>;

export type WidgetSessionRecord = Readonly<{
  widgetSessionId: ResourceId;
  channelConnectionId: ChannelConnectionId;
  allowedOriginId: ResourceId;
  status: (typeof WIDGET_SESSION_STATUSES)[number];
  requestedLocale: "en" | "ru" | "uz";
  contactId: ResourceId | null;
  conversationId: ResourceId | null;
  issuedAt: UtcTimestamp;
  lastSeenAt: UtcTimestamp;
  expiresAt: UtcTimestamp;
  revokedAt: UtcTimestamp | null;
}>;

export type WidgetAllowedOriginRecord = Readonly<{
  allowedOriginId: ResourceId;
  channelConnectionId: ChannelConnectionId;
  matchType: (typeof WIDGET_ORIGIN_MATCH_TYPES)[number];
  scheme: "https";
  normalizedHost: string;
  port: number | null;
  status: (typeof WIDGET_ORIGIN_STATUSES)[number];
  createdByUserId: ResourceId;
  createdAt: UtcTimestamp;
}>;

export type WidgetAllowedOriginKeyset = Readonly<{
  normalizedHost: string;
  allowedOriginId: ResourceId;
}>;

export type RetentionPolicyRecord = Readonly<{
  retentionPolicyId: ResourceId;
  versionNo: number;
  status: (typeof RETENTION_STATUSES)[number];
  jurisdictionProfile: string;
  effectiveFrom: UtcTimestamp | null;
}>;

export type RetentionRule = Readonly<{
  ruleId: ResourceId;
  dataClass: string;
  purpose: string;
  triggerEvent: string;
  durationDays: number;
  expiryAction: (typeof EXPIRY_ACTIONS)[number];
  jurisdictionReference: string;
  legalBasisReference: string;
}>;

export type RetentionRuleKeyset = Readonly<{
  dataClass: string;
  purpose: string;
  triggerEvent: string;
  ruleId: ResourceId;
}>;

type OrganizationRow = QueryResultRow & {
  id: unknown;
  slug: unknown;
  display_name: unknown;
  status: unknown;
  default_locale: unknown;
  default_time_zone: unknown;
  current_retention_policy_id: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapOrganization = (row: OrganizationRow): OrganizationConfiguration =>
  Object.freeze({
    organizationId: mapOrganizationId(row.id),
    slug: mapString(row.slug),
    displayName: mapString(row.display_name),
    status: mapEnum(row.status, ORGANIZATION_STATUSES),
    defaultLocale: mapEnum(row.default_locale, ["en", "ru", "uz"] as const),
    defaultTimeZone: mapString(row.default_time_zone),
    currentRetentionPolicyId: mapNullableIdentifier(row.current_retention_policy_id),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

type LocationRow = QueryResultRow & {
  id: unknown;
  code: unknown;
  status: unknown;
  current_version_id: unknown;
  version: unknown;
  version_id: unknown;
  name_i18n: unknown;
  address_i18n: unknown;
  public_contact_jsonb: unknown;
  time_zone: unknown;
  published_at: unknown;
};

const mapLocation = (row: LocationRow): LocationConfiguration => {
  const hasCurrentVersion = row.version_id !== null;
  return Object.freeze({
    locationId: mapLocationId(row.id),
    code: mapString(row.code),
    status: mapEnum(row.status, CONFIGURATION_STATUSES),
    currentVersionId: mapNullableIdentifier(row.current_version_id),
    version: mapAggregateVersion(row.version),
    name: hasCurrentVersion ? mapLocaleMap(row.name_i18n) : null,
    address: hasCurrentVersion ? mapLocaleMap(row.address_i18n) : null,
    publicContact: hasCurrentVersion ? mapJsonObject(row.public_contact_jsonb) : null,
    timeZone: hasCurrentVersion ? mapString(row.time_zone) : null,
    publishedAt: hasCurrentVersion ? mapUtcTimestamp(row.published_at) : null,
  });
};

type ServiceRow = QueryResultRow & {
  id: unknown;
  code: unknown;
  status: unknown;
  current_version_id: unknown;
  version: unknown;
  version_id: unknown;
  name_i18n: unknown;
  description_i18n: unknown;
  disclaimer_i18n: unknown;
  duration_guidance_minutes: unknown;
  published_at: unknown;
};

const mapService = (row: ServiceRow): ServiceConfiguration => {
  const hasCurrentVersion = row.version_id !== null;
  return Object.freeze({
    serviceId: mapServiceId(row.id),
    code: mapString(row.code),
    status: mapEnum(row.status, CONFIGURATION_STATUSES),
    currentVersionId: mapNullableIdentifier(row.current_version_id),
    version: mapAggregateVersion(row.version),
    name: hasCurrentVersion ? mapLocaleMap(row.name_i18n) : null,
    description: hasCurrentVersion ? mapLocaleMap(row.description_i18n) : null,
    disclaimer: hasCurrentVersion ? mapLocaleMap(row.disclaimer_i18n) : null,
    durationGuidanceMinutes:
      row.duration_guidance_minutes === null
        ? null
        : mapPositiveInteger(row.duration_guidance_minutes),
    publishedAt: hasCurrentVersion ? mapUtcTimestamp(row.published_at) : null,
  });
};

export type ConfigurationRepository = Readonly<{
  getOrganization: () => Promise<OrganizationConfiguration>;
  getMembership: (membershipId: MembershipId) => Promise<MembershipRecord>;
  listLocations: (
    request?: RepositoryPageRequest<LocationKeyset> &
      Readonly<{ status?: (typeof CONFIGURATION_STATUSES)[number] }>,
  ) => Promise<RepositoryPage<LocationConfiguration, LocationKeyset>>;
  listLocationHours: (
    locationVersionId: ResourceId,
    request?: RepositoryPageRequest<LocationHourKeyset>,
  ) => Promise<RepositoryPage<LocationHour, LocationHourKeyset>>;
  listLocationClosures: (
    locationId: LocationId,
    fromLocalDate: string,
    toLocalDateExclusive: string,
    request?: RepositoryPageRequest<LocationClosureKeyset>,
  ) => Promise<RepositoryPage<LocationClosure, LocationClosureKeyset>>;
  listServices: (
    request?: RepositoryPageRequest<ServiceKeyset> &
      Readonly<{ status?: (typeof CONFIGURATION_STATUSES)[number] }>,
  ) => Promise<RepositoryPage<ServiceConfiguration, ServiceKeyset>>;
  listServiceLocations: (
    serviceId: ServiceId,
    effectiveAt: UtcTimestamp,
    request?: RepositoryPageRequest<ServiceLocationKeyset>,
  ) => Promise<RepositoryPage<ServiceLocation, ServiceLocationKeyset>>;
  listServicePrices: (
    serviceId: ServiceId,
    effectiveAt: UtcTimestamp,
    request?: RepositoryPageRequest<ServicePriceKeyset>,
  ) => Promise<RepositoryPage<ServicePrice, ServicePriceKeyset>>;
  listPublishedFaqs: (
    effectiveAt: UtcTimestamp,
    request?: RepositoryPageRequest<FaqKeyset>,
  ) => Promise<RepositoryPage<PublishedFaq, FaqKeyset>>;
  listPublishedBusinessPolicies: (
    effectiveAt: UtcTimestamp,
    request?: RepositoryPageRequest<PolicyKeyset>,
  ) => Promise<RepositoryPage<PublishedBusinessPolicy, PolicyKeyset>>;
  getChannelConnection: (
    channelConnectionId: ChannelConnectionId,
  ) => Promise<ChannelConnectionRecord>;
  getWidgetSession: (widgetSessionId: ResourceId) => Promise<WidgetSessionRecord>;
  listWidgetAllowedOrigins: (
    channelConnectionId: ChannelConnectionId,
    request?: RepositoryPageRequest<WidgetAllowedOriginKeyset> &
      Readonly<{ status?: (typeof WIDGET_ORIGIN_STATUSES)[number] }>,
  ) => Promise<RepositoryPage<WidgetAllowedOriginRecord, WidgetAllowedOriginKeyset>>;
  getCurrentRetentionPolicy: () => Promise<RetentionPolicyRecord>;
  listRetentionPolicyRules: (
    retentionPolicyId: ResourceId,
    request?: RepositoryPageRequest<RetentionRuleKeyset>,
  ) => Promise<RepositoryPage<RetentionRule, RetentionRuleKeyset>>;
}>;

export const createConfigurationRepository = (session: TenantDbSession): ConfigurationRepository =>
  Object.freeze({
    getOrganization: async () => {
      const rows = await executeTenantRootRead<OrganizationRow>(
        session,
        `select id, slug, display_name, status, default_locale, default_time_zone,
                current_retention_policy_id, version, created_at, updated_at
           from organizations
          where id = $1`,
      );
      return mapOrganization(requireFound(rows, "organization"));
    },

    getMembership: async (membershipId) => {
      type Row = QueryResultRow & {
        id: unknown;
        user_id: unknown;
        role: unknown;
        status: unknown;
        location_scope: unknown;
        version: unknown;
      };
      const rows = await executeTenantRead<Row>(
        session,
        `select id, user_id, role, status, location_scope, version
           from memberships
          where organization_id = $1 and id = $2`,
        [membershipId],
      );
      const row = requireFound(rows, "membership");
      return Object.freeze({
        membershipId: mapMembershipId(row.id),
        userId: mapResourceId(row.user_id),
        role: mapEnum(row.role, MEMBERSHIP_ROLES),
        status: mapEnum(row.status, MEMBERSHIP_STATUSES),
        locationScope: mapEnum(row.location_scope, LOCATION_SCOPES),
        version: mapAggregateVersion(row.version),
      });
    },

    listLocations: async (request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<LocationRow>(
        session,
        `select l.id, l.code, l.status, l.current_version_id, l.version,
                lv.id as version_id, lv.name_i18n, lv.address_i18n,
                lv.public_contact_jsonb, lv.time_zone, lv.published_at
           from locations l
           left join location_versions lv
             on lv.organization_id = l.organization_id
            and lv.location_id = l.id
            and lv.id = l.current_version_id
          where l.organization_id = $1
            and ($2::text is null or l.status = $2)
            and ($3::text is null or (l.code, l.id) > ($3, $4::uuid))
          order by l.code, l.id
          limit $5`,
        [request.status ?? null, after?.code ?? null, after?.locationId ?? null, limit + 1],
      );
      return createRepositoryPage(rows, limit, mapLocation, (item) => ({
        code: item.code,
        locationId: item.locationId,
      }));
    },

    listLocationHours: async (locationVersionId, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        day_of_week: unknown;
        opens_at_local: unknown;
        closes_at_local: unknown;
        sequence_no: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, day_of_week, opens_at_local::text, closes_at_local::text, sequence_no
           from location_business_hours
          where organization_id = $1
            and location_version_id = $2
            and ($3::smallint is null
              or (day_of_week, sequence_no, id) > ($3, $4::smallint, $5::uuid))
          order by day_of_week, sequence_no, id
          limit $6`,
        [
          locationVersionId,
          after?.dayOfWeek ?? null,
          after?.sequenceNo ?? null,
          after?.hourId ?? null,
          limit + 1,
        ],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            hourId: mapResourceId(row.id),
            dayOfWeek: mapPositiveInteger(row.day_of_week),
            opensAtLocal: mapString(row.opens_at_local),
            closesAtLocal: mapString(row.closes_at_local),
            sequenceNo: mapPositiveInteger(row.sequence_no),
          }),
        (item) => ({
          dayOfWeek: item.dayOfWeek,
          sequenceNo: item.sequenceNo,
          hourId: item.hourId,
        }),
      );
    },

    listLocationClosures: async (locationId, fromLocalDate, toLocalDateExclusive, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        local_date: unknown;
        kind: unknown;
        opens_at_local: unknown;
        closes_at_local: unknown;
        reason_i18n: unknown;
      };
      requireLocalDateRange(fromLocalDate, toLocalDateExclusive);
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, local_date::text, kind, opens_at_local::text,
                closes_at_local::text, reason_i18n
           from location_closures
          where organization_id = $1
            and location_id = $2
            and status = 'active'
            and local_date >= $3::date and local_date < $4::date
            and ($5::date is null or (local_date, id) > ($5::date, $6::uuid))
          order by local_date, id
          limit $7`,
        [
          locationId,
          fromLocalDate,
          toLocalDateExclusive,
          after?.localDate ?? null,
          after?.closureId ?? null,
          limit + 1,
        ],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            closureId: mapResourceId(row.id),
            localDate: mapString(row.local_date),
            kind: mapEnum(row.kind, ["closed", "override"] as const),
            opensAtLocal: mapNullableString(row.opens_at_local),
            closesAtLocal: mapNullableString(row.closes_at_local),
            reason: mapLocaleMap(row.reason_i18n),
          }),
        (item) => ({ localDate: item.localDate, closureId: item.closureId }),
      );
    },

    listServices: async (request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<ServiceRow>(
        session,
        `select s.id, s.code, s.status, s.current_version_id, s.version,
                sv.id as version_id, sv.name_i18n, sv.description_i18n,
                sv.disclaimer_i18n, sv.duration_guidance_minutes, sv.published_at
           from services s
           left join service_versions sv
             on sv.organization_id = s.organization_id
            and sv.service_id = s.id
            and sv.id = s.current_version_id
          where s.organization_id = $1
            and ($2::text is null or s.status = $2)
            and ($3::text is null or (s.code, s.id) > ($3, $4::uuid))
          order by s.code, s.id
          limit $5`,
        [request.status ?? null, after?.code ?? null, after?.serviceId ?? null, limit + 1],
      );
      return createRepositoryPage(rows, limit, mapService, (item) => ({
        code: item.code,
        serviceId: item.serviceId,
      }));
    },

    listServiceLocations: async (serviceId, effectiveAt, request = {}) => {
      type Row = QueryResultRow & {
        location_id: unknown;
        effective_from: unknown;
        effective_to: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select location_id, effective_from, effective_to
           from service_locations
          where organization_id = $1
            and service_id = $2
            and status = 'active'
            and effective_from <= $3::timestamptz
            and (effective_to is null or effective_to > $3::timestamptz)
            and ($4::uuid is null or location_id > $4)
          order by location_id
          limit $5`,
        [serviceId, effectiveAt, after?.locationId ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            locationId: mapLocationId(row.location_id),
            effectiveFrom: mapUtcTimestamp(row.effective_from),
            effectiveTo: mapNullableUtcTimestamp(row.effective_to),
          }),
        (item) => ({ locationId: item.locationId }),
      );
    },

    listServicePrices: async (serviceId, effectiveAt, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        location_id: unknown;
        price_type: unknown;
        currency: unknown;
        min_amount_minor: unknown;
        max_amount_minor: unknown;
        display_text_i18n: unknown;
        effective_from: unknown;
        effective_to: unknown;
        version_no: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, location_id, price_type, currency, min_amount_minor,
                max_amount_minor, display_text_i18n, effective_from,
                effective_to, version_no
           from service_prices
          where organization_id = $1
            and service_id = $2
            and status = 'published'
            and effective_from <= $3::timestamptz
            and (effective_to is null or effective_to > $3::timestamptz)
            and ($4::timestamptz is null
              or (effective_from, id) < ($4, $5::uuid))
          order by effective_from desc, id desc
          limit $6`,
        [serviceId, effectiveAt, after?.effectiveFrom ?? null, after?.priceId ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            priceId: mapResourceId(row.id),
            locationId: row.location_id === null ? null : mapLocationId(row.location_id),
            priceType: mapEnum(row.price_type, PRICE_TYPES),
            currency: mapCurrencyCode(row.currency),
            minAmountMinor:
              row.min_amount_minor === null ? null : mapSafeBigInt(row.min_amount_minor),
            maxAmountMinor:
              row.max_amount_minor === null ? null : mapSafeBigInt(row.max_amount_minor),
            displayText: mapLocaleMap(row.display_text_i18n),
            effectiveFrom: mapUtcTimestamp(row.effective_from),
            effectiveTo: mapNullableUtcTimestamp(row.effective_to),
            versionNo: mapPositiveInteger(row.version_no),
          }),
        (item) => ({ effectiveFrom: item.effectiveFrom, priceId: item.priceId }),
      );
    },

    listPublishedFaqs: async (effectiveAt, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        faq_key: unknown;
        version_no: unknown;
        service_id: unknown;
        location_id: unknown;
        question_i18n: unknown;
        answer_i18n: unknown;
        effective_from: unknown;
        effective_to: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, faq_key, version_no, service_id, location_id,
                question_i18n, answer_i18n, effective_from, effective_to
           from faqs
          where organization_id = $1
            and status = 'published'
            and effective_from <= $2::timestamptz
            and (effective_to is null or effective_to > $2::timestamptz)
            and ($3::text is null or (faq_key, id) > ($3, $4::uuid))
          order by faq_key, id
          limit $5`,
        [effectiveAt, after?.faqKey ?? null, after?.faqId ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            faqId: mapResourceId(row.id),
            faqKey: mapString(row.faq_key),
            versionNo: mapPositiveInteger(row.version_no),
            serviceId: row.service_id === null ? null : mapServiceId(row.service_id),
            locationId: row.location_id === null ? null : mapLocationId(row.location_id),
            question: mapLocaleMap(row.question_i18n),
            answer: mapLocaleMap(row.answer_i18n),
            effectiveFrom: mapUtcTimestamp(row.effective_from),
            effectiveTo: mapNullableUtcTimestamp(row.effective_to),
          }),
        (item) => ({ faqKey: item.faqKey, faqId: item.faqId }),
      );
    },

    listPublishedBusinessPolicies: async (effectiveAt, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        policy_key: unknown;
        version_no: unknown;
        policy_type: unknown;
        schema_version: unknown;
        rules_jsonb: unknown;
        effective_from: unknown;
        effective_to: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, policy_key, version_no, policy_type, schema_version,
                rules_jsonb, effective_from, effective_to
           from business_policies
          where organization_id = $1
            and status = 'published'
            and effective_from <= $2::timestamptz
            and (effective_to is null or effective_to > $2::timestamptz)
            and ($3::text is null or (policy_key, id) > ($3, $4::uuid))
          order by policy_key, id
          limit $5`,
        [effectiveAt, after?.policyKey ?? null, after?.policyId ?? null, limit + 1],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            policyId: mapResourceId(row.id),
            policyKey: mapString(row.policy_key),
            versionNo: mapPositiveInteger(row.version_no),
            policyType: mapEnum(row.policy_type, POLICY_TYPES),
            schemaVersion: mapPositiveInteger(row.schema_version),
            rules: mapJsonObject(row.rules_jsonb),
            effectiveFrom: mapUtcTimestamp(row.effective_from),
            effectiveTo: mapNullableUtcTimestamp(row.effective_to),
          }),
        (item) => ({ policyKey: item.policyKey, policyId: item.policyId }),
      );
    },

    getChannelConnection: async (channelConnectionId) => {
      type Row = QueryResultRow & {
        id: unknown;
        channel_type: unknown;
        status: unknown;
        display_name: unknown;
        configuration_jsonb: unknown;
        verified_at: unknown;
        credential_version: unknown;
        version: unknown;
      };
      const rows = await executeTenantRead<Row>(
        session,
        `select id, channel_type, status, display_name, configuration_jsonb,
                verified_at, credential_version, version
           from channel_connections
          where organization_id = $1 and id = $2`,
        [channelConnectionId],
      );
      const row = requireFound(rows, "channel_connection");
      return Object.freeze({
        channelConnectionId: mapChannelConnectionId(row.id),
        channelType: mapEnum(row.channel_type, CHANNEL_TYPES),
        status: mapEnum(row.status, CHANNEL_STATUSES),
        displayName: mapString(row.display_name),
        configuration: mapJsonObject(row.configuration_jsonb),
        verifiedAt: mapNullableUtcTimestamp(row.verified_at),
        credentialVersion: mapPositiveInteger(row.credential_version),
        version: mapAggregateVersion(row.version),
      });
    },

    getWidgetSession: async (widgetSessionId) => {
      type Row = QueryResultRow & {
        id: unknown;
        channel_connection_id: unknown;
        widget_allowed_origin_id: unknown;
        status: unknown;
        requested_locale: unknown;
        contact_id: unknown;
        conversation_id: unknown;
        issued_at: unknown;
        last_seen_at: unknown;
        expires_at: unknown;
        revoked_at: unknown;
      };
      const rows = await executeTenantRead<Row>(
        session,
        `select id, channel_connection_id, widget_allowed_origin_id, status,
                requested_locale, contact_id, conversation_id, issued_at,
                last_seen_at, expires_at, revoked_at
           from widget_sessions
          where organization_id = $1 and id = $2`,
        [widgetSessionId],
      );
      const row = requireFound(rows, "widget_session");
      return Object.freeze({
        widgetSessionId: mapResourceId(row.id),
        channelConnectionId: mapChannelConnectionId(row.channel_connection_id),
        allowedOriginId: mapResourceId(row.widget_allowed_origin_id),
        status: mapEnum(row.status, WIDGET_SESSION_STATUSES),
        requestedLocale: mapEnum(row.requested_locale, ["en", "ru", "uz"] as const),
        contactId: mapNullableIdentifier(row.contact_id),
        conversationId: mapNullableIdentifier(row.conversation_id),
        issuedAt: mapUtcTimestamp(row.issued_at),
        lastSeenAt: mapUtcTimestamp(row.last_seen_at),
        expiresAt: mapUtcTimestamp(row.expires_at),
        revokedAt: mapNullableUtcTimestamp(row.revoked_at),
      });
    },

    listWidgetAllowedOrigins: async (channelConnectionId, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        channel_connection_id: unknown;
        match_type: unknown;
        scheme: unknown;
        normalized_host: unknown;
        port: unknown;
        status: unknown;
        created_by_user_id: unknown;
        created_at: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, channel_connection_id, match_type, scheme, normalized_host,
                port, status, created_by_user_id, created_at
           from widget_allowed_origins
          where organization_id = $1
            and channel_connection_id = $2
            and ($3::text is null or status = $3)
            and ($4::text is null or (normalized_host, id) > ($4, $5::uuid))
          order by normalized_host, id
          limit $6`,
        [
          channelConnectionId,
          request.status ?? null,
          after?.normalizedHost ?? null,
          after?.allowedOriginId ?? null,
          limit + 1,
        ],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            allowedOriginId: mapResourceId(row.id),
            channelConnectionId: mapChannelConnectionId(row.channel_connection_id),
            matchType: mapEnum(row.match_type, WIDGET_ORIGIN_MATCH_TYPES),
            scheme: mapEnum(row.scheme, ["https"] as const),
            normalizedHost: mapString(row.normalized_host),
            port: row.port === null ? null : mapPositiveInteger(row.port),
            status: mapEnum(row.status, WIDGET_ORIGIN_STATUSES),
            createdByUserId: mapResourceId(row.created_by_user_id),
            createdAt: mapUtcTimestamp(row.created_at),
          }),
        (item) => ({
          normalizedHost: item.normalizedHost,
          allowedOriginId: item.allowedOriginId,
        }),
      );
    },

    getCurrentRetentionPolicy: async () => {
      type Row = QueryResultRow & {
        id: unknown;
        version_no: unknown;
        status: unknown;
        jurisdiction_profile: unknown;
        effective_from: unknown;
      };
      const rows = await executeTenantRead<Row>(
        session,
        `select rp.id, rp.version_no, rp.status, rp.jurisdiction_profile,
                rp.effective_from
           from retention_policies rp
           join organizations o
             on o.id = rp.organization_id
            and o.current_retention_policy_id = rp.id
          where rp.organization_id = $1`,
      );
      const row = requireFound(rows, "retention_policy");
      return Object.freeze({
        retentionPolicyId: mapResourceId(row.id),
        versionNo: mapPositiveInteger(row.version_no),
        status: mapEnum(row.status, RETENTION_STATUSES),
        jurisdictionProfile: mapString(row.jurisdiction_profile),
        effectiveFrom: mapNullableUtcTimestamp(row.effective_from),
      });
    },

    listRetentionPolicyRules: async (retentionPolicyId, request = {}) => {
      type Row = QueryResultRow & {
        id: unknown;
        data_class: unknown;
        purpose: unknown;
        trigger_event: unknown;
        duration_days: unknown;
        expiry_action: unknown;
        jurisdiction_reference: unknown;
        legal_basis_reference: unknown;
      };
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<Row>(
        session,
        `select id, data_class, purpose, trigger_event, duration_days,
                expiry_action, jurisdiction_reference, legal_basis_reference
           from retention_policy_rules
          where organization_id = $1
            and retention_policy_id = $2
            and ($3::text is null
              or (data_class, purpose, trigger_event, id)
                 > ($3, $4, $5, $6::uuid))
          order by data_class, purpose, trigger_event, id
          limit $7`,
        [
          retentionPolicyId,
          after?.dataClass ?? null,
          after?.purpose ?? null,
          after?.triggerEvent ?? null,
          after?.ruleId ?? null,
          limit + 1,
        ],
      );
      return createRepositoryPage(
        rows,
        limit,
        (row) =>
          Object.freeze({
            ruleId: mapResourceId(row.id),
            dataClass: mapString(row.data_class),
            purpose: mapString(row.purpose),
            triggerEvent: mapString(row.trigger_event),
            durationDays: mapSafeBigInt(row.duration_days),
            expiryAction: mapEnum(row.expiry_action, EXPIRY_ACTIONS),
            jurisdictionReference: mapString(row.jurisdiction_reference),
            legalBasisReference: mapString(row.legal_basis_reference),
          }),
        (item) => ({
          dataClass: item.dataClass,
          purpose: item.purpose,
          triggerEvent: item.triggerEvent,
          ruleId: item.ruleId,
        }),
      );
    },
  });
