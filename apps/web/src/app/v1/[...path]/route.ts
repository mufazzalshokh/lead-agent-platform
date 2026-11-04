import { proxyApiRequest } from "../../../lib/api-gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const forward = async (request: Request): Promise<Response> => await proxyApiRequest(request);

export { forward as DELETE };
export { forward as GET };
export { forward as HEAD };
export { forward as OPTIONS };
export { forward as PATCH };
export { forward as POST };
export { forward as PUT };
