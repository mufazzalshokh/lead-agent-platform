import { createHash } from "node:crypto";

import {
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  LeadIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  isSchemaValue,
} from "../../packages/contracts/src/index.js";
import {
  createCustomerDataProtection,
  resolveAuthorizationContext,
  type MembershipRole,
  type AuthenticatedApplicationSession,
} from "../../packages/security/src/index.js";
import type { TelegramPlatformConfig } from "../../packages/config/src/index.js";

const organization = "0193f1a8-7f65-7c28-a434-000000000001";
const otherOrganization = "0193f1a8-7f65-7c28-a434-000000000002";
const channel = "0193f1a8-7f65-7c28-a434-000000000003";
const contact = "0193f1a8-7f65-7c28-a434-000000000004";
const conversation = "0193f1a8-7f65-7c28-a434-000000000005";
const lead = "0193f1a8-7f65-7c28-a434-000000000006";
const message = "0193f1a8-7f65-7c28-a434-000000000007";
const user = "0193f1a8-7f65-7c28-a434-000000000008";
const membership = "0193f1a8-7f65-7c28-a434-000000000009";
const control = "0193f1a8-7f65-7c28-a434-000000000010";
if (
  !isSchemaValue(OrganizationIdSchema, organization) ||
  !isSchemaValue(OrganizationIdSchema, otherOrganization) ||
  !isSchemaValue(ChannelConnectionIdSchema, channel) ||
  !isSchemaValue(ContactIdSchema, contact) ||
  !isSchemaValue(ConversationIdSchema, conversation) ||
  !isSchemaValue(LeadIdSchema, lead) ||
  !isSchemaValue(MessageIdSchema, message) ||
  !isSchemaValue(UserIdSchema, user) ||
  !isSchemaValue(MembershipIdSchema, membership) ||
  !isSchemaValue(ResourceIdSchema, control)
)
  throw new Error("Invalid Telegram test identifiers");
export const IDS = Object.freeze({
  organization,
  otherOrganization,
  channel,
  contact,
  conversation,
  lead,
  message,
  user,
  membership,
  control,
});
export const NOW = new Date("2026-09-16T08:00:00.000Z");
export const NONCE = Buffer.alloc(32, 17).toString("base64url");
export const digest = (value: string): Uint8Array => createHash("sha256").update(value).digest();
export const dataProtection = createCustomerDataProtection({
  currentEncryptionKey: Buffer.alloc(32, 18),
  currentKeyId: "telegram-test-only",
  lookupKey: Buffer.alloc(32, 19),
});
// Synthetic values only: fetch is always injected and no real provider is contacted.
export const platformConfig: TelegramPlatformConfig = Object.freeze({
  apiBaseUrl: "https://api.telegram.org",
  botToken: "synthetic-test-token",
  botUsername: "SyntheticBusinessBot",
  requestTimeoutMilliseconds: 50,
  webhookSecret: "s".repeat(43),
  webhookUrl: "https://platform.example/v1/webhooks/telegram",
});
export const authorization = (role: MembershipRole = "owner") =>
  resolveAuthorizationContext(
    {
      absoluteExpiresAt: new Date(NOW.getTime() + 3600000),
      authenticationLevel: "mfa",
      authenticationTime: NOW,
      createdAt: NOW,
      idleExpiresAt: new Date(NOW.getTime() + 3600000),
      lastSeenAt: NOW,
      rotatedAt: NOW,
      rotationDue: false,
      sessionId: IDS.message,
      userId: IDS.user,
    },
    IDS.organization,
    {
      resolveCurrentMembership: () =>
        Promise.resolve({
          allowedLocationIds: [],
          locationScope: "all",
          membershipId: IDS.membership,
          organizationId: IDS.organization,
          role,
          status: "active",
          userId: IDS.user,
        }),
    },
  );
export const staffSession: AuthenticatedApplicationSession = {
  absoluteExpiresAt: new Date(NOW.getTime() + 3600000),
  authenticationLevel: "mfa",
  authenticationTime: NOW,
  createdAt: NOW,
  idleExpiresAt: new Date(NOW.getTime() + 3600000),
  lastSeenAt: NOW,
  rotatedAt: NOW,
  rotationDue: false,
  sessionId: IDS.message,
  userId: IDS.user,
};
export const businessMessage = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  update_id: 100,
  business_message: {
    business_connection_id: "business-test-1",
    chat: { id: 123, type: "private" },
    from: { id: 123, is_bot: false },
    message_id: 7,
    date: NOW.getTime() / 1000,
    text: "Salom / Привет / Hello <b>data</b>",
    ...overrides,
  },
});
