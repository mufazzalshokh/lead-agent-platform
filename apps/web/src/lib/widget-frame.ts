import { randomBytes, randomUUID } from "node:crypto";

import {
  buildWidgetFrameDocument,
  requireHttpsOrigin,
  requireWidgetGrant,
  requireWidgetInstance,
} from "./widget-embed";

const POLICY_FAILURE_CODES = [
  "token_invalid",
  "validation_failed",
  "rate_limit_exceeded",
  "dependency_unavailable",
  "gateway_configuration_invalid",
  "upstream_timeout",
  "upstream_unavailable",
] as const;

type FrameCode =
  | "frame_ready"
  | "frame_input_invalid"
  | "frame_configuration_invalid"
  | "policy_request_failed"
  | "policy_timeout"
  | "policy_http_rejected"
  | "policy_response_invalid"
  | "policy_origin_invalid"
  | "policy_origin_mismatch"
  | "frame_render_failed";

export type WidgetFrameObservation = Readonly<{
  operation: "widget_frame_bootstrap";
  outcome: "ready" | "unavailable";
  code: FrameCode;
  request_id: string;
  policy_status: number | null;
  policy_code: (typeof POLICY_FAILURE_CODES)[number] | null;
  policy_request_id: string | null;
}>;

type WidgetFrameOptions = Readonly<{
  apiOrigin?: string;
  platformOrigin?: string;
  fetchImpl?: typeof fetch;
  timeoutMilliseconds?: number;
  report?: (observation: WidgetFrameObservation) => void;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const renderWidgetFrame = async (
  request: Request,
  options: WidgetFrameOptions = {},
): Promise<Response> => {
  const requestId = randomUUID();
  let policyStatus: number | null = null;
  let policyCode: WidgetFrameObservation["policy_code"] = null;
  let policyRequestId: string | null = null;
  const observe = (code: FrameCode, outcome: WidgetFrameObservation["outcome"]): void => {
    const observation: WidgetFrameObservation = {
      operation: "widget_frame_bootstrap",
      outcome,
      code,
      request_id: requestId,
      policy_status: policyStatus,
      policy_code: policyCode,
      policy_request_id: policyRequestId,
    };
    if (options.report !== undefined) options.report(observation);
    else console.info(JSON.stringify(observation));
  };
  const unavailable = (code: FrameCode): Response => {
    observe(code, "unavailable");
    return new Response("Chat is temporarily unavailable.", {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
      status: 400,
    });
  };

  let exchangeGrant: string;
  let instance: string;
  try {
    const form = await request.formData();
    exchangeGrant = requireWidgetGrant(form.get("exchange_grant"));
    instance = requireWidgetInstance(form.get("instance"));
  } catch {
    return unavailable("frame_input_invalid");
  }

  let apiOrigin: string;
  let platformOrigin: string;
  try {
    apiOrigin = requireHttpsOrigin(
      options.apiOrigin ?? process.env["WIDGET_PUBLIC_API_ORIGIN"],
      "WIDGET_PUBLIC_API_ORIGIN",
    );
    platformOrigin = requireHttpsOrigin(
      options.platformOrigin ?? process.env["WIDGET_PLATFORM_ORIGIN"],
      "WIDGET_PLATFORM_ORIGIN",
    );
  } catch {
    return unavailable("frame_configuration_invalid");
  }

  const timeout = options.timeoutMilliseconds ?? 15_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 15_000) {
    return unavailable("frame_configuration_invalid");
  }
  const signal = AbortSignal.timeout(timeout);
  let policyResponse: Response;
  try {
    policyResponse = await (options.fetchImpl ?? fetch)(apiOrigin + "/v1/widget/embed-policy", {
      body: JSON.stringify({ exchange_grant: exchangeGrant }),
      cache: "no-store",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      method: "POST",
      redirect: "error",
      signal,
    });
    policyStatus = policyResponse.status;
  } catch (error) {
    return unavailable(
      signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")
        ? "policy_timeout"
        : "policy_request_failed",
    );
  }

  let policy: unknown;
  try {
    policy = await policyResponse.json();
  } catch {
    return unavailable(
      signal.aborted
        ? "policy_timeout"
        : policyResponse.ok
          ? "policy_response_invalid"
          : "policy_http_rejected",
    );
  }
  if (isRecord(policy)) {
    policyCode = POLICY_FAILURE_CODES.find((code) => code === policy["code"]) ?? null;
    const meta = policy["meta"];
    const observedId = isRecord(meta) ? meta["request_id"] : policy["request_id"];
    if (typeof observedId === "string" && /^request:[A-Za-z0-9._:-]{1,128}$/u.test(observedId)) {
      policyRequestId = observedId;
    }
  }
  if (!policyResponse.ok) return unavailable("policy_http_rejected");
  const data = isRecord(policy) ? policy["data"] : null;
  if (!isRecord(data)) return unavailable("policy_response_invalid");

  let embeddingOrigin: string;
  let iframeOrigin: string;
  try {
    embeddingOrigin = requireHttpsOrigin(data["embedding_origin"], "embedding origin");
    iframeOrigin = requireHttpsOrigin(data["iframe_origin"], "iframe origin");
  } catch {
    return unavailable("policy_origin_invalid");
  }
  // Next standalone request.url may contain the internal bind address behind
  // Cloud Run TLS termination. Neither it nor forwarded/Host headers is authority.
  if (iframeOrigin !== platformOrigin) return unavailable("policy_origin_mismatch");

  try {
    const nonce = randomBytes(24).toString("base64url");
    const document = buildWidgetFrameDocument({
      apiOrigin,
      embeddingOrigin,
      exchangeGrant,
      instance,
      nonce,
    });
    observe("frame_ready", "ready");
    return new Response(document, {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${embeddingOrigin}; connect-src ${apiOrigin}; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
        "content-type": "text/html; charset=utf-8",
        "cross-origin-opener-policy": "same-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch {
    return unavailable("frame_render_failed");
  }
};
