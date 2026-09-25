import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { CredentialSecretStore } from "@lead-agent/application";

const SECRET_RESOURCE_PATTERN =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/secrets\/[A-Za-z0-9_-]{1,255}$/u;
const VERSION_RESOURCE_PATTERN =
  /^(projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/secrets\/[A-Za-z0-9_-]{1,255})\/versions\/([1-9][0-9]*)$/u;
const REFERENCE_PREFIX = "gcp-secret://";
const MAXIMUM_SECRET_BYTES = 65_536;

type SecretVersionResponse = Readonly<{
  name?: string | null;
  payload?: Readonly<{ data?: string | Uint8Array | null }> | null;
}>;

export interface GoogleSecretManagerClient {
  readonly addSecretVersion: (
    input: Readonly<{
      parent: string;
      payload: Readonly<{ data: Uint8Array }>;
    }>,
  ) => Promise<readonly [SecretVersionResponse, ...unknown[]]>;
  readonly accessSecretVersion: (
    input: Readonly<{ name: string }>,
  ) => Promise<readonly [SecretVersionResponse, ...unknown[]]>;
  readonly destroySecretVersion: (
    input: Readonly<{ name: string }>,
  ) => Promise<readonly [unknown, ...unknown[]]>;
}

const requireSecretResource = (value: unknown): string => {
  if (typeof value !== "string" || !SECRET_RESOURCE_PATTERN.test(value)) {
    throw new TypeError("CREDENTIAL_SECRET_RESOURCE must be a canonical Secret Manager resource");
  }
  return value;
};

const versionResourceFromReference = (reference: string, secretResource: string): string => {
  if (!reference.startsWith(REFERENCE_PREFIX)) throw new TypeError("Invalid credential reference");
  const resource = reference.slice(REFERENCE_PREFIX.length);
  const match = VERSION_RESOURCE_PATTERN.exec(resource);
  if (match?.[1] !== secretResource) throw new TypeError("Credential reference is out of scope");
  return resource;
};

const isAbsentVersion = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code: unknown = "code" in error ? error.code : undefined;
  return code === 5 || code === 9 || code === "NOT_FOUND" || code === "FAILED_PRECONDITION";
};

const decodePayload = (value: string | Uint8Array | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === "string"
    ? Buffer.from(value, "base64").toString("utf8")
    : Buffer.from(value).toString("utf8");
};

export const createGoogleSecretManagerCredentialStore = (
  secretResourceInput: unknown,
  client: GoogleSecretManagerClient = new SecretManagerServiceClient(),
): CredentialSecretStore => {
  const secretResource = requireSecretResource(secretResourceInput);
  return Object.freeze({
    put: async (secret: string): Promise<string> => {
      const encoded = Buffer.from(secret, "utf8");
      if (encoded.byteLength < 1 || encoded.byteLength > MAXIMUM_SECRET_BYTES) {
        throw new TypeError("Credential secret has an invalid size");
      }
      const [created] = await client.addSecretVersion({
        parent: secretResource,
        payload: { data: encoded },
      });
      const name = created.name;
      if (typeof name !== "string" || VERSION_RESOURCE_PATTERN.exec(name)?.[1] !== secretResource) {
        throw new Error("Secret Manager returned an invalid credential version resource");
      }
      return `${REFERENCE_PREFIX}${name}`;
    },
    get: async (reference: string): Promise<string | null> => {
      const name = versionResourceFromReference(reference, secretResource);
      try {
        const [version] = await client.accessSecretVersion({ name });
        return decodePayload(version.payload?.data);
      } catch (error) {
        if (isAbsentVersion(error)) return null;
        throw error;
      }
    },
    delete: async (reference: string): Promise<void> => {
      const name = versionResourceFromReference(reference, secretResource);
      try {
        await client.destroySecretVersion({ name });
      } catch (error) {
        if (!isAbsentVersion(error)) throw error;
      }
    },
  });
};

export const createGoogleSecretManagerCredentialStoreFromEnvironment = (
  environment: NodeJS.ProcessEnv,
  client?: GoogleSecretManagerClient,
): CredentialSecretStore | undefined => {
  const resource = environment["CREDENTIAL_SECRET_RESOURCE"];
  return resource === undefined
    ? undefined
    : createGoogleSecretManagerCredentialStore(resource, client);
};
