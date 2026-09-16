import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../apps/api/src/app.js";
import {
  InstagramApplicationError,
  type InstagramBusinessUseCases,
} from "../../packages/application/src/index.js";
import { ACCOUNT_ID, CUSTOMER_ID, IDS, NONCE, NOW, TOKEN, instagramConfig } from "./fixtures.js";
import { staffFixture } from "./staff-fixtures.js";

const body = Buffer.from(
  JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: ACCOUNT_ID,
        messaging: [
          {
            sender: { id: CUSTOMER_ID },
            recipient: { id: ACCOUNT_ID },
            timestamp: NOW.getTime(),
            message: { mid: "mid.synthetic", text: "Salom" },
          },
        ],
      },
    ],
  }),
);
const signature = `sha256=${createHmac("sha256", instagramConfig.appSecret).update(body).digest("hex")}`;
const fixture = () => {
  const processMessage = vi.fn<InstagramBusinessUseCases["processMessage"]>(() =>
    Promise.resolve({ status: "accepted" }),
  );
  const completeOnboarding = vi.fn(() => Promise.resolve());
  const api = createApi({
    instagramWebhook: {
      appSecret: instagramConfig.appSecret,
      webhookVerifyToken: instagramConfig.webhookVerifyToken,
      useCases: { processMessage, completeOnboarding },
      clock: () => NOW,
    },
  });
  return { api, processMessage, completeOnboarding };
};
describe("Instagram raw HTTP webhook/callback security", { timeout: 30000 }, () => {
  it.each([undefined, "sha256=bad", "sha256=" + "0".repeat(64)])(
    "rejects signature %s before normalization or tenant work",
    async (value) => {
      const test = fixture();
      try {
        const result = await test.api.inject({
          method: "POST",
          url: "/v1/webhooks/instagram",
          payload: body,
          headers: {
            "content-type": "application/json",
            ...(value === undefined ? {} : { "x-hub-signature-256": value }),
          },
        });
        expect(result.statusCode).toBe(401);
        expect(test.processMessage).not.toHaveBeenCalled();
      } finally {
        await test.api.close();
      }
    },
  );
  it("processes authenticated DM bytes, ignores forged tenant inputs, and sets privacy headers", async () => {
    const test = fixture();
    try {
      const result = await test.api.inject({
        method: "POST",
        url: "/v1/webhooks/instagram?organization_id=forged",
        payload: body,
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
          "x-organization-context": IDS.otherOrganization,
        },
      });
      expect(result.statusCode).toBe(200);
      expect(test.processMessage).toHaveBeenCalledOnce();
      expect(test.processMessage.mock.calls[0]?.[0]).not.toHaveProperty("organizationId");
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.headers["referrer-policy"]).toBe("no-referrer");
    } finally {
      await test.api.close();
    }
  });
  it("acknowledges signed malformed/unsupported events without business mutations", async () => {
    const test = fixture();
    try {
      const raw = Buffer.from("{");
      const signed = `sha256=${createHmac("sha256", instagramConfig.appSecret).update(raw).digest("hex")}`;
      const result = await test.api.inject({
        method: "POST",
        url: "/v1/webhooks/instagram",
        payload: raw,
        headers: { "content-type": "application/json", "x-hub-signature-256": signed },
      });
      expect(result.statusCode).toBe(200);
      expect(test.processMessage).not.toHaveBeenCalled();
    } finally {
      await test.api.close();
    }
  });
  it("returns retryable sanitized 503 if durable persistence fails", async () => {
    const test = fixture();
    test.processMessage.mockRejectedValue(new Error(`private SQL ${TOKEN}`));
    try {
      const result = await test.api.inject({
        method: "POST",
        url: "/v1/webhooks/instagram",
        payload: body,
        headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      });
      expect(result.statusCode).toBe(503);
      expect(result.body).not.toMatch(/private|SQL|synthetic_instagram/u);
    } finally {
      await test.api.close();
    }
  });
  it("does not expose unavailable routes and rejects excessive raw payloads", async () => {
    const test = fixture();
    test.processMessage.mockRejectedValue(new InstagramApplicationError("channel_unavailable"));
    try {
      expect(
        (
          await test.api.inject({
            method: "POST",
            url: "/v1/webhooks/instagram",
            payload: body,
            headers: { "content-type": "application/json", "x-hub-signature-256": signature },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await test.api.inject({
            method: "POST",
            url: "/v1/webhooks/instagram",
            payload: Buffer.alloc(512 * 1024 + 1),
            headers: { "content-type": "application/json", "x-hub-signature-256": signature },
          })
        ).statusCode,
      ).toBe(413);
    } finally {
      await test.api.close();
    }
  });
  it("verifies subscription challenge and returns connected only after callback completion", async () => {
    const test = fixture();
    try {
      const result = await test.api.inject(
        `/v1/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${instagramConfig.webhookVerifyToken}&hub.challenge=12345`,
      );
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe("12345");
      expect(result.headers["content-type"]).toContain("text/plain");
      expect(
        (
          await test.api.inject(
            `/v1/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`,
          )
        ).statusCode,
      ).toBe(403);
      const callback = await test.api.inject(
        `/v1/integrations/instagram/callback?code=synthetic-code&state=${NONCE}`,
      );
      expect(callback.statusCode).toBe(200);
      expect(callback.json()).toEqual({ status: "connected" });
      expect(callback.body).not.toContain(NONCE);
      expect(
        (await test.api.inject(`/v1/integrations/instagram/callback?code=code&state=bad`))
          .statusCode,
      ).toBe(400);
    } finally {
      await test.api.close();
    }
  });
});
describe("Instagram staff integration management", () => {
  const fixture = (role: "owner" | "staff" = "owner") => {
    const auth = staffFixture(role);
    const beginOnboarding = vi.fn(() =>
      Promise.resolve({
        authorizationUrl: `https://www.instagram.com/oauth/authorize?state=${NONCE}`,
      }),
    );
    const disconnect = vi.fn(() => Promise.resolve());
    const api = createApi({
      staffAuth: auth.staffAuth,
      staffInstagram: { useCases: { beginOnboarding, disconnect } },
    });
    return { api, beginOnboarding, disconnect, ...auth };
  };
  it("returns only the authorized OAuth URL and supports staff disconnect", async () => {
    const test = fixture();
    try {
      const result = await test.api.inject({
        method: "POST",
        url: "/v1/staff/integrations/instagram/onboarding",
        headers: test.headers,
        payload: { display_name: "Clinic IG" },
      });
      expect(result.statusCode).toBe(201);
      expect(Object.keys(result.json())).toEqual(["authorization_url"]);
      expect(test.beginOnboarding.mock.calls[0]).toBeDefined();
      expect(
        (
          await test.api.inject({
            method: "POST",
            url: `/v1/staff/integrations/instagram/${IDS.channel}/disconnect`,
            headers: test.headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(204);
      expect(test.disconnect).toHaveBeenCalledOnce();
    } finally {
      await test.api.close();
    }
  });
  it.each(["cookie", "x-csrf-token", "origin"])(
    "rejects missing %s before onboarding",
    async (key) => {
      const test = fixture();
      const headers = { ...test.headers };
      delete headers[key];
      try {
        const result = await test.api.inject({
          method: "POST",
          url: "/v1/staff/integrations/instagram/onboarding",
          headers,
          payload: { display_name: "Clinic" },
        });
        expect([401, 403]).toContain(result.statusCode);
        expect(test.beginOnboarding).not.toHaveBeenCalled();
      } finally {
        await test.api.close();
      }
    },
  );
  it("rejects wrong origin, other tenant, injected routing fields, and insufficient permission", async () => {
    const test = fixture();
    try {
      for (const patch of [
        { origin: "https://evil.example" },
        { "sec-fetch-site": "cross-site" },
        { "x-organization-context": IDS.otherOrganization },
      ])
        expect(
          (
            await test.api.inject({
              method: "POST",
              url: "/v1/staff/integrations/instagram/onboarding",
              headers: { ...test.headers, ...patch },
              payload: { display_name: "Clinic" },
            })
          ).statusCode,
        ).toBe(403);
      expect(
        (
          await test.api.inject({
            method: "POST",
            url: "/v1/staff/integrations/instagram/onboarding",
            headers: test.headers,
            payload: { display_name: "Clinic", organization_id: IDS.otherOrganization },
          })
        ).statusCode,
      ).toBe(400);
      expect(test.beginOnboarding).not.toHaveBeenCalled();
    } finally {
      await test.api.close();
    }
    const staff = fixture("staff");
    try {
      expect(
        (
          await staff.api.inject({
            method: "POST",
            url: "/v1/staff/integrations/instagram/onboarding",
            headers: staff.headers,
            payload: { display_name: "Clinic" },
          })
        ).statusCode,
      ).toBe(403);
      expect(staff.beginOnboarding).not.toHaveBeenCalled();
    } finally {
      await staff.api.close();
    }
  });
});
