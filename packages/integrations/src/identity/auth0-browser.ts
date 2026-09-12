import type { StaffWebAuthConfig } from "@lead-agent/config";
import { OidcCredentialInvalidError, OidcProviderUnavailableError } from "@lead-agent/security";
import {
  Configuration,
  ClientError,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  customFetch,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type CustomFetch,
} from "openid-client";

const MAXIMUM_ID_TOKEN_LENGTH = 32_768;

export type BrowserAuthorizationPurpose = "invitation" | "login" | "step_up";

export type BrowserOidcAuthorization = Readonly<{
  authorizationUrl: string;
  codeVerifier: string;
  nonce: string;
  state: string;
}>;

export type BrowserOidcCallbackEvidence = Readonly<{
  authenticationLevel: "mfa" | "single_factor";
  authenticationTime: Date;
  idToken: string;
  verifiedEmailTarget: string | null;
}>;

export interface StaffBrowserOidcClient {
  begin(purpose: BrowserAuthorizationPurpose): Promise<BrowserOidcAuthorization>;
  complete(
    input: Readonly<{
      callbackUrl: URL;
      codeVerifier: string;
      expectedNonce: string;
      expectedState: string;
      maximumAgeSeconds: number;
    }>,
  ): Promise<BrowserOidcCallbackEvidence>;
}

const isProviderAvailabilityFailure = (error: unknown): boolean =>
  (error instanceof TypeError &&
    (error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("timeout") ||
      error.message.includes("socket"))) ||
  (error instanceof ClientError &&
    (error.code === "OAUTH_TIMEOUT" ||
      error.code === "OAUTH_ABORT" ||
      error.code === "OAUTH_RESPONSE_IS_NOT_CONFORM"));

const requireIdToken = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAXIMUM_ID_TOKEN_LENGTH ||
    value.split(".").length !== 3
  ) {
    throw new OidcCredentialInvalidError();
  }
  return value;
};

const parseCallbackEvidence = (
  idToken: unknown,
  claims: Readonly<Record<string, unknown>> | undefined,
): BrowserOidcCallbackEvidence => {
  const authenticationTime = claims?.["auth_time"];
  const methods = claims?.["amr"];
  if (
    typeof authenticationTime !== "number" ||
    !Number.isSafeInteger(authenticationTime) ||
    authenticationTime < 0 ||
    !Array.isArray(methods) ||
    methods.some((method) => typeof method !== "string" || method.length > 64)
  ) {
    throw new OidcCredentialInvalidError();
  }
  const email = claims?.["email"];
  const authenticationDate = new Date(authenticationTime * 1_000);
  if (!Number.isFinite(authenticationDate.getTime())) throw new OidcCredentialInvalidError();
  const verifiedEmailTarget =
    claims?.["email_verified"] === true &&
    typeof email === "string" &&
    email.length > 0 &&
    email.length <= 320
      ? email
      : null;
  return Object.freeze({
    authenticationLevel: methods.includes("mfa") ? "mfa" : "single_factor",
    authenticationTime: authenticationDate,
    idToken: requireIdToken(idToken),
    verifiedEmailTarget,
  });
};

const createConfiguration = (
  configuration: StaffWebAuthConfig,
  fetchImplementation?: CustomFetch,
): Configuration => {
  const client = new Configuration(
    {
      authorization_endpoint: configuration.authorizationEndpoint,
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["RS256"],
      issuer: configuration.issuer,
      jwks_uri: new URL(".well-known/jwks.json", configuration.issuer).toString(),
      response_types_supported: ["code"],
      token_endpoint: configuration.tokenEndpoint,
    },
    configuration.clientId,
    {
      client_secret: configuration.clientSecret,
      redirect_uris: [configuration.callbackUri],
      response_types: ["code"],
    },
  );
  if (fetchImplementation !== undefined) client[customFetch] = fetchImplementation;
  return client;
};

const createClient = (
  configuration: StaffWebAuthConfig,
  fetchImplementation?: CustomFetch,
): StaffBrowserOidcClient => {
  const client = createConfiguration(configuration, fetchImplementation);
  return Object.freeze({
    begin: async (purpose: BrowserAuthorizationPurpose): Promise<BrowserOidcAuthorization> => {
      const codeVerifier = randomPKCECodeVerifier();
      const nonce = randomNonce();
      const state = randomState();
      const challenge = await calculatePKCECodeChallenge(codeVerifier);
      const maximumAgeSeconds = purpose === "step_up" ? 900 : 43_200;
      const authorizationUrl = buildAuthorizationUrl(client, {
        client_id: configuration.clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        max_age: String(maximumAgeSeconds),
        nonce,
        ...(purpose === "step_up" ? { prompt: "login" } : {}),
        redirect_uri: configuration.callbackUri,
        response_type: "code",
        scope: "openid profile email",
        state,
      });
      return Object.freeze({
        authorizationUrl: authorizationUrl.toString(),
        codeVerifier,
        nonce,
        state,
      });
    },
    complete: async (
      input: Readonly<{
        callbackUrl: URL;
        codeVerifier: string;
        expectedNonce: string;
        expectedState: string;
        maximumAgeSeconds: number;
      }>,
    ): Promise<BrowserOidcCallbackEvidence> => {
      try {
        const tokens = await authorizationCodeGrant(client, input.callbackUrl, {
          expectedNonce: input.expectedNonce,
          expectedState: input.expectedState,
          idTokenExpected: true,
          maxAge: input.maximumAgeSeconds,
          pkceCodeVerifier: input.codeVerifier,
        });
        return parseCallbackEvidence(tokens.id_token, tokens.claims());
      } catch (error) {
        if (error instanceof OidcCredentialInvalidError) throw error;
        if (isProviderAvailabilityFailure(error)) throw new OidcProviderUnavailableError();
        throw new OidcCredentialInvalidError();
      }
    },
  });
};

export const createAuth0BrowserOidcClient = (
  configuration: StaffWebAuthConfig,
): StaffBrowserOidcClient => createClient(configuration);

/** @internal Deterministic authorization-server transport seam. */
export const createAuth0BrowserOidcClientForTests = (
  configuration: StaffWebAuthConfig,
  fetchImplementation: CustomFetch,
): StaffBrowserOidcClient => createClient(configuration, fetchImplementation);
