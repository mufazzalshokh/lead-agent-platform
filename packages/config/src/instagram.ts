import { ConfigurationValidationError } from "./database.js";

export type InstagramPlatformConfig = Readonly<{
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  oauthRedirectUri: string;
  requestTimeoutMilliseconds: number;
  webhookVerifyToken: string;
}>;

const required = (environment: NodeJS.ProcessEnv, key: string, pattern: RegExp): string => {
  const value = environment[key];
  if (typeof value !== "string" || !pattern.test(value))
    throw new ConfigurationValidationError(key);
  return value;
};

export const loadInstagramPlatformConfig = (
  environment: NodeJS.ProcessEnv,
): InstagramPlatformConfig => {
  const redirect = required(environment, "INSTAGRAM_OAUTH_REDIRECT_URI", /^https:\/\/\S{1,2048}$/u);
  let parsed: URL;
  try {
    parsed = new URL(redirect);
  } catch {
    throw new ConfigurationValidationError("INSTAGRAM_OAUTH_REDIRECT_URI");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/v1/integrations/instagram/callback"
  )
    throw new ConfigurationValidationError("INSTAGRAM_OAUTH_REDIRECT_URI");
  return Object.freeze({
    appId: required(environment, "INSTAGRAM_APP_ID", /^[1-9][0-9]{3,31}$/u),
    appSecret: required(environment, "INSTAGRAM_APP_SECRET", /^[A-Za-z0-9_-]{32,256}$/u),
    graphApiVersion: required(environment, "INSTAGRAM_GRAPH_API_VERSION", /^v[1-9][0-9]{0,2}\.0$/u),
    oauthRedirectUri: redirect,
    requestTimeoutMilliseconds: 10_000,
    webhookVerifyToken: required(
      environment,
      "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
      /^[A-Za-z0-9_-]{32,256}$/u,
    ),
  });
};
