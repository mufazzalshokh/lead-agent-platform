import { ConfigurationValidationError } from "./database.js";

const BASE64URL_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const KEY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export type CustomerDataProtectionConfigInput = Readonly<{
  currentEncryptionKey: unknown;
  currentKeyId: unknown;
  lookupKey: unknown;
}>;

export type CustomerDataProtectionConfig = Readonly<{
  currentEncryptionKey: Uint8Array;
  currentKeyId: string;
  lookupKey: Uint8Array;
}>;

const requireKey = (value: unknown, name: string): Uint8Array => {
  if (typeof value !== "string" || !BASE64URL_KEY_PATTERN.test(value)) {
    throw new ConfigurationValidationError(name);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) {
    throw new ConfigurationValidationError(name);
  }
  return decoded;
};

export const createCustomerDataProtectionConfig = (
  input: CustomerDataProtectionConfigInput,
): CustomerDataProtectionConfig => {
  if (
    typeof input.currentKeyId !== "string" ||
    input.currentKeyId.length > 64 ||
    !KEY_ID_PATTERN.test(input.currentKeyId)
  ) {
    throw new ConfigurationValidationError("currentKeyId");
  }
  const currentEncryptionKey = requireKey(input.currentEncryptionKey, "currentEncryptionKey");
  const lookupKey = requireKey(input.lookupKey, "lookupKey");
  if (Buffer.from(currentEncryptionKey).equals(Buffer.from(lookupKey))) {
    throw new ConfigurationValidationError("purposeSeparatedCustomerDataKeys");
  }
  return Object.freeze({
    currentEncryptionKey,
    currentKeyId: input.currentKeyId,
    lookupKey,
  });
};

export const loadCustomerDataProtectionConfig = (
  environment: NodeJS.ProcessEnv,
): CustomerDataProtectionConfig =>
  createCustomerDataProtectionConfig({
    currentEncryptionKey: environment["CUSTOMER_DATA_ENCRYPTION_KEY"],
    currentKeyId: environment["CUSTOMER_DATA_ENCRYPTION_KEY_ID"],
    lookupKey: environment["CUSTOMER_DATA_LOOKUP_KEY"],
  });
