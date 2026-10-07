import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { buildWidgetFrameDocument, buildWidgetLoader } from "./widget-embed.js";

const API = "https://platform.example";
const HOST = "https://synthetic-host.example";
const VERSION = "lead-agent.widget.v1";
const GRANT = `wex1.${"a".repeat(64)}.${"b".repeat(64)}.${"c".repeat(32)}`;
const UUID = "12345678-1234-4234-8234-123456789012";

type Handler = (event: unknown) => void;

class Element {
  readonly children: Element[] = [];
  readonly listeners = new Map<string, Handler[]>();
  readonly style: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  parentNode: Element | null = null;
  hidden = false;
  disabled = false;
  focused = false;
  textContent = "";
  value = "";
  name = "";
  target = "";
  type = "";
  method = "";
  action = "";
  title = "";
  sandbox = "";
  scrollTop = 0;
  scrollHeight = 0;
  onSubmit: ((form: Element) => void) | undefined;

  constructor(readonly tagName: string) {}

  append(...children: Element[]): void {
    for (const child of children) {
      this.children.push(child);
      child.parentNode = this;
    }
  }

  remove(): void {
    if (this.parentNode !== null) {
      const index = this.parentNode.children.indexOf(this);
      if (index !== -1) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(type: string, handler: Handler): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  querySelectorAll(): Element[] {
    return [];
  }

  focus(): void {
    this.focused = true;
  }

  submit(): void {
    this.onSubmit?.(this);
  }
}

class ScriptElement extends Element {
  constructor() {
    super("script");
  }
}

class FrameElement extends Element {
  readonly contentWindow = Object.freeze({ frame: true });

  constructor() {
    super("iframe");
  }
}

type FrameSession = Readonly<{
  element: FrameElement;
  instance: string;
  close: Element;
  input: Element;
  timers: Map<number, () => void>;
}>;

type SetupOptions = Readonly<{
  label?: string;
  grantFailure?: "http" | "malformed" | "network";
  redeem?: "success" | "failure" | "pending";
  submitFailures?: number;
}>;

const settle = async (): Promise<void> => {
  await setImmediate();
  await setImmediate();
};

const response = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const setup = (options: SetupOptions = {}) => {
  const script = new ScriptElement();
  script.dataset = {
    widgetKey: "k".repeat(43),
    locale: "uz",
    ...(options.label === undefined ? {} : { label: options.label }),
  };
  const body = new Element("body");
  const listeners: Handler[] = [];
  const sessions: FrameSession[] = [];
  const requests: { realm: "host" | "frame"; path: string }[] = [];
  const posts: { type: string; target: string; keys: string[] }[] = [];
  let grantRequests = 0;
  let redeemRequests = 0;
  let formSubmissions = 0;
  let pendingRedeem: ((value: Response) => void) | undefined;

  const dispatchMessage = (event: unknown): void => {
    for (const listener of listeners) listener(event);
  };
  const liveFrames = (): FrameElement[] =>
    body.children.filter((element) => element instanceof FrameElement);
  const field = (form: Element, name: string): string => {
    const input = form.children.find((element) => element.name === name);
    if (input === undefined) throw new TypeError(`Missing synthetic ${name} field`);
    return input.value;
  };

  const submit = (form: Element): void => {
    formSubmissions += 1;
    if (formSubmissions <= (options.submitFailures ?? 0)) {
      throw new TypeError("Synthetic form submission failure");
    }
    const element = liveFrames().find((frame) => frame.name === form.target);
    if (element === undefined) throw new TypeError("Expected target iframe");
    const instance = field(form, "instance");
    const html = buildWidgetFrameDocument({
      apiOrigin: API,
      embeddingOrigin: HOST,
      exchangeGrant: field(form, "exchange_grant"),
      instance,
      nonce: "n".repeat(32),
    });
    const generated = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(html)?.[1];
    if (generated === undefined) throw new TypeError("Expected generated frame script");
    const nodes = new Map(
      ["messages", "composer", "input", "send", "status", "welcome", "close"].map((name) => [
        name,
        new Element(name === "composer" ? "form" : "div"),
      ]),
    );
    const node = (name: string): Element => {
      const found = nodes.get(name);
      if (found === undefined) throw new TypeError("Missing synthetic frame element");
      return found;
    };
    const timers = new Map<number, () => void>();
    let timerSequence = 0;
    sessions.push({ element, instance, close: node("close"), input: node("input"), timers });
    runInNewContext(
      generated,
      {
        document: {
          querySelector: (selector: string) => node(selector.slice(1)),
          createElement: (tag: string) => new Element(tag),
        },
        parent: {
          postMessage(data: unknown, target: unknown) {
            if (
              typeof data !== "object" ||
              data === null ||
              !("type" in data) ||
              typeof data.type !== "string" ||
              target !== HOST
            ) {
              throw new TypeError("Unexpected synthetic frame postMessage");
            }
            posts.push({ type: data.type, target, keys: Object.keys(data).sort() });
            dispatchMessage({ source: element.contentWindow, origin: API, data });
          },
        },
        fetch: async (url: string) => {
          const path = new URL(url).pathname;
          requests.push({ realm: "frame", path });
          if (path !== "/v1/widget/embed-sessions/redeem") {
            throw new TypeError("Unexpected synthetic message/provider dispatch");
          }
          redeemRequests += 1;
          if (options.redeem === "pending" && redeemRequests === 1) {
            return new Promise<Response>((resolve) => {
              pendingRedeem = resolve;
            });
          }
          if (options.redeem === "failure" && redeemRequests === 1) {
            return response({ code: "token_invalid" }, 401);
          }
          return response({
            data: {
              bearer_token: "synthetic-memory-only-bearer",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
          });
        },
        history: { replaceState() {} },
        crypto: { randomUUID: () => UUID },
        performance: { now: () => 0, measure() {} },
        setTimeout(callback: () => void) {
          timerSequence += 1;
          timers.set(timerSequence, callback);
          return timerSequence;
        },
        clearTimeout: (id: number) => timers.delete(id),
      },
      { timeout: 1_000 },
    );
  };

  const browser = {
    document: {
      currentScript: script,
      body,
      createElement(tag: string) {
        const element = tag === "iframe" ? new FrameElement() : new Element(tag);
        if (tag === "form") element.onSubmit = submit;
        return element;
      },
    },
    HTMLScriptElement: ScriptElement,
    crypto: { randomUUID: () => UUID },
    location: { href: `${HOST}/` },
    URL,
    window: {
      innerHeight: 900,
      addEventListener(type: string, handler: Handler) {
        if (type === "message") listeners.push(handler);
      },
    },
    fetch: (url: string): Promise<Response> => {
      const path = new URL(url).pathname;
      requests.push({ realm: "host", path });
      if (path !== "/v1/widget/embed-grants") {
        throw new TypeError("Unexpected synthetic host dispatch");
      }
      grantRequests += 1;
      if (grantRequests === 1 && options.grantFailure !== undefined) {
        if (options.grantFailure === "network") {
          return Promise.reject(new TypeError("Synthetic transport failure"));
        }
        return Promise.resolve(
          options.grantFailure === "http"
            ? response({ code: "dependency_unavailable" }, 503)
            : response({ data: { exchange_grant: "invalid" } }),
        );
      }
      return Promise.resolve(
        response({
          data: {
            exchange_grant: GRANT,
            iframe_url: `${API}/widget/frame`,
            iframe_origin: API,
          },
        }),
      );
    },
  };
  const mount = (): void => {
    runInNewContext(buildWidgetLoader(API), browser, { timeout: 1_000 });
  };
  mount();
  const launcher = body.children.find((element) => element.tagName === "button");
  if (launcher === undefined) throw new TypeError("Expected synthetic launcher");
  const latest = (): FrameSession => {
    const current = sessions.at(-1);
    if (current === undefined) throw new TypeError("Expected generated frame session");
    return current;
  };

  return {
    body,
    launcher,
    sessions,
    posts,
    requests,
    liveFrames,
    latest,
    mount,
    dispatchMessage,
    async click() {
      if (!launcher.disabled) launcher.dispatch("click");
      await settle();
    },
    async close() {
      latest().close.dispatch("click");
      await settle();
    },
    async completeRedeem() {
      if (pendingRedeem === undefined) throw new TypeError("Expected pending synthetic redemption");
      pendingRedeem(
        response({
          data: {
            bearer_token: "synthetic-memory-only-bearer",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
      );
      await settle();
    },
    message(type: string, extra: Record<string, unknown> = {}) {
      const session = latest();
      dispatchMessage({
        source: session.element.contentWindow,
        origin: API,
        data: { version: VERSION, instance: session.instance, type, ...extra },
      });
    },
    counts: () => ({ grant: grantRequests, redeem: redeemRequests, submits: formSubmissions }),
  };
};

describe("generated Widget loader/frame handshake and lifecycle", () => {
  it.each([undefined, "Talk to the synthetic clinic"])(
    "restores label %s after the exact frame READY and CLOSE, then reuses that session",
    async (label) => {
      const state = setup(label === undefined ? {} : { label });
      const expected = label ?? "Chat with us";
      await state.click();
      expect(state.posts).toEqual([
        { type: "READY", target: HOST, keys: ["instance", "type", "version"] },
      ]);
      expect(state.launcher.textContent).toBe(expected);
      expect(state.launcher.disabled).toBe(false);
      expect(state.latest().input.focused).toBe(true);
      await state.close();
      expect(state.launcher.hidden).toBe(false);
      expect(state.launcher.textContent).toBe(expected);
      expect(state.latest().element.style["display"]).toBe("none");
      await state.click();
      expect(state.launcher.hidden).toBe(true);
      expect(state.latest().element.style["display"]).toBe("block");
      expect(state.counts()).toEqual({ grant: 1, redeem: 1, submits: 1 });
    },
  );

  it("ignores duplicate mount/click/READY without creating another grant or redeem", async () => {
    const state = setup();
    state.mount();
    expect(state.body.children.filter((element) => element.tagName === "button")).toHaveLength(1);
    state.launcher.dispatch("click");
    state.launcher.dispatch("click");
    await settle();
    state.message("READY");
    state.message("READY");
    expect(state.liveFrames()).toHaveLength(1);
    expect(state.counts()).toEqual({ grant: 1, redeem: 1, submits: 1 });
    expect(state.launcher.textContent).toBe("Chat with us");
  });

  it.each(["origin", "source", "instance", "version", "extra", "malformed", "unknown"])(
    "ignores foreign or malformed %s messages without changing lifecycle",
    async (kind) => {
      const state = setup();
      await state.click();
      const session = state.latest();
      const data = {
        version: kind === "version" ? "foreign.version" : VERSION,
        instance: kind === "instance" ? "wrong_instance_123456" : session.instance,
        type: kind === "unknown" ? "SEND_MESSAGE" : "EXPIRED",
        ...(kind === "extra" ? { token: "synthetic-invalid-extra" } : {}),
      };
      state.dispatchMessage({
        source: kind === "source" ? {} : session.element.contentWindow,
        origin: kind === "origin" ? "https://foreign.example" : API,
        data: kind === "malformed" ? null : data,
      });
      expect(state.liveFrames()).toEqual([session.element]);
      expect(state.launcher.hidden).toBe(true);
      expect(state.launcher.disabled).toBe(false);
      expect(state.counts()).toEqual({ grant: 1, redeem: 1, submits: 1 });
    },
  );

  it("handles EXPIRED before READY and allows only a manual fresh-grant retry", async () => {
    const state = setup({ redeem: "failure" });
    await state.click();
    expect(state.posts.map((event) => event.type)).toEqual(["EXPIRED"]);
    expect(state.liveFrames()).toHaveLength(0);
    expect(state.launcher.hidden).toBe(false);
    expect(state.launcher.disabled).toBe(false);
    expect(state.launcher.textContent).toBe("Start a new chat");
    expect(state.counts()).toEqual({ grant: 1, redeem: 1, submits: 1 });
    await state.click();
    expect(state.counts()).toEqual({ grant: 2, redeem: 2, submits: 2 });
    expect(state.launcher.textContent).toBe("Chat with us");
  });

  it("cleans partial iframe/form state after failed submission and retries with a fresh grant", async () => {
    const state = setup({ submitFailures: 1 });
    await state.click();
    expect(state.liveFrames()).toHaveLength(0);
    expect(state.body.children.filter((element) => element.tagName === "form")).toHaveLength(0);
    expect(state.launcher.hidden).toBe(false);
    expect(state.launcher.disabled).toBe(false);
    expect(state.launcher.textContent).toBe("Try chat again");
    expect(state.counts()).toEqual({ grant: 1, redeem: 0, submits: 1 });
    await state.click();
    expect(state.liveFrames()).toHaveLength(1);
    expect(state.body.children.filter((element) => element.tagName === "form")).toHaveLength(0);
    expect(state.counts()).toEqual({ grant: 2, redeem: 1, submits: 2 });
    expect(state.launcher.textContent).toBe("Chat with us");
  });

  it.each(["http", "malformed", "network"] as const)(
    "recovers from %s grant failure without auto retry or retained form/frame",
    async (grantFailure) => {
      const state = setup({ grantFailure });
      await state.click();
      expect(state.liveFrames()).toHaveLength(0);
      expect(state.body.children.filter((element) => element.tagName === "form")).toHaveLength(0);
      expect(state.launcher.hidden).toBe(false);
      expect(state.launcher.disabled).toBe(false);
      expect(state.launcher.textContent).toBe("Try chat again");
      expect(state.counts()).toEqual({ grant: 1, redeem: 0, submits: 0 });
      await state.click();
      expect(state.counts()).toEqual({ grant: 2, redeem: 1, submits: 1 });
      expect(state.launcher.textContent).toBe("Chat with us");
    },
  );

  it("keeps a pre-READY closed frame closed when its genuine READY arrives", async () => {
    const state = setup({ redeem: "pending" });
    await state.click();
    expect(state.posts).toHaveLength(0);
    await state.close();
    expect(state.launcher.hidden).toBe(false);
    expect(state.launcher.disabled).toBe(false);
    expect(state.latest().element.style["display"]).toBe("none");
    await state.completeRedeem();
    expect(state.launcher.hidden).toBe(false);
    expect(state.launcher.disabled).toBe(false);
    expect(state.launcher.textContent).toBe("Chat with us");
    expect(state.latest().element.style["display"]).toBe("none");
    await state.click();
    expect(state.latest().element.style["display"]).toBe("block");
    expect(state.counts()).toEqual({ grant: 1, redeem: 1, submits: 1 });
  });

  it("ignores expired old-frame messages after a manual replacement without leaking session data", async () => {
    const state = setup();
    await state.click();
    const old = state.latest();
    const expiration = old.timers.values().next().value;
    if (expiration === undefined)
      throw new TypeError("Expected generated frame expiration callback");
    expiration();
    expect(state.liveFrames()).toHaveLength(0);
    await state.click();
    const current = state.latest();
    expect(current.element).not.toBe(old.element);
    state.dispatchMessage({
      origin: API,
      source: old.element.contentWindow,
      data: { version: VERSION, instance: old.instance, type: "EXPIRED" },
    });
    expect(state.liveFrames()).toEqual([current.element]);
    expect(state.counts()).toEqual({ grant: 2, redeem: 2, submits: 2 });
    expect(state.posts.every((event) => event.target === HOST)).toBe(true);
    expect(state.posts.every((event) => event.keys.join() === "instance,type,version")).toBe(true);
    expect(
      state.requests.every((request) =>
        ["/v1/widget/embed-grants", "/v1/widget/embed-sessions/redeem"].includes(request.path),
      ),
    ).toBe(true);
  });
});
