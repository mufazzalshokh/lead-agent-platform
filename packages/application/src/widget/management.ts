import { createHash, randomBytes } from "node:crypto";

import type { ChannelConnectionId } from "@lead-agent/contracts";
import {
  hasPermission,
  isAuthorizationContext,
  normalizeWidgetOrigin,
  type AuthorizationContext,
} from "@lead-agent/security";

const PUBLISHABLE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type WidgetManagementConfiguration = Readonly<{
  channelConnectionId: ChannelConnectionId;
  publishableKey: string;
  websiteOrigin: string;
}>;

export interface WidgetManagementStore {
  configure(
    input: Readonly<{
      actor: AuthorizationContext;
      now: Date;
      publishableKey: string;
      publishableKeyHash: Uint8Array;
      websiteOrigin: string;
    }>,
  ): Promise<WidgetManagementConfiguration>;
  get(actor: AuthorizationContext): Promise<WidgetManagementConfiguration | null>;
}

export class WidgetManagementError extends Error {
  constructor(public readonly code: "permission_denied" | "validation_failed") {
    super(code);
    this.name = "WidgetManagementError";
  }
}

export type WidgetManagementUseCases = Readonly<{
  configure(
    input: Readonly<{ authorization: AuthorizationContext; websiteOrigin: unknown }>,
  ): Promise<WidgetManagementConfiguration>;
  get(
    input: Readonly<{ authorization: AuthorizationContext }>,
  ): Promise<WidgetManagementConfiguration | null>;
}>;

const authorize = (value: AuthorizationContext): void => {
  if (!isAuthorizationContext(value) || !hasPermission(value.role, "integrations.manage")) {
    throw new WidgetManagementError("permission_denied");
  }
};

export const createWidgetManagementUseCases = (dependencies: {
  clock?: () => Date;
  randomPublishableKey?: () => string;
  store: WidgetManagementStore;
}): WidgetManagementUseCases => {
  const clock = dependencies.clock ?? (() => new Date());
  const randomPublishableKey =
    dependencies.randomPublishableKey ?? (() => randomBytes(32).toString("base64url"));
  return Object.freeze({
    configure: async ({ authorization, websiteOrigin }) => {
      authorize(authorization);
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeWidgetOrigin(websiteOrigin);
      } catch {
        throw new WidgetManagementError("validation_failed");
      }
      const publishableKey = randomPublishableKey();
      if (!PUBLISHABLE_KEY_PATTERN.test(publishableKey)) {
        throw new WidgetManagementError("validation_failed");
      }
      return await dependencies.store.configure({
        actor: authorization,
        now: clock(),
        publishableKey,
        publishableKeyHash: createHash("sha256").update(publishableKey, "utf8").digest(),
        websiteOrigin: normalizedOrigin,
      });
    },
    get: async ({ authorization }) => {
      authorize(authorization);
      return await dependencies.store.get(authorization);
    },
  });
};
