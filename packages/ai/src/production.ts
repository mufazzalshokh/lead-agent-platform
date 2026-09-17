import type { AIProvider } from "@lead-agent/application";
import { COMMERCIAL_V1_AI_PROFILE, type CommercialV1AIConfig } from "@lead-agent/config";
import { createGeminiProvider } from "./providers/gemini.js";
import { COMMERCIAL_V1_AI_INSTRUCTIONS } from "./schema.js";

/** No provider/model routing, fallback, generic tools, or mutable generation options. */
export const createCommercialV1AIProvider = (
  config: CommercialV1AIConfig,
  options: Readonly<{ fetch?: typeof fetch; clock?: () => number }> = {},
): AIProvider =>
  createGeminiProvider(config, {
    ...options,
    instructions: COMMERCIAL_V1_AI_INSTRUCTIONS,
    thinkingLevel: COMMERCIAL_V1_AI_PROFILE.thinkingLevel,
  });
