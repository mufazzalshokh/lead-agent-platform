import { AgentFactualClaimSchema, isSchemaValue } from "@lead-agent/contracts";
import type { AIContextSnapshot, AIProviderInput } from "./ports.js";

export const AI_CONTEXT_LIMITS = Object.freeze({
  historyMessages: 12,
  messageCharacters: 4_000,
  totalCharacters: 20_000,
  facts: 24,
  factCharacters: 2_000,
});
export const buildAIProviderInput = (
  snapshot: AIContextSnapshot,
  signal: AbortSignal,
  repair = false,
): AIProviderInput | null => {
  const { policy, message } = snapshot;
  if (
    message.length === 0 ||
    message.length > AI_CONTEXT_LIMITS.messageCharacters ||
    policy.facts.length > AI_CONTEXT_LIMITS.facts
  )
    return null;
  const ordered = [...snapshot.history].sort((a, b) => a.sequence - b.sequence);
  if (
    ordered.some(
      (entry, index) =>
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence < 1 ||
        entry.sequence >= snapshot.sourceSequence ||
        (index > 0 && ordered[index - 1]?.sequence === entry.sequence),
    )
  )
    return null;
  const history = ordered.slice(-AI_CONTEXT_LIMITS.historyMessages);
  if (
    history.some(
      (entry) =>
        entry.text.length > AI_CONTEXT_LIMITS.messageCharacters ||
        !["customer", "staff", "system"].includes(entry.role),
    ) ||
    policy.facts.some(
      (fact) =>
        fact.text.length > AI_CONTEXT_LIMITS.factCharacters ||
        !isSchemaValue(AgentFactualClaimSchema, fact.reference),
    )
  )
    return null;
  const total =
    message.length +
    history.reduce((sum, entry) => sum + entry.text.length, 0) +
    policy.facts.reduce(
      (sum, fact) => sum + fact.text.length + JSON.stringify(fact.reference).length,
      0,
    );
  if (total > AI_CONTEXT_LIMITS.totalCharacters) return null;
  return Object.freeze({
    locale: snapshot.locale,
    history: Object.freeze(
      history.map((entry) =>
        Object.freeze({ role: entry.role, sequence: entry.sequence, text: entry.text }),
      ),
    ),
    message,
    facts: Object.freeze(
      policy.facts.map((fact) =>
        Object.freeze({
          reference: Object.freeze({
            claim_kind: fact.reference.claim_kind,
            source_type: fact.reference.source_type,
            source_id: fact.reference.source_id,
            source_version: fact.reference.source_version,
          }),
          text: fact.text,
        }),
      ),
    ),
    schemaVersion: "1",
    repair,
    signal,
  });
};
