import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../apps/api/src/app.js";
import { normalizeTelegramUpdate } from "../../packages/integrations/src/telegram/normalizer.js";
import { businessMessage, NOW, platformConfig } from "./fixtures.js";

describe("Telegram ingress capacity", () => {
  it("bounds concurrent processing and releases capacity after durable acceptance", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processUpdate = vi.fn(async () => {
      await pending;
      return { status: "accepted" as const };
    });
    const api = createApi({
      telegramWebhook: {
        normalizeUpdate: (raw) => normalizeTelegramUpdate(raw, NOW),
        processUpdate,
        webhookSecret: platformConfig.webhookSecret,
      },
    });
    const request = {
      method: "POST" as const,
      url: "/v1/webhooks/telegram",
      payload: businessMessage(),
      headers: { "x-telegram-bot-api-secret-token": platformConfig.webhookSecret },
    };
    const requests = Array.from({ length: 32 }, () =>
      api.inject(request).then((response) => response),
    );
    try {
      await vi.waitFor(() => expect(processUpdate).toHaveBeenCalledTimes(32));
      expect((await api.inject(request)).statusCode).toBe(503);
      release?.();
      expect((await Promise.all(requests)).every((response) => response.statusCode === 202)).toBe(
        true,
      );
      expect((await api.inject(request)).statusCode).toBe(202);
    } finally {
      release?.();
      await Promise.all(requests);
      await api.close();
    }
  });
});
