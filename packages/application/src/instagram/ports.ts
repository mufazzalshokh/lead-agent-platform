import type {
  CanonicalInboundEvent,
  ChannelConnectionId,
  ChannelFailureCategory,
} from "@lead-agent/contracts";
import type { AuthorizationContext } from "@lead-agent/security";
import type { TrustedInboundRoute } from "../channels/index.js";

export type InstagramAccountCredential = Readonly<{
  accountId: string;
  expiresInSeconds: number;
  token: string;
}>;
export interface InstagramOAuthClient {
  exchangeCode(code: string): Promise<InstagramAccountCredential>;
  refreshToken(token: string): Promise<Readonly<{ expiresInSeconds: number; token: string }>>;
  subscribeMessages(accountId: string, token: string): Promise<void>;
}
export type InstagramConnection = Readonly<{
  accountId: string | null;
  credentialReference: string | null;
  credentialVersion: number;
  credentialIssuedAt: string | null;
  expiresAt: string | null;
  onboardingExpiresAt: string | null;
  stateHash: Uint8Array | null;
  status: "pending" | "active" | "disabled" | "revoked";
}>;
export interface InstagramPersistenceStore {
  beginOnboarding(
    input: Readonly<{
      actor: AuthorizationContext;
      displayName: string;
      expiresAt: Date;
      now: Date;
      stateHash: Uint8Array;
    }>,
  ): Promise<ChannelConnectionId>;
  loadConnection(context: TrustedInboundRoute): Promise<InstagramConnection | null>;
  activate(
    input: Readonly<{
      accountId: string;
      accountHash: Uint8Array;
      context: TrustedInboundRoute;
      credentialReference: string;
      expiresAt: Date;
      now: Date;
      stateHash: Uint8Array;
    }>,
  ): Promise<boolean>;
  replaceCredential(
    input: Readonly<{
      context: TrustedInboundRoute;
      expectedReference: string;
      expectedVersion: number;
      credentialReference: string;
      expiresAt: Date;
      now: Date;
    }>,
  ): Promise<boolean>;
  disconnect(
    input: Readonly<{
      actor?: AuthorizationContext;
      context: TrustedInboundRoute;
      expectedVersion?: number;
      now: Date;
      revoked: boolean;
    }>,
  ): Promise<string | null>;
}
export type InstagramInboundMessage = Readonly<{
  accountId: string;
  content: Extract<
    CanonicalInboundEvent["content"],
    { type: "attachment" | "quick_reply" | "text" }
  >;
  customerId: string;
  messageId: string;
  occurredAt: string;
}>;
export class InstagramApplicationError extends Error {
  public constructor(
    public readonly code:
      "business_rule_failed" | "channel_unavailable" | "permission_denied" | "validation_failed",
  ) {
    super(code);
    this.name = "InstagramApplicationError";
  }
}
export class InstagramProviderError extends Error {
  public constructor(
    public readonly category: ChannelFailureCategory,
    public readonly ambiguousExternalEffect: boolean,
    public readonly retryAfterMilliseconds?: number,
  ) {
    super("Instagram provider request failed");
    this.name = "InstagramProviderError";
  }
}
