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

type GatewayOptions = Readonly<{
  fetchImpl?: typeof fetch;
  maximumRequestBytes?: number;
  timeoutMilliseconds?: number;
  upstreamOrigin?: string;
}>;

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
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMilliseconds ?? UPSTREAM_TIMEOUT_MILLISECONDS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(upstream, {
      ...(body === undefined ? {} : { body }),
      headers: copyRequestHeaders(request.headers),
      method: request.method,
      redirect: "manual",
      signal: controller.signal,
    });
    return new Response(response.body, {
      headers: copyResponseHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
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
