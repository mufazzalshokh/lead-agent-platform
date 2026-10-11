import type { WidgetExchangeGrantClaims, WidgetTokenClaims } from "@lead-agent/security";
import type { WidgetSessionAuthority } from "./authority.js";

export type WidgetRecoveryAuthority = Readonly<{
  authority: WidgetSessionAuthority;
  recoveryIssuedAt: Date;
  recoveryExpiresAt: Date;
}>;

/** Transactional ownership recheck, code rotation and audit; never creates business objects. */
export interface WidgetRecoveryStore {
  issue(
    input: Readonly<{
      claims: WidgetTokenClaims;
      origin: string;
      now: Date;
      codeHash: Uint8Array;
      requestId: string;
    }>,
  ): Promise<WidgetRecoveryAuthority | null>;
  resume(
    input: Readonly<{
      grant: WidgetExchangeGrantClaims;
      context: WidgetTokenClaims;
      origin: string;
      now: Date;
      codeHash: Uint8Array;
      nextCodeHash: Uint8Array;
      accessJtiHash: Uint8Array;
      requestId: string;
    }>,
  ): Promise<WidgetRecoveryAuthority | null>;
}
