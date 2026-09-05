import type {
  ChannelConnectionId,
  ContactId,
  ConversationId,
  MessageId,
  ResourceId,
  ResourceVersion,
  UtcTimestamp,
} from "@lead-agent/contracts";
import type { QueryResultRow } from "pg";

import type { TenantDbSession } from "../runtime/tenant.js";
import {
  createRepositoryPage,
  executeTenantRead,
  mapAggregateVersion,
  mapBytes,
  mapChannelConnectionId,
  mapContactId,
  mapConversationId,
  mapEnum,
  mapMessageId,
  mapNullableBytes,
  mapNullableIdentifier,
  mapNullableString,
  mapNullableUtcTimestamp,
  mapPositiveInteger,
  mapResourceId,
  mapString,
  mapUtcTimestamp,
  requireFound,
  requireLookupHash,
  resolvePageLimit,
  type RepositoryPage,
  type RepositoryPageRequest,
} from "./shared.js";

const CONTACT_STATUSES = ["active", "anonymized", "blocked"] as const;
const IDENTITY_TYPES = ["widget_participant", "telegram_user", "phone", "email"] as const;
const IDENTITY_VALIDATION_STATUSES = ["unverified", "valid", "verified", "invalid"] as const;
const IDENTITY_STATUSES = ["active", "withdrawn", "anonymized"] as const;
const CONSENT_PURPOSES = [
  "booking_follow_up",
  "service_messages",
  "analytics_optional",
  "marketing",
] as const;
const CONSENT_STATUSES = ["granted", "declined", "withdrawn", "not_required"] as const;
const CONSENT_CAPTURE_CHANNELS = ["widget", "telegram", "staff"] as const;
const CONSENT_ACTOR_TYPES = ["customer", "member", "system"] as const;

export type ContactRecord = Readonly<{
  contactId: ContactId;
  displayNameCiphertext: Uint8Array | null;
  preferredLocale: "en" | "ru" | "uz" | null;
  status: (typeof CONTACT_STATUSES)[number];
  firstSeenAt: UtcTimestamp;
  lastSeenAt: UtcTimestamp;
  anonymizedAt: UtcTimestamp | null;
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type ContactIdentityRecord = Readonly<{
  contactIdentityId: ResourceId;
  contactId: ContactId;
  identityType: (typeof IDENTITY_TYPES)[number];
  channelConnectionId: ChannelConnectionId | null;
  valueCiphertext: Uint8Array | null;
  lookupHash: Uint8Array | null;
  hashKeyVersion: number;
  displayRedacted: string | null;
  validationStatus: (typeof IDENTITY_VALIDATION_STATUSES)[number];
  verifiedAt: UtcTimestamp | null;
  status: (typeof IDENTITY_STATUSES)[number];
  version: ResourceVersion;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}>;

export type ConsentRecord = Readonly<{
  consentId: ResourceId;
  contactId: ContactId | null;
  conversationId: ConversationId | null;
  contactIdentityId: ResourceId | null;
  purpose: (typeof CONSENT_PURPOSES)[number];
  status: (typeof CONSENT_STATUSES)[number];
  lawfulBasisCode: string | null;
  noticeKey: string;
  noticeVersion: number;
  policyUrl: string | null;
  locale: "en" | "ru" | "uz";
  captureChannel: (typeof CONSENT_CAPTURE_CHANNELS)[number];
  channelConnectionId: ChannelConnectionId | null;
  sourceMessageId: MessageId | null;
  capturedByType: (typeof CONSENT_ACTOR_TYPES)[number];
  capturedById: ResourceId | null;
  capturedAt: UtcTimestamp;
  withdrawnAt: UtcTimestamp | null;
  supersedesConsentId: ResourceId | null;
  evidenceHash: Uint8Array;
  evidenceCiphertext: Uint8Array | null;
  createdAt: UtcTimestamp;
}>;

export type ContactIdentityKeyset = Readonly<{
  updatedAt: UtcTimestamp;
  contactIdentityId: ResourceId;
}>;

export type ConsentKeyset = Readonly<{
  capturedAt: UtcTimestamp;
  consentId: ResourceId;
}>;

export type ContactIdentityLookup = Readonly<{
  identityType: (typeof IDENTITY_TYPES)[number];
  channelConnectionId: ChannelConnectionId | null;
  lookupHash: Uint8Array;
}>;

type ContactRow = QueryResultRow & {
  id: unknown;
  display_name_ciphertext: unknown;
  preferred_locale: unknown;
  status: unknown;
  first_seen_at: unknown;
  last_seen_at: unknown;
  anonymized_at: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapContact = (row: ContactRow): ContactRecord =>
  Object.freeze({
    contactId: mapContactId(row.id),
    displayNameCiphertext: mapNullableBytes(row.display_name_ciphertext),
    preferredLocale:
      row.preferred_locale === null
        ? null
        : mapEnum(row.preferred_locale, ["en", "ru", "uz"] as const),
    status: mapEnum(row.status, CONTACT_STATUSES),
    firstSeenAt: mapUtcTimestamp(row.first_seen_at),
    lastSeenAt: mapUtcTimestamp(row.last_seen_at),
    anonymizedAt: mapNullableUtcTimestamp(row.anonymized_at),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

type IdentityRow = QueryResultRow & {
  id: unknown;
  contact_id: unknown;
  identity_type: unknown;
  channel_connection_id: unknown;
  value_ciphertext: unknown;
  lookup_hash: unknown;
  hash_key_version: unknown;
  display_redacted: unknown;
  validation_status: unknown;
  verified_at: unknown;
  status: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const mapIdentity = (row: IdentityRow): ContactIdentityRecord =>
  Object.freeze({
    contactIdentityId: mapResourceId(row.id),
    contactId: mapContactId(row.contact_id),
    identityType: mapEnum(row.identity_type, IDENTITY_TYPES),
    channelConnectionId:
      row.channel_connection_id === null ? null : mapChannelConnectionId(row.channel_connection_id),
    valueCiphertext: mapNullableBytes(row.value_ciphertext),
    lookupHash: mapNullableBytes(row.lookup_hash),
    hashKeyVersion: mapPositiveInteger(row.hash_key_version),
    displayRedacted: mapNullableString(row.display_redacted),
    validationStatus: mapEnum(row.validation_status, IDENTITY_VALIDATION_STATUSES),
    verifiedAt: mapNullableUtcTimestamp(row.verified_at),
    status: mapEnum(row.status, IDENTITY_STATUSES),
    version: mapAggregateVersion(row.version),
    createdAt: mapUtcTimestamp(row.created_at),
    updatedAt: mapUtcTimestamp(row.updated_at),
  });

type ConsentRow = QueryResultRow & {
  id: unknown;
  contact_id: unknown;
  conversation_id: unknown;
  contact_identity_id: unknown;
  purpose: unknown;
  status: unknown;
  lawful_basis_code: unknown;
  notice_key: unknown;
  notice_version: unknown;
  policy_url: unknown;
  locale: unknown;
  capture_channel: unknown;
  channel_connection_id: unknown;
  source_message_id: unknown;
  captured_by_type: unknown;
  captured_by_id: unknown;
  captured_at: unknown;
  withdrawn_at: unknown;
  supersedes_consent_id: unknown;
  evidence_hash: unknown;
  evidence_ciphertext: unknown;
  created_at: unknown;
};

const mapConsent = (row: ConsentRow): ConsentRecord =>
  Object.freeze({
    consentId: mapResourceId(row.id),
    contactId: row.contact_id === null ? null : mapContactId(row.contact_id),
    conversationId: row.conversation_id === null ? null : mapConversationId(row.conversation_id),
    contactIdentityId: mapNullableIdentifier(row.contact_identity_id),
    purpose: mapEnum(row.purpose, CONSENT_PURPOSES),
    status: mapEnum(row.status, CONSENT_STATUSES),
    lawfulBasisCode: mapNullableString(row.lawful_basis_code),
    noticeKey: mapString(row.notice_key),
    noticeVersion: mapPositiveInteger(row.notice_version),
    policyUrl: mapNullableString(row.policy_url),
    locale: mapEnum(row.locale, ["en", "ru", "uz"] as const),
    captureChannel: mapEnum(row.capture_channel, CONSENT_CAPTURE_CHANNELS),
    channelConnectionId:
      row.channel_connection_id === null ? null : mapChannelConnectionId(row.channel_connection_id),
    sourceMessageId: row.source_message_id === null ? null : mapMessageId(row.source_message_id),
    capturedByType: mapEnum(row.captured_by_type, CONSENT_ACTOR_TYPES),
    capturedById: mapNullableIdentifier(row.captured_by_id),
    capturedAt: mapUtcTimestamp(row.captured_at),
    withdrawnAt: mapNullableUtcTimestamp(row.withdrawn_at),
    supersedesConsentId: mapNullableIdentifier(row.supersedes_consent_id),
    evidenceHash: mapBytes(row.evidence_hash),
    evidenceCiphertext: mapNullableBytes(row.evidence_ciphertext),
    createdAt: mapUtcTimestamp(row.created_at),
  });

export type CustomerRepository = Readonly<{
  getContact: (contactId: ContactId) => Promise<ContactRecord>;
  findActiveIdentity: (lookup: ContactIdentityLookup) => Promise<ContactIdentityRecord | null>;
  listContactIdentities: (
    contactId: ContactId,
    request?: RepositoryPageRequest<ContactIdentityKeyset>,
  ) => Promise<RepositoryPage<ContactIdentityRecord, ContactIdentityKeyset>>;
  listConsentHistory: (
    contactId: ContactId,
    request?: RepositoryPageRequest<ConsentKeyset>,
  ) => Promise<RepositoryPage<ConsentRecord, ConsentKeyset>>;
}>;

const IDENTITY_COLUMNS = `id, contact_id, identity_type, channel_connection_id,
  value_ciphertext, lookup_hash, hash_key_version, display_redacted,
  validation_status, verified_at, status, version, created_at, updated_at`;

const CONSENT_COLUMNS = `id, contact_id, conversation_id, contact_identity_id,
  purpose, status, lawful_basis_code, notice_key, notice_version, policy_url,
  locale, capture_channel, channel_connection_id, source_message_id,
  captured_by_type, captured_by_id, captured_at, withdrawn_at,
  supersedes_consent_id, evidence_hash, evidence_ciphertext, created_at`;

export const createCustomerRepository = (session: TenantDbSession): CustomerRepository =>
  Object.freeze({
    getContact: async (contactId) => {
      const rows = await executeTenantRead<ContactRow>(
        session,
        `select id, display_name_ciphertext, preferred_locale, status,
                first_seen_at, last_seen_at, anonymized_at, version,
                created_at, updated_at
           from contacts
          where organization_id = $1 and id = $2`,
        [contactId],
      );
      return mapContact(requireFound(rows, "contact"));
    },

    findActiveIdentity: async (lookup) => {
      const rows = await executeTenantRead<IdentityRow>(
        session,
        `select ${IDENTITY_COLUMNS}
           from contact_identities
          where organization_id = $1
            and identity_type = $2
            and coalesce(channel_connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
            and lookup_hash = $4
            and status = 'active'`,
        [lookup.identityType, lookup.channelConnectionId, requireLookupHash(lookup.lookupHash)],
      );
      const row = rows[0];
      return row === undefined ? null : mapIdentity(row);
    },

    listContactIdentities: async (contactId, request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<IdentityRow>(
        session,
        `select ${IDENTITY_COLUMNS}
           from contact_identities
          where organization_id = $1
            and contact_id = $2
            and ($3::timestamptz is null
              or (updated_at, id) < ($3, $4::uuid))
          order by updated_at desc, id desc
          limit $5`,
        [contactId, after?.updatedAt ?? null, after?.contactIdentityId ?? null, limit + 1],
      );
      return createRepositoryPage(rows, limit, mapIdentity, (item) => ({
        updatedAt: item.updatedAt,
        contactIdentityId: item.contactIdentityId,
      }));
    },

    listConsentHistory: async (contactId, request = {}) => {
      const limit = resolvePageLimit(request.limit);
      const after = request.after;
      const rows = await executeTenantRead<ConsentRow>(
        session,
        `select ${CONSENT_COLUMNS}
           from consent_records
          where organization_id = $1
            and contact_id = $2
            and ($3::timestamptz is null
              or (captured_at, id) < ($3, $4::uuid))
          order by captured_at desc, id desc
          limit $5`,
        [contactId, after?.capturedAt ?? null, after?.consentId ?? null, limit + 1],
      );
      return createRepositoryPage(rows, limit, mapConsent, (item) => ({
        capturedAt: item.capturedAt,
        consentId: item.consentId,
      }));
    },
  });
