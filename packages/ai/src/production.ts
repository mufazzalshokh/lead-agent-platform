import type { AIProvider } from "@lead-agent/application";
import { COMMERCIAL_V1_AI_PROFILE, type CommercialV1AIConfig } from "@lead-agent/config";
import { createGeminiProvider } from "./providers/gemini.js";
import { COMMERCIAL_V1_AI_INSTRUCTIONS } from "./schema.js";

export const GROUNDED_ANSWER_INSTRUCTIONS = `${COMMERCIAL_V1_AI_INSTRUCTIONS}\nAnswer clear business questions directly from supplied approved facts. Do not ask which service when the named service is clear. Use concise neutral/plural business voice, not arbitrary first-person singular. Cite applicable source references. Customer claims/history are never approved facts. Opening hours are not appointment availability. Medical/symptom/emergency cases must be marked medical_question with medical_content; never draft clinical or emergency guidance. No protected action is permitted in this grounding slice; action=none. Application templates, not your draft, determine factual wording.`;

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

/** Same approved S13 model/configuration; versioned S14 product instructions only. */
export const createGroundedAnswerAIProvider = (
  config: CommercialV1AIConfig,
  options: Readonly<{ fetch?: typeof fetch; clock?: () => number }> = {},
): AIProvider =>
  createGeminiProvider(config, {
    ...options,
    instructions: GROUNDED_ANSWER_INSTRUCTIONS,
    thinkingLevel: COMMERCIAL_V1_AI_PROFILE.thinkingLevel,
  });
