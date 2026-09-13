import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import {
  createBusinessPolicyConfigurationUseCases,
  createFaqConfigurationUseCases,
  createFaqPolicyCursorCodec,
  createLocationConfigurationUseCases,
  createLocationCursorCodec,
  createPriceConfigurationUseCases,
  createServiceConfigurationUseCases,
  createServicePricingCursorCodec,
} from "@lead-agent/application";
import {
  createFaqPolicyConfigurationStore,
  createLocationConfigurationStore,
  createServicePricingConfigurationStore,
  type FaqPolicyConfigurationReplayProtector,
  type LocationConfigurationReplayProtector,
  type ServiceConfigurationReplayProtector,
  type TenantDatabaseRuntime,
} from "@lead-agent/database";

import type { StaffConfigurationDependencies } from "./plugin.js";

type ReplayProtector = FaqPolicyConfigurationReplayProtector &
  LocationConfigurationReplayProtector &
  ServiceConfigurationReplayProtector;

const deriveKey = (rootKey: Uint8Array, purpose: string): Uint8Array =>
  new Uint8Array(
    hkdfSync(
      "sha256",
      rootKey,
      Buffer.from("lead-agent:s7-configuration", "utf8"),
      Buffer.from(purpose, "utf8"),
      32,
    ),
  );

const replayProtector = (key: Uint8Array): ReplayProtector =>
  Object.freeze({
    protect: (scope: string, plaintext: Uint8Array): Uint8Array => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(scope, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    },
    reveal: (scope: string, protectedValue: Uint8Array): Uint8Array => {
      if (protectedValue.byteLength < 28) throw new TypeError("Invalid configuration replay");
      const packed = Buffer.from(protectedValue);
      const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
      decipher.setAAD(Buffer.from(scope, "utf8"));
      decipher.setAuthTag(packed.subarray(12, 28));
      return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
    },
  });

export const createStaffConfigurationDependencies = (
  runtime: TenantDatabaseRuntime,
  rootKey: Uint8Array,
): StaffConfigurationDependencies => {
  const locationStore = createLocationConfigurationStore(
    runtime,
    replayProtector(deriveKey(rootKey, "location-replay-v1")),
  );
  const serviceStore = createServicePricingConfigurationStore(
    runtime,
    replayProtector(deriveKey(rootKey, "service-pricing-replay-v1")),
  );
  const faqPolicyStore = createFaqPolicyConfigurationStore(
    runtime,
    replayProtector(deriveKey(rootKey, "faq-policy-replay-v1")),
  );
  const locationOptions = {
    cursorCodec: createLocationCursorCodec(deriveKey(rootKey, "location-cursor-v1")),
  };
  const serviceOptions = {
    cursorCodec: createServicePricingCursorCodec(deriveKey(rootKey, "service-pricing-cursor-v1")),
  };
  const faqPolicyOptions = {
    cursorCodec: createFaqPolicyCursorCodec(deriveKey(rootKey, "faq-policy-cursor-v1")),
  };

  return Object.freeze({
    faqs: createFaqConfigurationUseCases(faqPolicyStore, faqPolicyOptions),
    locations: createLocationConfigurationUseCases(locationStore, locationOptions),
    policies: createBusinessPolicyConfigurationUseCases(faqPolicyStore, faqPolicyOptions),
    prices: createPriceConfigurationUseCases(serviceStore, serviceOptions),
    services: createServiceConfigurationUseCases(serviceStore, serviceOptions),
  });
};
