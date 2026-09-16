import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../apps/api/src/app.js";
import {
  createStaffConversationQueryUseCases,
  createStaffConversationQueryV2UseCases,
  createStaffQueryCursorCodec,
  type StaffConversationQueryStore,
  type StoredContact,
} from "../../packages/application/src/index.js";
import {
  StaffContactSchema,
  StaffContactV2Schema,
  StaffConversationSchema,
  StaffConversationV2Schema,
  ResourceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type StaffConversationV2,
} from "../../packages/contracts/src/index.js";
import { authorization, IDS, NOW } from "./fixtures.js";
import { staffFixture } from "./staff-fixtures.js";

const instant = NOW.toISOString();
const identityId = IDS.message;
if (!isSchemaValue(UtcTimestampSchema, instant) || !isSchemaValue(ResourceIdSchema, identityId))
  throw new Error("Invalid Instagram read fixture");
const stored: StoredContact = {
  anonymized_at: null,
  created_at: instant,
  displayNameCiphertext: Uint8Array.of(1),
  first_seen_at: instant,
  id: IDS.contact,
  identities: ["instagram_user", "telegram_user"].map((type) => {
    if (type !== "instagram_user" && type !== "telegram_user")
      throw new Error("Invalid identity fixture");
    return {
      channel_connection_id: IDS.channel,
      display_redacted: "participant:***",
      id: identityId,
      identity_type: type,
      status: "active" as const,
      validation_status: "verified" as const,
      valueCiphertext: Uint8Array.of(2),
      verified_at: instant,
    };
  }),
  last_seen_at: instant,
  preferred_locale: "uz",
  status: "active",
  updated_at: instant,
  version: 1,
};
const conversation: StaffConversationV2 = {
  active_handoff_id: null,
  automation_mode: "ai",
  channel_connection_id: IDS.channel,
  closed_at: null,
  contact_id: IDS.contact,
  created_at: instant,
  id: IDS.conversation,
  last_activity_at: instant,
  lead_id: IDS.lead,
  participant: {
    contact_id: IDS.contact,
    display_redacted: "participant:***",
    identity_type: "instagram_user",
  },
  preferred_locale: "uz",
  resolved_at: null,
  started_at: instant,
  status: "open",
  updated_at: instant,
  version: 1,
};
const fixture = (contact: StoredContact = stored, sensitive = true) => {
  const revealContactIdentity = vi.fn(() => "synthetic-authorized-identity");
  const getContact = vi.fn<StaffConversationQueryStore["getContact"]>(({ authorization: actor }) =>
    Promise.resolve(actor.organizationId === IDS.organization ? contact : null),
  );
  const getConversation = vi.fn<StaffConversationQueryStore["getConversation"]>(
    ({ authorization: actor }) =>
      Promise.resolve(actor.organizationId === IDS.organization ? conversation : null),
  );
  const store: StaffConversationQueryStore = {
    getContact,
    getConversation,
    getLead: () => Promise.resolve(null),
    listLeads: () => Promise.resolve({ items: [], next: null }),
    listConversations: ({ authorization: actor }) =>
      Promise.resolve({
        items: actor.organizationId === IDS.organization ? [conversation] : [],
        next: null,
      }),
    listMessages: () => Promise.resolve(null),
  };
  const revealer = {
    revealContactIdentity,
    revealContactDisplayName: () => "Synthetic customer",
    revealMessageBody: () => null,
  };
  const cursors = createStaffQueryCursorCodec(Buffer.alloc(32, 71));
  const evaluator = (_role: unknown, permission: unknown) =>
    permission !== "contacts.read_sensitive" || sensitive;
  return {
    getContact,
    getConversation,
    revealContactIdentity,
    queries: createStaffConversationQueryUseCases(store, revealer, cursors, evaluator),
    queriesV2: createStaffConversationQueryV2UseCases(store, revealer, cursors, evaluator),
  };
};
describe("Instagram V1 compatibility and shared V2 staff authorization", () => {
  it("preserves masked V2 projection without decrypting when sensitive permission is denied", async () => {
    const test = fixture(stored, false);
    const result = await test.queriesV2.getContact({
      authorization: await authorization(),
      input: { id: IDS.contact },
    });
    if (!result.ok) throw new Error("Expected masked contact");
    expect(result.value.sensitive_fields_visible).toBe(false);
    expect(result.value.identities[0]?.value).toBeNull();
    expect(test.revealContactIdentity).not.toHaveBeenCalled();
  });
  it("omits Instagram identities before V1 sensitive decryption and leaves legacy identities unchanged", async () => {
    const test = fixture();
    const result = await test.queries.getContact({
      authorization: await authorization(),
      input: { id: IDS.contact },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected readable contact");
    expect(isSchemaValue(StaffContactSchema, result.value)).toBe(true);
    expect(result.value.identities).toHaveLength(1);
    expect(result.value.identities[0]?.identity_type).toBe("telegram_user");
    expect(test.revealContactIdentity).toHaveBeenCalledOnce();
    expect(test.revealContactIdentity.mock.calls[0]).toBeDefined();
  });
  it.each(["owner", "staff"] as const)(
    "V2 retains existing sensitive permission for %s",
    async (role) => {
      const test = fixture();
      const result = await test.queriesV2.getContact({
        authorization: await authorization(role),
        input: { id: IDS.contact },
      });
      if (!result.ok) throw new Error("Expected readable contact");
      expect(isSchemaValue(StaffContactV2Schema, result.value)).toBe(true);
      expect(result.value.identities[0]?.identity_type).toBe("instagram_user");
      expect(result.value.identities[0]?.value).toBe("synthetic-authorized-identity");
      expect(test.revealContactIdentity.mock.calls).toHaveLength(2);
    },
  );
  it.each(["getConversation", "listConversations"] as const)(
    "projects V1 null and V2 Instagram with shared %s queries",
    async (method) => {
      const test = fixture();
      const actor = await authorization();
      const v1 =
        method === "getConversation"
          ? await test.queries.getConversation({
              authorization: actor,
              input: { id: IDS.conversation },
            })
          : await test.queries.listConversations({ authorization: actor, input: {} });
      const v2 =
        method === "getConversation"
          ? await test.queriesV2.getConversation({
              authorization: actor,
              input: { id: IDS.conversation },
            })
          : await test.queriesV2.listConversations({ authorization: actor, input: {} });
      if (!v1.ok || !v2.ok) throw new Error("Expected readable conversation");
      const oldValue = "items" in v1.value ? v1.value.items[0] : v1.value;
      const newValue = "items" in v2.value ? v2.value.items[0] : v2.value;
      expect(isSchemaValue(StaffConversationSchema, oldValue)).toBe(true);
      expect(isSchemaValue(StaffConversationV2Schema, newValue)).toBe(true);
      expect(oldValue?.participant.identity_type).toBe(null);
      expect(newValue?.participant.identity_type).toBe("instagram_user");
    },
  );
  it("never decrypts anonymized identities in either version", async () => {
    const anonymous: StoredContact = {
      ...stored,
      status: "anonymized",
      anonymized_at: instant,
      displayNameCiphertext: null,
      identities: stored.identities.map((identity) => ({
        ...identity,
        display_redacted: null,
        status: "anonymized",
        valueCiphertext: null,
      })),
    };
    const test = fixture(anonymous);
    for (const queries of [test.queries, test.queriesV2]) {
      const result = await queries.getContact({
        authorization: await authorization(),
        input: { id: IDS.contact },
      });
      expect(result.ok).toBe(true);
    }
    expect(test.revealContactIdentity).not.toHaveBeenCalled();
  });
  it.each(["contacts", "conversations", "conversations-list"] as const)(
    "serves parallel authenticated %s routes with identical cross-tenant denial",
    async (kind) => {
      const auth = staffFixture();
      const test = fixture();
      const api = createApi({ staffAuth: auth.staffAuth, staffConversations: test });
      const path =
        kind === "contacts"
          ? `contacts/${IDS.contact}`
          : kind === "conversations"
            ? `conversations/${IDS.conversation}`
            : "conversations";
      try {
        for (const version of [1, 2]) {
          const response = await api.inject({
            method: "GET",
            url: `/v${version}/staff/${path}`,
            headers: auth.headers,
          });
          expect(response.statusCode).toBe(200);
          const body: unknown = response.json();
          if (typeof body !== "object" || body === null || !("data" in body))
            throw new Error("Expected staff response envelope");
          const data = body.data;
          if (kind === "contacts")
            expect(
              isSchemaValue(version === 1 ? StaffContactSchema : StaffContactV2Schema, data),
            ).toBe(true);
          const denied = await api.inject({
            method: "GET",
            url: `/v${version}/staff/${path}`,
            headers: { ...auth.headers, "x-organization-context": IDS.otherOrganization },
          });
          expect(denied.statusCode).toBe(403);
          const badOrigin = await api.inject({
            method: "GET",
            url: `/v${version}/staff/${path}`,
            headers: { ...auth.headers, origin: "https://untrusted.example.test" },
          });
          expect(badOrigin.statusCode).toBe(403);
          expect(badOrigin.headers).not.toHaveProperty("access-control-allow-origin");
          const preflight = await api.inject({
            method: "OPTIONS",
            url: `/v${version}/staff/${path}`,
            headers: { origin: auth.headers["origin"] },
          });
          expect(preflight.statusCode).toBe(204);
          expect(preflight.headers["access-control-allow-origin"]).toBe(auth.headers["origin"]);
          expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
          const unauthenticated = await api.inject({
            method: "GET",
            url: `/v${version}/staff/${path}`,
            headers: {
              origin: auth.headers["origin"],
              "x-organization-context": IDS.organization,
            },
          });
          expect(unauthenticated.statusCode).toBe(401);
          const untrustedPreflight = await api.inject({
            method: "OPTIONS",
            url: `/v${version}/staff/${path}`,
            headers: { origin: "https://untrusted.example.test" },
          });
          expect(untrustedPreflight.statusCode).toBe(403);
        }
      } finally {
        await api.close();
      }
    },
  );
});
