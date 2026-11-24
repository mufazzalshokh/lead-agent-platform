import { renderWidgetFrame } from "../../../lib/widget-frame";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return await renderWidgetFrame(request);
}
