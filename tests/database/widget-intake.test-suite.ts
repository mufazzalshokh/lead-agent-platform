import { createHash } from "node:crypto";

import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createWidgetUseCases } from "../../packages/application/src/index.js";
import { createWidgetSecurityConfig } from "../../packages/config/src/index.js";
import type { ChannelConnectionId, OrganizationId } from "../../packages/contracts/src/index.js";
import {
  createWidgetPersistenceStore,
  type TenantDatabaseRuntime,
} from "../../packages/database/src/index.js";
import {
  createCustomerDataProtection,
  createWidgetRateLimiter,
  createWidgetTokenService,
} from "../../packages/security/src/index.js";

type Options = Readonly<{
  channelId: ChannelConnectionId;
  organizationId: OrganizationId;
  privilegedPool(): Pool;
  runtime(): TenantDatabaseRuntime;
  seed(): Promise<void>;
}>;

const NOW = new Date("2026-09-15T10:00:00.000Z");
const ORIGIN = "https://clinic.example";
const WIDGET_KEY = "public_widget_key_123456789012345";
const OTHER_ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41cf1" as OrganizationId;
const OTHER_CHANNEL_ID = "0193f1a8-7f65-7c28-a434-a10796c41cf2" as ChannelConnectionId;

export const registerWidgetIntakeTests = (options: Options): void => {
  const createFixture = () => {
    const customerData = createCustomerDataProtection({
      currentEncryptionKey: Buffer.alloc(32, 21),
      currentKeyId: "s10-test-v1",
      lookupKey: Buffer.alloc(32, 22),
    });
    const tokens = createWidgetTokenService(
      createWidgetSecurityConfig(Buffer.alloc(32, 23).toString("base64url")),
    );
    return createWidgetUseCases({
      clock: () => NOW,
      dataProtector: customerData,
      persistence: createWidgetPersistenceStore(options.runtime(), { clock: () => NOW }),
      rateLimiter: createWidgetRateLimiter({ clock: () => NOW, salt: Buffer.alloc(32, 24) }),
      routeResolver: {
        resolveInboundRoute: (_routeType, routeHash) =>
          Promise.resolve(
            Buffer.from(routeHash).equals(createHash("sha256").update(WIDGET_KEY).digest())
              ? { channelConnectionId: options.channelId, organizationId: options.organizationId }
              : null,
          ),
      },
      tokens,
    });
  };

  describe("S10.A secure Widget persistence", () => {
    it("bootstraps without business state, then atomically binds the S9 inbound result", async () => {
      await options.seed();
      const pool = options.privilegedPool();
      const useCases = createFixture();
      const bootstrap = await useCases.bootstrap({
        clientIp: "127.0.0.1",
        origin: ORIGIN,
        pageUrl: "https://spoof.invalid/tenant",
        requestedLocale: "uz",
        widgetKey: WIDGET_KEY,
      });
      const empty = await pool.query<{ count: number }>(
        "select ((select count(*) from contacts) + (select count(*) from leads) + (select count(*) from conversations) + (select count(*) from messages))::int as count",
      );
      expect(empty.rows[0]?.count).toBe(0);

      const created = await useCases.createConversation({
        bearerToken: bootstrap.bearerToken,
        body: {
          client_message_id: "browser.message-1",
          kind: "text",
          locale_hint: "uz",
          text: "<script>data only</script>",
        },
        idempotencyKey: "request-key-1",
        origin: ORIGIN,
      });
      expect(created.conversation.id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(created.conversation.status).toBe("open");
      const counts = await pool.query<{
        contacts: number;
        conversations: number;
        idempotency: number;
        leads: number;
        messages: number;
        sessions: number;
      }>(
        `select (select count(*)::int from contacts) contacts, (select count(*)::int from leads) leads, (select count(*)::int from conversations) conversations, (select count(*)::int from messages) messages, (select count(*)::int from widget_sessions where conversation_id is not null) sessions, (select count(*)::int from idempotency_keys) idempotency`,
      );
      expect(counts.rows[0]).toEqual({
        contacts: 1,
        conversations: 1,
        idempotency: 1,
        leads: 1,
        messages: 1,
        sessions: 1,
      });
      const identityTypes = await pool.query<{ identity_type: string }>(
        "select identity_type from contact_identities order by identity_type",
      );
      expect(identityTypes.rows.map(({ identity_type }) => identity_type)).toEqual([
        "widget_participant",
      ]);
      await expect(
        useCases.getConversation({
          bearerToken: bootstrap.bearerToken,
          conversationId: created.conversation.id,
          origin: ORIGIN,
        }),
      ).rejects.toMatchObject({ code: "token_invalid" });
    });

    it("converges concurrent first-message retries and keeps later logical messages distinct", async () => {
      await options.seed();
      const pool = options.privilegedPool();
      const useCases = createFixture();
      const bootstrap = await useCases.bootstrap({
        clientIp: "127.0.0.1",
        origin: ORIGIN,
        pageUrl: ORIGIN,
        requestedLocale: "uz",
        widgetKey: WIDGET_KEY,
      });
      const command = {
        bearerToken: bootstrap.bearerToken,
        body: {
          client_message_id: "browser.message-1",
          kind: "text" as const,
          locale_hint: null,
          text: "Salom",
        },
        idempotencyKey: "request-key-1",
        origin: ORIGIN,
      };
      const [first, replay] = await Promise.all([
        useCases.createConversation(command),
        useCases.createConversation(command),
      ]);
      expect(replay.conversation.id).toBe(first.conversation.id);
      expect(replay.messageId).toBe(first.messageId);
      const duplicateMessage = {
        bearerToken: first.bearerToken,
        body: {
          client_message_id: "browser.message-2",
          kind: "text" as const,
          locale_hint: null,
          text: "A",
        },
        conversationId: first.conversation.id,
        idempotencyKey: "request-key-2",
        origin: ORIGIN,
      };
      const [message, duplicate] = await Promise.all([
        useCases.postMessage(duplicateMessage),
        useCases.postMessage(duplicateMessage),
      ]);
      expect(duplicate.messageId).toBe(message.messageId);
      await useCases.postMessage({
        bearerToken: first.bearerToken,
        body: {
          client_message_id: "browser.message-3",
          kind: "text",
          locale_hint: null,
          text: "B",
        },
        conversationId: first.conversation.id,
        idempotencyKey: "request-key-3",
        origin: ORIGIN,
      });
      await expect(
        useCases.postMessage({
          bearerToken: first.bearerToken,
          body: {
            client_message_id: "browser.message-4",
            kind: "text",
            locale_hint: null,
            text: "different body",
          },
          conversationId: first.conversation.id,
          idempotencyKey: "request-key-3",
          origin: ORIGIN,
        }),
      ).rejects.toMatchObject({ code: "idempotency_conflict" });
      await expect(
        useCases.createConversation({
          ...command,
          body: { ...command.body, text: "different first body" },
        }),
      ).rejects.toMatchObject({ code: "idempotency_conflict" });
      expect((await pool.query("select id from contacts")).rowCount).toBe(1);
      expect((await pool.query("select id from leads")).rowCount).toBe(1);
      expect((await pool.query("select id from conversations")).rowCount).toBe(1);
      expect((await pool.query("select id from messages")).rowCount).toBe(3);
    });

    it("fails closed for unknown routes, disabled origins, and disabled channels", async () => {
      await options.seed();
      const pool = options.privilegedPool();
      const useCases = createFixture();
      await expect(
        useCases.bootstrap({
          clientIp: "127.0.0.1",
          origin: ORIGIN,
          pageUrl: ORIGIN,
          requestedLocale: "uz",
          widgetKey: "unknown_widget_key_123456789012345",
        }),
      ).rejects.toMatchObject({ code: "channel_unavailable" });
      await pool.query(
        "update widget_allowed_origins set status = 'disabled' where organization_id = $1",
        [options.organizationId],
      );
      await expect(
        useCases.bootstrap({
          clientIp: "127.0.0.1",
          origin: ORIGIN,
          pageUrl: ORIGIN,
          requestedLocale: "uz",
          widgetKey: WIDGET_KEY,
        }),
      ).rejects.toMatchObject({ code: "channel_unavailable" });
      await pool.query(
        "update widget_allowed_origins set status = 'active' where organization_id = $1",
        [options.organizationId],
      );
      await pool.query(
        "update channel_connections set status = 'disabled' where organization_id = $1",
        [options.organizationId],
      );
      await expect(
        useCases.bootstrap({
          clientIp: "127.0.0.1",
          origin: ORIGIN,
          pageUrl: ORIGIN,
          requestedLocale: "uz",
          widgetKey: WIDGET_KEY,
        }),
      ).rejects.toMatchObject({ code: "channel_unavailable" });
      expect((await pool.query("select id from widget_sessions")).rowCount).toBe(0);
    });

    it("fails closed for idle, revoked, or JTI-mismatched server sessions", async () => {
      await options.seed();
      const pool = options.privilegedPool();
      const useCases = createFixture();
      const bootstrap = await useCases.bootstrap({
        clientIp: "127.0.0.1",
        origin: ORIGIN,
        pageUrl: ORIGIN,
        requestedLocale: "uz",
        widgetKey: WIDGET_KEY,
      });
      const initial = {
        bearerToken: bootstrap.bearerToken,
        body: {
          client_message_id: "browser.message-1",
          kind: "text" as const,
          locale_hint: null,
          text: "Salom",
        },
        idempotencyKey: "request-key-1",
        origin: ORIGIN,
      };
      await pool.query(
        "update widget_sessions set issued_at = $1::timestamptz - interval '31 minutes', last_seen_at = $1::timestamptz - interval '30 minutes'",
        [NOW],
      );
      await expect(useCases.createConversation(initial)).rejects.toMatchObject({
        code: "token_invalid",
      });
      await pool.query(
        "update widget_sessions set last_seen_at = $1, status = 'revoked', revoked_at = $1, revocation_reason = 'test'",
        [NOW],
      );
      await expect(useCases.createConversation(initial)).rejects.toMatchObject({
        code: "token_invalid",
      });
      await pool.query(
        "update widget_sessions set status = 'active', revoked_at = null, revocation_reason = null, session_token_jti_hash = $1",
        [Buffer.alloc(32, 99)],
      );
      await expect(useCases.createConversation(initial)).rejects.toMatchObject({
        code: "token_invalid",
      });
      expect((await pool.query("select id from contacts")).rowCount).toBe(0);
    });

    it("rejects signed cross-tenant/channel claims and never extends absolute expiry", async () => {
      await options.seed();
      const pool = options.privilegedPool();
      const useCases = createFixture();
      const tokens = createWidgetTokenService(
        createWidgetSecurityConfig(Buffer.alloc(32, 23).toString("base64url")),
      );
      const bootstrap = await useCases.bootstrap({
        clientIp: "127.0.0.1",
        origin: ORIGIN,
        pageUrl: ORIGIN,
        requestedLocale: "uz",
        widgetKey: WIDGET_KEY,
      });
      const created = await useCases.createConversation({
        bearerToken: bootstrap.bearerToken,
        body: {
          client_message_id: "browser.message-1",
          kind: "text",
          locale_hint: null,
          text: "Salom",
        },
        idempotencyKey: "request-key-1",
        origin: ORIGIN,
      });
      const claims = await tokens.verify(created.bearerToken, NOW);
      const wrongTenant = await tokens.issue({
        ...claims,
        organizationId: OTHER_ORGANIZATION_ID,
      });
      const wrongChannel = await tokens.issue({
        ...claims,
        channelConnectionId: OTHER_CHANNEL_ID,
      });
      for (const bearerToken of [wrongTenant, wrongChannel]) {
        await expect(
          useCases.getConversation({
            bearerToken,
            conversationId: created.conversation.id,
            origin: ORIGIN,
          }),
        ).rejects.toMatchObject({ code: "token_invalid" });
      }

      const before = await pool.query<{ expires_at: Date }>(
        "select expires_at from widget_sessions where organization_id = $1",
        [options.organizationId],
      );
      await useCases.getConversation({
        bearerToken: created.bearerToken,
        conversationId: created.conversation.id,
        origin: ORIGIN,
      });
      const after = await pool.query<{ expires_at: Date }>(
        "select expires_at from widget_sessions where organization_id = $1",
        [options.organizationId],
      );
      expect(after.rows[0]?.expires_at).toEqual(before.rows[0]?.expires_at);
    });

    it("fails closed for wrong Origin and excludes staff-internal messages", async () => {
      await options.seed();
      const pool = options.privilegedPool();
      const useCases = createFixture();
      const bootstrap = await useCases.bootstrap({
        clientIp: "127.0.0.1",
        origin: ORIGIN,
        pageUrl: ORIGIN,
        requestedLocale: "uz",
        widgetKey: WIDGET_KEY,
      });
      await expect(
        useCases.createConversation({
          bearerToken: bootstrap.bearerToken,
          body: {
            client_message_id: "browser.message-1",
            kind: "text",
            locale_hint: null,
            text: "Salom",
          },
          idempotencyKey: "request-key-1",
          origin: "https://evilclinic.example",
        }),
      ).rejects.toMatchObject({ code: "origin_not_allowed" });
      expect((await pool.query("select id from contacts")).rowCount).toBe(0);
      const created = await useCases.createConversation({
        bearerToken: bootstrap.bearerToken,
        body: {
          client_message_id: "browser.message-1",
          kind: "text",
          locale_hint: null,
          text: "<script>data only</script>",
        },
        idempotencyKey: "request-key-1",
        origin: ORIGIN,
      });
      await pool.query(
        `update messages
            set direction = 'staff_internal', sender_type = 'member', sender_contact_id = null,
                sender_membership_id = (select id from memberships where organization_id = $1 limit 1)
          where organization_id = $1 and id = $2`,
        [options.organizationId, created.messageId],
      );
      await expect(
        useCases.listMessages({
          bearerToken: created.bearerToken,
          conversationId: created.conversation.id,
          origin: ORIGIN,
        }),
      ).resolves.toEqual({ hasMore: false, items: [] });
    });

    it("rolls back business state, session binding, and JTI rotation as one transaction", async () => {
      await options.seed();
      const pool = options.privilegedPool();
      const useCases = createFixture();
      const tokens = createWidgetTokenService(
        createWidgetSecurityConfig(Buffer.alloc(32, 23).toString("base64url")),
      );
      const bootstrap = await useCases.bootstrap({
        clientIp: "127.0.0.1",
        origin: ORIGIN,
        pageUrl: ORIGIN,
        requestedLocale: "uz",
        widgetKey: WIDGET_KEY,
      });
      const bootstrapClaims = await tokens.verify(bootstrap.bearerToken, NOW);
      await pool.query("drop trigger if exists s10_reject_widget_binding on widget_sessions");
      await pool.query(`create or replace function public.s10_reject_widget_binding()
        returns trigger language plpgsql as $$
        begin
          if new.conversation_id is not null then
            raise exception 'forced S10 binding rollback';
          end if;
          return new;
        end
        $$`);
      await pool.query(`create trigger s10_reject_widget_binding
        before update on widget_sessions for each row
        execute function public.s10_reject_widget_binding()`);
      try {
        await expect(
          useCases.createConversation({
            bearerToken: bootstrap.bearerToken,
            body: {
              client_message_id: "browser.message-1",
              kind: "text",
              locale_hint: null,
              text: "Salom",
            },
            idempotencyKey: "request-key-1",
            origin: ORIGIN,
          }),
        ).rejects.toThrow("forced S10 binding rollback");
      } finally {
        await pool.query("drop trigger if exists s10_reject_widget_binding on widget_sessions");
        await pool.query("drop function if exists public.s10_reject_widget_binding() cascade");
      }
      const state = await pool.query<{
        business_rows: number;
        conversation_id: string | null;
        idempotency_rows: number;
        session_token_jti_hash: Buffer;
      }>(
        `select
           ((select count(*) from contacts) + (select count(*) from leads) +
            (select count(*) from conversations) + (select count(*) from messages))::int business_rows,
           (select conversation_id::text from widget_sessions limit 1) conversation_id,
           (select session_token_jti_hash from widget_sessions limit 1) session_token_jti_hash,
           (select count(*)::int from idempotency_keys) idempotency_rows`,
      );
      expect(state.rows[0]).toMatchObject({
        business_rows: 0,
        conversation_id: null,
        idempotency_rows: 0,
      });
      expect(state.rows[0]?.session_token_jti_hash).toEqual(
        Buffer.from(tokens.hashJti(bootstrapClaims.jti)),
      );
    });

    it.each(["resolved", "closed"] as const)(
      "rejects a %s Conversation without reopening or creating another cycle",
      async (terminalStatus) => {
        await options.seed();
        const pool = options.privilegedPool();
        const useCases = createFixture();
        const bootstrap = await useCases.bootstrap({
          clientIp: "127.0.0.1",
          origin: ORIGIN,
          pageUrl: ORIGIN,
          requestedLocale: "uz",
          widgetKey: WIDGET_KEY,
        });
        const created = await useCases.createConversation({
          bearerToken: bootstrap.bearerToken,
          body: {
            client_message_id: "browser.message-1",
            kind: "text",
            locale_hint: null,
            text: "Salom",
          },
          idempotencyKey: "request-key-1",
          origin: ORIGIN,
        });
        const terminalUpdate =
          terminalStatus === "closed"
            ? `update conversations
                  set status = 'closed', automation_mode = 'paused',
                      resolved_at = $3, closed_at = $3
                where organization_id = $1 and id = $2`
            : `update conversations
                  set status = 'resolved', automation_mode = 'paused',
                      resolved_at = $3, closed_at = null
                where organization_id = $1 and id = $2`;
        await pool.query(terminalUpdate, [options.organizationId, created.conversation.id, NOW]);
        await expect(
          useCases.postMessage({
            bearerToken: created.bearerToken,
            body: {
              client_message_id: "browser.message-2",
              kind: "text",
              locale_hint: null,
              text: "Yana savol",
            },
            conversationId: created.conversation.id,
            idempotencyKey: "request-key-2",
            origin: ORIGIN,
          }),
        ).rejects.toMatchObject({ code: "business_rule_failed" });
        expect((await pool.query("select id from conversations")).rowCount).toBe(1);
        expect((await pool.query("select id from messages")).rowCount).toBe(1);
      },
    );
  });
};
