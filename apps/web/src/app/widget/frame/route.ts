import { randomBytes } from "node:crypto";

import {
  buildWidgetFrameDocument,
  requireHttpsOrigin,
  requireWidgetGrant,
  requireWidgetInstance,
} from "../../../lib/widget-embed";

export const dynamic = "force-dynamic";

const unavailable = (): Response =>
  new Response("Chat is temporarily unavailable.", {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
    status: 400,
  });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const form = await request.formData();
    const exchangeGrant = requireWidgetGrant(form.get("exchange_grant"));
    const instance = requireWidgetInstance(form.get("instance"));
    const apiOrigin = requireHttpsOrigin(
      process.env["WIDGET_PUBLIC_API_ORIGIN"],
      "WIDGET_PUBLIC_API_ORIGIN",
    );
    const policyResponse = await fetch(apiOrigin + "/v1/widget/embed-policy", {
      body: JSON.stringify({ exchange_grant: exchangeGrant }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const policy: unknown = await policyResponse.json();
    const data = isRecord(policy) ? policy["data"] : null;
    if (!policyResponse.ok || !isRecord(data)) return unavailable();
    const embeddingOrigin = requireHttpsOrigin(data["embedding_origin"], "embedding origin");
    const iframeOrigin = requireHttpsOrigin(data["iframe_origin"], "iframe origin");
    if (iframeOrigin !== url.origin) return unavailable();
    const nonce = randomBytes(24).toString("base64url");
    const document = buildWidgetFrameDocument({
      apiOrigin,
      embeddingOrigin,
      exchangeGrant,
      instance,
      nonce,
    });
    return new Response(document, {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${embeddingOrigin}; connect-src ${apiOrigin}; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
        "content-type": "text/html; charset=utf-8",
        "cross-origin-opener-policy": "same-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}
