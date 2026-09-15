import { hkdfSync } from "node:crypto";

import {
  createCanonicalInboundUseCases,
  createStaffConversationQueryUseCases,
  createStaffQueryCursorCodec,
  type CanonicalInboundUseCases,
} from "@lead-agent/application";
import type { CustomerDataProtectionConfig } from "@lead-agent/config";
import {
  createCanonicalInboundPersistenceStore,
  createStaffConversationQueryStore,
  type TenantDatabaseRuntime,
} from "@lead-agent/database";
import { createCustomerDataProtection } from "@lead-agent/security";

import type { StaffConversationDependencies } from "./plugin.js";

export type S9ConversationComposition = Readonly<{
  inbound: CanonicalInboundUseCases;
  staff: StaffConversationDependencies;
}>;

const deriveCursorKey = (rootKey: Uint8Array): Uint8Array =>
  new Uint8Array(
    hkdfSync(
      "sha256",
      rootKey,
      Buffer.from("lead-agent:s9-staff-queries", "utf8"),
      Buffer.from("cursor-v1", "utf8"),
      32,
    ),
  );

export const createS9ConversationComposition = (
  runtime: TenantDatabaseRuntime,
  customerDataConfig: CustomerDataProtectionConfig,
  cursorRootKey: Uint8Array,
): S9ConversationComposition => {
  const customerData = createCustomerDataProtection(customerDataConfig);
  return Object.freeze({
    inbound: createCanonicalInboundUseCases(
      createCanonicalInboundPersistenceStore(runtime),
      customerData,
    ),
    staff: Object.freeze({
      queries: createStaffConversationQueryUseCases(
        createStaffConversationQueryStore(runtime),
        customerData,
        createStaffQueryCursorCodec(deriveCursorKey(cursorRootKey)),
      ),
    }),
  });
};
