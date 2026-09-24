import { hkdfSync } from "node:crypto";

import {
  createCanonicalInboundUseCases,
  createStaffConversationQueryUseCases,
  createStaffConversationQueryV2UseCases,
  createStaffQueryCursorCodec,
  type CanonicalInboundUseCases,
} from "@lead-agent/application";
import type { CustomerDataProtectionConfig } from "@lead-agent/config";
import {
  createCanonicalInboundPersistenceStore,
  createStaffConversationQueryStore,
  createThreadAutomationControlStore,
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
  const store = createStaffConversationQueryStore(runtime);
  const cursors = createStaffQueryCursorCodec(deriveCursorKey(cursorRootKey));
  return Object.freeze({
    inbound: createCanonicalInboundUseCases(
      createCanonicalInboundPersistenceStore(runtime),
      customerData,
      createThreadAutomationControlStore(runtime),
    ),
    staff: Object.freeze({
      queries: createStaffConversationQueryUseCases(store, customerData, cursors),
      queriesV2: createStaffConversationQueryV2UseCases(store, customerData, cursors),
    }),
  });
};
