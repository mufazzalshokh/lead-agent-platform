const fail = (code) => {
  throw new Error(code);
};

const apiOrigin = process.env["S22_API_ORIGIN"];
const apiRevision = process.env["S22_API_REVISION"];
const apiImage = process.env["S22_API_IMAGE"];
const verifyToken = process.env["INSTAGRAM_WEBHOOK_VERIFY_TOKEN"];

if (
  apiOrigin !== "https://lead-agent-staging-api-uj7pjzpksq-ww.a.run.app" ||
  !/^lead-agent-staging-api-[a-z0-9-]+$/u.test(apiRevision ?? "") ||
  !/^me-central1-docker\.pkg\.dev\/lead-agent-stg-739284\/lead-agent\/api@sha256:[0-9a-f]{64}$/u.test(
    apiImage ?? "",
  ) ||
  typeof verifyToken !== "string" ||
  verifyToken.length < 1 ||
  verifyToken.length > 256
)
  fail("S22I001_INVALID_VERIFICATION_INPUT");

const request = async (token) => {
  const url = new URL("/v1/webhooks/instagram", apiOrigin);
  const challenge = `${Date.now()}${process.pid}`;
  url.searchParams.set("hub.mode", "subscribe");
  url.searchParams.set("hub.verify_token", token);
  url.searchParams.set("hub.challenge", challenge);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    return { challenge, response };
  } catch {
    fail("S22I002_HTTP_REQUEST_FAILED");
  }
};

const accepted = await request(verifyToken);
if (accepted.response.status !== 200) fail("S22I003_CORRECT_TOKEN_REJECTED");
const acceptedBody = await accepted.response.text();
if (acceptedBody !== accepted.challenge) fail("S22I004_CHALLENGE_MISMATCH");
if (!accepted.response.headers.get("content-type")?.startsWith("text/plain"))
  fail("S22I005_CONTENT_TYPE_MISMATCH");
if (accepted.response.headers.get("cache-control") !== "no-store")
  fail("S22I006_CACHE_POLICY_MISMATCH");

const rejected = await request(`${verifyToken}x`);
if (rejected.response.status !== 403) fail("S22I007_WRONG_TOKEN_NOT_REJECTED");

console.log(
  JSON.stringify({
    api_image: apiImage,
    api_revision: apiRevision,
    callback_url: `${apiOrigin}/v1/webhooks/instagram`,
    correct_token_challenge: "PASS",
    diagnostic: "s22_instagram_webhook_verification",
    secret_value_exposed: false,
    wrong_token_rejected: "PASS",
  }),
);
