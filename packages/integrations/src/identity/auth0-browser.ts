import type { StaffWebAuthConfig } from "@lead-agent/config";
import { OidcCredentialInvalidError, OidcProviderUnavailableError } from "@lead-agent/security";
import {
  Configuration,
  ClientError,
  ResponseBodyError,
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
const MAXIMUM_AUTHENTICATION_METHOD_LENGTH = 256;
const PROVIDER_REQUEST_TIMEOUT_SECONDS = 10;
const MULTI_FACTOR_AUTHENTICATION_CONTEXT =
  "http://schemas.openid.net/pape/policies/2007/06/multi-factor";

export type BrowserAuthorizationPurpose = "invitation" | "login" | "reauthenticate" | "step_up";

export type BrowserOidcCallbackFailure =
  | "callback_authentication_methods_invalid"
  | "callback_authentication_time_invalid"
  | "callback_id_token_invalid"
  | "oidc_claim_validation_failed"
  | "oidc_response_invalid"
  | "oidc_timestamp_validation_failed"
  | "token_endpoint_invalid_client"
  | "token_endpoint_invalid_grant"
  | "token_endpoint_invalid_request"
  | "token_endpoint_invalid_scope"
  | "token_endpoint_rejected"
  | "token_endpoint_unauthorized_client"
  | "token_endpoint_unsupported_grant_type";

/** Safe, finite callback diagnostics. Provider response bodies are never retained. */
export class BrowserOidcCallbackInvalidError extends OidcCredentialInvalidError {
  constructor(readonly failure: BrowserOidcCallbackFailure) {
    super();
    this.name = "BrowserOidcCallbackInvalidError";
  }
}

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
    throw new BrowserOidcCallbackInvalidError("callback_id_token_invalid");
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
    authenticationTime < 0
  ) {
    throw new BrowserOidcCallbackInvalidError("callback_authentication_time_invalid");
  }
  if (
    methods !== undefined &&
    (!Array.isArray(methods) ||
      methods.some(
        (method) =>
          typeof method !== "string" ||
          method.length < 1 ||
          method.length > MAXIMUM_AUTHENTICATION_METHOD_LENGTH,
      ))
  ) {
    throw new BrowserOidcCallbackInvalidError("callback_authentication_methods_invalid");
  }
  const email = claims?.["email"];
  const authenticationDate = new Date(authenticationTime * 1_000);
  if (!Number.isFinite(authenticationDate.getTime())) {
    throw new BrowserOidcCallbackInvalidError("callback_authentication_time_invalid");
  }
  const verifiedEmailTarget =
    claims?.["email_verified"] === true &&
    typeof email === "string" &&
    email.length > 0 &&
    email.length <= 320
      ? email
      : null;
  // OIDC makes `amr` optional. Auth0 also signs the exact multi-factor `acr`,
  // so either standard signal may prove MFA; absence proves only single factor.
  return Object.freeze({
    authenticationLevel:
      (Array.isArray(methods) && methods.includes("mfa")) ||
      claims?.["acr"] === MULTI_FACTOR_AUTHENTICATION_CONTEXT
        ? "mfa"
        : "single_factor",
    authenticationTime: authenticationDate,
    idToken: requireIdToken(idToken),
    verifiedEmailTarget,
  });
};

const tokenEndpointFailure = (error: string): BrowserOidcCallbackFailure => {
  switch (error) {
    case "invalid_client":
      return "token_endpoint_invalid_client";
    case "invalid_grant":
      return "token_endpoint_invalid_grant";
    case "invalid_request":
      return "token_endpoint_invalid_request";
    case "invalid_scope":
      return "token_endpoint_invalid_scope";
    case "unauthorized_client":
      return "token_endpoint_unauthorized_client";
    case "unsupported_grant_type":
      return "token_endpoint_unsupported_grant_type";
    default:
      return "token_endpoint_rejected";
  }
};

const oidcValidationFailure = (error: ClientError): BrowserOidcCallbackFailure => {
  switch (error.code) {
    case "OAUTH_JWT_CLAIM_COMPARISON_FAILED":
      return "oidc_claim_validation_failed";
    case "OAUTH_JWT_TIMESTAMP_CHECK_FAILED":
      return "oidc_timestamp_validation_failed";
    default:
      return "oidc_response_invalid";
  }
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
  client.timeout = PROVIDER_REQUEST_TIMEOUT_SECONDS;
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
        ...(configuration.requireMfa ? { acr_values: MULTI_FACTOR_AUTHENTICATION_CONTEXT } : {}),
        client_id: configuration.clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        max_age: String(maximumAgeSeconds),
        nonce,
        ...(purpose === "step_up" || purpose === "reauthenticate" ? { prompt: "login" } : {}),
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
        if (error instanceof BrowserOidcCallbackInvalidError) throw error;
        if (isProviderAvailabilityFailure(error)) throw new OidcProviderUnavailableError();
        if (error instanceof ResponseBodyError) {
          throw new BrowserOidcCallbackInvalidError(tokenEndpointFailure(error.error));
        }
        if (error instanceof ClientError) {
          throw new BrowserOidcCallbackInvalidError(oidcValidationFailure(error));
        }
        throw new BrowserOidcCallbackInvalidError("oidc_response_invalid");
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
