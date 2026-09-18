import { describe, expect, it, vi } from "vitest";
import {
  createGroundedAnswerAIProvider,
  GROUNDED_ANSWER_INSTRUCTIONS,
  createSalesFlowAIProvider,
  SALES_FLOW_INSTRUCTIONS,
  createAppointmentSubmissionAIProvider,
  APPOINTMENT_SUBMISSION_INSTRUCTIONS,
} from "../../packages/ai/src/index.js";
import { loadCommercialV1AIConfig } from "../../packages/config/src/index.js";
import {
  buildAIProviderInput,
  selectGroundingFacts,
} from "../../packages/application/src/index.js";
import { AI_SNAPSHOT, validDecision } from "./fixtures.js";
import { groundingKnowledge } from "./grounding-fixtures.js";

describe("S14 grounded provider composition", () => {
  it.each([
    [createGroundedAnswerAIProvider, GROUNDED_ANSWER_INSTRUCTIONS],
    [createSalesFlowAIProvider, SALES_FLOW_INSTRUCTIONS],
    [createAppointmentSubmissionAIProvider, APPOINTMENT_SUBMISSION_INSTRUCTIONS],
  ] as const)(
    "keeps the exact approved stateless Gemini profile with a versioned product prompt",
    async (factory, instructions) => {
      const config = loadCommercialV1AIConfig({ GEMINI_API_KEY: "synthetic-s14-provider-key" });
      if (config === null) throw new Error("Missing mock configuration");
      const fetchMock = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json({
            modelVersion: "gemini-3.8-flash",
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  role: "model",
                  parts: [
                    { text: JSON.stringify(validDecision({ intent: "pricing", language: "uz" })) },
                  ],
                },
              },
            ],
          }),
        ),
      );
      const message = "oka lazer nechi pul";
      const input = buildAIProviderInput(
        {
          ...AI_SNAPSHOT,
          locale: "uz",
          message,
          policy: {
            ...AI_SNAPSHOT.policy,
            facts: selectGroundingFacts(groundingKnowledge(), { message, locale: "uz" }),
          },
        },
        new AbortController().signal,
      );
      if (input === null) throw new Error("Invalid mock input");
      expect(await factory(config, { fetch: fetchMock }).decide(input)).toMatchObject({
        kind: "completed",
        model: "gemini-3.8-flash",
      });
      const request = fetchMock.mock.calls[0];
      if (typeof request?.[1]?.body !== "string") throw new Error("Missing provider request");
      const sent: unknown = JSON.parse(request[1].body);
      expect(sent).toMatchObject({
        systemInstruction: { parts: [{ text: instructions }] },
        generationConfig: {
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "low" },
        },
      });
      expect(request[0]).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      );
      expect(request[1].body).not.toMatch(
        /"grounding"|"subject"|published_by_user_id|customer_id/u,
      );
      expect(Object.keys(sent ?? {})).not.toEqual(
        expect.arrayContaining(["tools", "cachedContent", "conversation"]),
      );
    },
  );
});
