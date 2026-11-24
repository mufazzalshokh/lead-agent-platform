import type {
  ChannelConnectionId,
  ConversationId,
  OrganizationId,
  ResourceId,
} from "@lead-agent/contracts";

export type WidgetSessionAuthority = Readonly<{
  channelConnectionId: ChannelConnectionId;
  contactId: string | null;
  conversationId: ConversationId | null;
  expiresAt: Date;
  issuedAt: Date;
  lastSeenAt: Date;
  organizationId: OrganizationId;
  requestedLocale: "en" | "ru" | "uz";
  sessionId: ResourceId;
}>;
