import {
  selectGroundingFacts,
  groundingLocale,
  groundingPreflight,
  type AIFact,
} from "@lead-agent/application";
import {
  LocaleSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ConversationId,
  type Locale,
} from "@lead-agent/contracts";
import type { TenantDbSession } from "../runtime/tenant.js";
import { createConversationRepository } from "./conversations.js";
import { createLeadRepository } from "./leads.js";
import { executeTenantRead, executeTenantRootRead } from "./shared.js";
import { readConversationPublishedKnowledge } from "./published-business-knowledge.js";

export const createConversationKnowledgeReader =
  (clock: () => Date = () => new Date()) =>
  async (
    session: TenantDbSession,
    input: Readonly<{
      conversationId: ConversationId;
      locale: Locale;
      message: string;
      lock?: boolean;
    }>,
  ): Promise<readonly AIFact[]> => {
    if (groundingPreflight(input.message) !== null) return [];
    const conversation = await createConversationRepository(session).getConversation(
      input.conversationId,
    );
    const lead = await createLeadRepository(session).getLead(conversation.leadId);
    if (input.lock === true) {
      // Existing publishers lock Service/Location roots. Hold bounded shared root
      // locks through answer commit, then re-read after any publisher completes.
      for (const table of ["services", "locations", "faqs"] as const) {
        const rows = await executeTenantRead(
          session,
          `select id from ${table} where organization_id=$1 and status=$2 order by id limit 501 for share`,
          [table === "faqs" ? "published" : "active"],
        );
        if (rows.length > 500) return [];
      }
    }
    const effectiveAt = clock().toISOString();
    if (!isSchemaValue(UtcTimestampSchema, effectiveAt))
      throw new TypeError("Invalid knowledge instant");
    const locale = groundingLocale(input.message, input.locale);
    const projection = await readConversationPublishedKnowledge(session, {
      conversationId: input.conversationId,
      locale,
      effectiveAt,
      locationIds: lead.locationId === null ? null : [lead.locationId],
    });
    const organizations = await executeTenantRootRead(
      session,
      `select default_locale from organizations where id=$1 and status='active'`,
    );
    const defaultLocale: unknown = organizations[0]?.["default_locale"];
    if (!isSchemaValue(LocaleSchema, defaultLocale)) return [];
    return projection.ok
      ? selectGroundingFacts(projection.value, {
          message: input.message,
          locale,
          defaultLocale,
          serviceId: lead.serviceId,
          locationId: lead.locationId,
        })
      : [];
  };
