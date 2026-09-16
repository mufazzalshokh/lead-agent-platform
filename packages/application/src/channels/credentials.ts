/** Deployment supplies a managed writable secret store. References are opaque to business code. */
export interface CredentialSecretStore {
  put(secret: string): Promise<string>;
  get(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}

export const isCredentialSecretReference = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 6 &&
  value.length <= 512 &&
  /^[a-z][a-z0-9+.-]{1,31}:\/\/\S+$/u.test(value);
