import { describe, expect, it, vi } from "vitest";

import {
  WidgetManagementError,
  createWidgetManagementUseCases,
  type WidgetManagementStore,
} from "../../packages/application/src/index.js";
import type { ChannelConnectionId } from "../../packages/contracts/src/index.js";
import { authorization, IDS, NOW } from "../telegram/fixtures.js";

const CHANNEL_ID = IDS.channel as ChannelConnectionId;
const PUBLISHABLE_KEY = "w".repeat(43);

const createStore = () => {
  const configure = vi.fn<WidgetManagementStore["configure"]>((input) =>
    Promise.resolve({
      channelConnectionId: CHANNEL_ID,
      publishableKey: input.publishableKey,
      websiteOrigin: input.websiteOrigin,
    }),
  );
  const get = vi.fn<WidgetManagementStore["get"]>(() => Promise.resolve(null));
  const widgetStore: WidgetManagementStore = {
    configure,
    get,
  };
  return { configure, get, widgetStore };
};

describe("S22 Widget owner configuration", () => {
  it("normalizes an exact HTTPS origin and hashes the public key for routing", async () => {
    const { configure, widgetStore } = createStore();
    const useCases = createWidgetManagementUseCases({
      clock: () => NOW,
      randomPublishableKey: () => PUBLISHABLE_KEY,
      store: widgetStore,
    });
    const owner = await authorization("owner");
    await expect(
      useCases.configure({ authorization: owner, websiteOrigin: "https://Clinic.Example" }),
    ).resolves.toMatchObject({
      channelConnectionId: CHANNEL_ID,
      publishableKey: PUBLISHABLE_KEY,
      websiteOrigin: "https://clinic.example",
    });
    expect(configure).toHaveBeenCalledOnce();
    const input = configure.mock.calls[0]?.[0];
    expect(input?.actor).toBe(owner);
    expect(input?.now).toBe(NOW);
    expect(input?.publishableKey).toBe(PUBLISHABLE_KEY);
    expect(input?.publishableKeyHash).toBeInstanceOf(Uint8Array);
    expect(input?.websiteOrigin).toBe("https://clinic.example");
  });

  it("allows owner/admin only and rejects non-HTTPS or path-bearing origins", async () => {
    const useCases = createWidgetManagementUseCases({
      randomPublishableKey: () => PUBLISHABLE_KEY,
      store: createStore().widgetStore,
    });
    await expect(
      useCases.configure({
        authorization: await authorization("staff"),
        websiteOrigin: "https://clinic.example",
      }),
    ).rejects.toEqual(new WidgetManagementError("permission_denied"));
    await expect(
      useCases.configure({
        authorization: await authorization("admin"),
        websiteOrigin: "http://clinic.example",
      }),
    ).rejects.toEqual(new WidgetManagementError("validation_failed"));
    await expect(
      useCases.configure({
        authorization: await authorization("owner"),
        websiteOrigin: "https://clinic.example/path",
      }),
    ).rejects.toEqual(new WidgetManagementError("validation_failed"));
  });

  it("does not accept malformed key generation or reveal a different tenant", async () => {
    const { configure, widgetStore } = createStore();
    const useCases = createWidgetManagementUseCases({
      randomPublishableKey: () => "short",
      store: widgetStore,
    });
    await expect(
      useCases.configure({
        authorization: await authorization("owner"),
        websiteOrigin: "https://clinic.example",
      }),
    ).rejects.toEqual(new WidgetManagementError("validation_failed"));
    expect(configure).not.toHaveBeenCalled();
  });
});
