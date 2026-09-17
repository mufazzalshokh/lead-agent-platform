import { ConfigurationValidationError } from "./database.js";

/** Owner-approved S13 profile. Changes require a new evaluated/approved profile. */
export const COMMERCIAL_V1_AI_PROFILE = Object.freeze({
  providerId: "gemini",
  model: "gemini-3.8-flash",
  apiTier: "paid",
  thinkingLevel: "low",
  maxOutputTokens: 4_000,
  decisionSchemaVersion: "1",
  modelProfileVersion: "s13-commercial-v1.v1",
  promptTemplateVersion: "s13-uzbek-latin.v1",
} as const);
export type CommercialV1AIConfig = Readonly<{
  apiKey: string;
  model: typeof COMMERCIAL_V1_AI_PROFILE.model;
  requestTimeoutMs: number;
}>;

/** Missing Gemini credentials leave the proposal-only handler disabled, never select a backup. */
export const loadCommercialV1AIConfig = (
  environment: NodeJS.ProcessEnv,
): CommercialV1AIConfig | null => {
  if (
    environment["AI_PROVIDER"] !== undefined &&
    environment["AI_PROVIDER"] !== COMMERCIAL_V1_AI_PROFILE.providerId
  )
    throw new ConfigurationValidationError("AI_PROVIDER");
  if (
    environment["AI_MODEL"] !== undefined &&
    environment["AI_MODEL"] !== COMMERCIAL_V1_AI_PROFILE.model
  )
    throw new ConfigurationValidationError("AI_MODEL");
  const apiKey = environment["GEMINI_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;
  if (apiKey.length < 16 || apiKey.length > 512 || !/^[\x21-\x7e]+$/u.test(apiKey))
    throw new ConfigurationValidationError("GEMINI_API_KEY");
  const timeout = environment["AI_REQUEST_TIMEOUT_MS"] ?? "15000";
  if (!/^[1-9][0-9]{0,5}$/u.test(timeout) || Number(timeout) > 120_000)
    throw new ConfigurationValidationError("AI_REQUEST_TIMEOUT_MS");
  return Object.freeze({
    apiKey,
    model: COMMERCIAL_V1_AI_PROFILE.model,
    requestTimeoutMs: Number(timeout),
  });
};

export type OpenAIHarnessConfig = Readonly<{
  apiKey: string;
  model: string;
  requestTimeoutMs: number;
}>;
export const loadOpenAIHarnessConfig = (environment: NodeJS.ProcessEnv): OpenAIHarnessConfig => {
  const apiKey = environment["OPENAI_API_KEY"];
  const model = environment["AI_MODEL"];
  const timeout = environment["AI_REQUEST_TIMEOUT_MS"] ?? "15000";
  if (
    apiKey === undefined ||
    apiKey.length < 16 ||
    apiKey.length > 512 ||
    !/^[\x21-\x7e]+$/u.test(apiKey)
  )
    throw new ConfigurationValidationError("OPENAI_API_KEY");
  if (
    model === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(model) ||
    model === "latest"
  )
    throw new ConfigurationValidationError("AI_MODEL");
  if (!/^[1-9][0-9]{0,5}$/u.test(timeout) || Number(timeout) > 120_000)
    throw new ConfigurationValidationError("AI_REQUEST_TIMEOUT_MS");
  return Object.freeze({ apiKey, model, requestTimeoutMs: Number(timeout) });
};
