import { buildWidgetLoader, requireHttpsOrigin } from "../../../lib/widget-embed";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    const apiOrigin = requireHttpsOrigin(
      process.env["WIDGET_PUBLIC_API_ORIGIN"],
      "WIDGET_PUBLIC_API_ORIGIN",
    );
    return new Response(buildWidgetLoader(apiOrigin), {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "text/javascript; charset=utf-8",
        "cross-origin-resource-policy": "cross-origin",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("/* Widget configuration unavailable. */", {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
      status: 503,
    });
  }
}
