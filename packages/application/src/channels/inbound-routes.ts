import type { ChannelConnectionId, OrganizationId } from "@lead-agent/contracts";

export const INBOUND_ROUTE_TYPES = Object.freeze(["telegram_webhook", "widget_key"] as const);
export type InboundRouteType = (typeof INBOUND_ROUTE_TYPES)[number];

export type TrustedInboundRoute = Readonly<{
  channelConnectionId: ChannelConnectionId;
  organizationId: OrganizationId;
}>;

export interface InboundRouteResolver {
  resolveInboundRoute(
    routeType: InboundRouteType,
    routeKeyHash: Uint8Array,
  ): Promise<TrustedInboundRoute | null>;
}
