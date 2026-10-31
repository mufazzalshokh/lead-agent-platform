import { randomUUID } from "node:crypto";

const MAX_REQUEST_BYTES = 1_048_576;
const UPSTREAM_TIMEOUT_MILLISECONDS = 65_000;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const UNTRUSTED_FORWARDING_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
]);

export type WidgetReadObservation = Readonly<{
  operation: "widget_gateway_read";
  request_id: string;
  conversation_id: string;
  route: "conversation" | "messages";
  origin_present: boolean;
  origin_normalized: boolean;
  code: "forwarded" | "platform_configuration_invalid" | "upstream_request_failed";
  status: number;
}>;

type GatewayOptions = Readonly<{
  fetchImpl?: typeof fetch;
  maximumRequestBytes?: number;
  timeoutMilliseconds?: number;
  upstreamOrigin?: string;
  widgetPlatformOrigin?: string;
  report?: (observation: WidgetReadObservation) => void;
}>;

const widgetReadPath =
  /^\/v1\/widget\/conversations\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/messages)?$/u;

const requireWidgetPlatformOrigin = (value: string | undefined): string => {
  if (value === undefined) throw new TypeError("WIDGET_PLATFORM_ORIGIN is required");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password)
    throw new TypeError("WIDGET_PLATFORM_ORIGIN must be an exact HTTPS origin");
  return value;
};

// Same-origin fetch GET does not carry Origin. Normalize only this isolated
// frame read shape, from trusted configuration, never Host/Forwarded/Referer.
// The API still verifies the signed origin, tenant, session/JTI and conversation.
const canNormalizeWidgetReadOrigin = (headers: Headers): boolean =>
  !headers.has("origin") &&
  headers.get("sec-fetch-site") === "same-origin" &&
  ["cors", "same-origin"].includes(headers.get("sec-fetch-mode") ?? "") &&
  headers.get("sec-fetch-dest") === "empty" &&
  /^Bearer [A-Za-z0-9._-]{80,4096}$/u.test(headers.get("authorization") ?? "");

const problem = (status: number, code: string): Response =>
  Response.json(
    { code, message: "The request could not be forwarded safely." },
    { headers: { "cache-control": "no-store" }, status },
  );

export const requireApiUpstreamOrigin = (value: string | undefined): string => {
  if (value === undefined || value.length === 0)
    throw new TypeError("API_INTERNAL_ORIGIN is required");
  const parsed = new URL(value);
  const localTestOrigin =
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  if (
    (!localTestOrigin && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new TypeError(
      "API_INTERNAL_ORIGIN must be an HTTPS origin without credentials or a path",
    );
  }
  return parsed.origin;
};

const copyRequestHeaders = (source: Headers): Headers => {
  const target = new Headers();
  for (const [name, value] of source.entries()) {
    const normalized = name.toLowerCase();
    if (
      normalized === "host" ||
      normalized === "content-length" ||
      HOP_BY_HOP_HEADERS.has(normalized) ||
      UNTRUSTED_FORWARDING_HEADERS.has(normalized)
    ) {
      continue;
    }
    target.append(name, value);
  }
  return target;
};

const setCookies = (headers: Headers): readonly string[] => {
  const candidate: unknown = Reflect.get(headers, "getSetCookie");
  if (typeof candidate === "function") {
    const values: unknown = Reflect.apply(candidate, headers, []);
    if (Array.isArray(values) && values.every((value) => typeof value === "string")) return values;
  }
  const fallback = headers.get("set-cookie");
  return fallback === null ? [] : [fallback];
};

const copyResponseHeaders = (source: Headers): Headers => {
  const target = new Headers();
  for (const [name, value] of source.entries()) {
    const normalized = name.toLowerCase();
    if (normalized === "set-cookie" || HOP_BY_HOP_HEADERS.has(normalized)) continue;
    target.append(name, value);
  }
  for (const value of setCookies(source)) target.append("set-cookie", value);
  return target;
};

const requireGatewayPath = (requestUrl: URL): string => {
  const path = requestUrl.pathname;
  if (!(path.startsWith("/v1/") || path.startsWith("/v2/"))) {
    throw new TypeError("Only versioned API paths may use the gateway");
  }
  return path;
};

const readRequestBody = async (
  request: Request,
  maximumRequestBytes: number,
): Promise<ArrayBuffer | undefined> => {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumRequestBytes) {
      throw new RangeError("request_body_too_large");
    }
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumRequestBytes) throw new RangeError("request_body_too_large");
  return body;
};

export const proxyApiRequest = async (
  request: Request,
  options: GatewayOptions = {},
): Promise<Response> => {
  let upstreamOrigin: string;
  let path: string;
  try {
    upstreamOrigin = requireApiUpstreamOrigin(
      options.upstreamOrigin ?? process.env["API_INTERNAL_ORIGIN"],
    );
    path = requireGatewayPath(new URL(request.url));
  } catch {
    return problem(500, "gateway_configuration_invalid");
  }

  const maximumRequestBytes = options.maximumRequestBytes ?? MAX_REQUEST_BYTES;
  let body: ArrayBuffer | undefined;
  try {
    body = await readRequestBody(request, maximumRequestBytes);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "request_body_too_large")
      : problem(400, "request_body_invalid");
  }

  const source = new URL(request.url);
  const upstream = new URL(path + source.search, upstreamOrigin);
  const readMatch = request.method === "GET" ? widgetReadPath.exec(path) : null;
  const readConversationId = readMatch?.[1];
  const requestHeaders = copyRequestHeaders(request.headers);
  const readRequestId = readMatch === null ? null : randomUUID();
  let originNormalized = false;
  const observeRead = (code: WidgetReadObservation["code"], status: number): void => {
    if (readMatch === null || readRequestId === null || readConversationId === undefined) return;
    const observation: WidgetReadObservation = {
      operation: "widget_gateway_read",
      request_id: readRequestId,
      conversation_id: readConversationId,
      route: readMatch[2] === undefined ? "conversation" : "messages",
      origin_present: request.headers.has("origin"),
      origin_normalized: originNormalized,
      code,
      status,
    };
    if (options.report === undefined) console.info(JSON.stringify(observation));
    else {
      try {
        options.report(observation);
      } catch {
        // An injected observer must not turn an authoritative response into a retry.
        console.error(
          JSON.stringify({
            ...observation,
            operation: "widget_gateway_report_failure",
            code: "reporter_failed",
          }),
        );
      }
    }
  };
  if (readMatch !== null && canNormalizeWidgetReadOrigin(request.headers)) {
    try {
      requestHeaders.set(
        "origin",
        requireWidgetPlatformOrigin(
          options.widgetPlatformOrigin ?? process.env["WIDGET_PLATFORM_ORIGIN"],
        ),
      );
      originNormalized = true;
    } catch {
      observeRead("platform_configuration_invalid", 500);
      return problem(500, "gateway_configuration_invalid");
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMilliseconds ?? UPSTREAM_TIMEOUT_MILLISECONDS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(upstream, {
      ...(body === undefined ? {} : { body }),
      headers: requestHeaders,
      method: request.method,
      redirect: "manual",
      signal: controller.signal,
    });
    observeRead("forwarded", response.status);
    return new Response(response.body, {
      headers: copyResponseHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    observeRead(
      "upstream_request_failed",
      error instanceof DOMException && error.name === "AbortError" ? 504 : 502,
    );
    return problem(
      error instanceof DOMException && error.name === "AbortError" ? 504 : 502,
      error instanceof DOMException && error.name === "AbortError"
        ? "upstream_timeout"
        : "upstream_unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
};
