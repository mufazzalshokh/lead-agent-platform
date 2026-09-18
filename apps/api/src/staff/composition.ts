import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createStaffOperations, createStaffQueryCursorCodec } from "@lead-agent/application";
import { createStaffOperationsStore, type TenantDatabaseRuntime } from "@lead-agent/database";
import type { StaffOperationsDependencies } from "./plugin.js";

export const createStaffOperationsDependencies = (
  runtime: TenantDatabaseRuntime,
  rootKey: Uint8Array,
  clock: () => Date = () => new Date(),
): StaffOperationsDependencies => {
  const derive = (purpose: string) =>
    new Uint8Array(
      hkdfSync(
        "sha256",
        rootKey,
        Buffer.from("lead-agent:s17-private-operations"),
        Buffer.from(purpose),
        32,
      ),
    );
  const key = derive("encrypted-replay-v1");
  const protector = {
    protect: (scope: string, plaintext: Uint8Array): Uint8Array => {
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(scope));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    },
    reveal: (scope: string, packed: Uint8Array): Uint8Array => {
      if (packed.length < 28) throw new TypeError("Invalid private operation replay");
      const value = Buffer.from(packed),
        cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      cipher.setAAD(Buffer.from(scope));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]);
    },
  };
  return {
    operations: createStaffOperations(
      createStaffOperationsStore(runtime, protector),
      createStaffQueryCursorCodec(derive("cursor-v1")),
      clock,
    ),
  };
};
