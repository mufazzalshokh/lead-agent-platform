import { ConfigurationValidationError } from "./database.js";

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
