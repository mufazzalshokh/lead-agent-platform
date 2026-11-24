const fail = (code) => {
  throw new Error(code);
};

const apiOrigin = process.env["S22_API_ORIGIN"];
const apiRevision = process.env["S22_API_REVISION"];
const apiImage = process.env["S22_API_IMAGE"];
const botToken = process.env["TELEGRAM_BOT_TOKEN"];
const botUsername = process.env["TELEGRAM_BOT_USERNAME"];
const webhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
const webhookUrl = process.env["TELEGRAM_WEBHOOK_URL"];
const allowedUpdates = Object.freeze([
  "message",
  "business_connection",
  "business_message",
  "callback_query",
]);

if (
  apiOrigin !== "https://lead-agent-staging-api-uj7pjzpksq-ww.a.run.app" ||
  !/^lead-agent-staging-api-[a-z0-9-]+$/u.test(apiRevision ?? "") ||
  !/^me-central1-docker\.pkg\.dev\/lead-agent-stg-739284\/lead-agent\/api@sha256:[0-9a-f]{64}$/u.test(
    apiImage ?? "",
  ) ||
  !/^[1-9][0-9]{4,19}:[A-Za-z0-9_-]{20,128}$/u.test(botToken ?? "") ||
  !/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(botUsername ?? "") ||
  !/^[A-Za-z0-9_-]{43,256}$/u.test(webhookSecret ?? "") ||
  webhookUrl !== `${apiOrigin}/v1/webhooks/telegram`
)
  fail("S22T001_INVALID_VERIFICATION_INPUT");

const providerCall = async (method, body) => {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("S22T002_PROVIDER_REQUEST_FAILED");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 65_536) fail("S22T003_PROVIDER_RESPONSE_TOO_LARGE");
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail("S22T004_PROVIDER_RESPONSE_INVALID");
  }
  if (!response.ok || payload?.ok !== true) fail(`S22T005_PROVIDER_${method.toUpperCase()}_FAILED`);
  return payload.result;
};

const me = await providerCall("getMe", {});
if (
  typeof me !== "object" ||
  me === null ||
  me.is_bot !== true ||
  me.can_connect_to_business !== true ||
  me.username !== botUsername
)
  fail("S22T006_BOT_IDENTITY_MISMATCH");

await providerCall("setWebhook", {
  allowed_updates: allowedUpdates,
  secret_token: webhookSecret,
  url: webhookUrl,
});

const webhookInfo = await providerCall("getWebhookInfo", {});
if (
  typeof webhookInfo !== "object" ||
  webhookInfo === null ||
  webhookInfo.url !== webhookUrl ||
  !Array.isArray(webhookInfo.allowed_updates) ||
  webhookInfo.allowed_updates.length !== allowedUpdates.length ||
  !allowedUpdates.every((update) => webhookInfo.allowed_updates.includes(update))
)
  fail("S22T007_WEBHOOK_CONFIGURATION_MISMATCH");

const mutateSecret = (value) => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
const applicationCall = async (secret) => {
  try {
    return await fetch(webhookUrl, {
      body: JSON.stringify({ update_id: 2_147_483_646 }),
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("S22T008_APPLICATION_REQUEST_FAILED");
  }
};

const rejected = await applicationCall(mutateSecret(webhookSecret));
if (rejected.status !== 401) fail("S22T009_WRONG_SECRET_NOT_REJECTED");

const accepted = await applicationCall(webhookSecret);
if (accepted.status !== 200) fail("S22T010_CORRECT_SECRET_REJECTED");
const acceptedBody = await accepted.json().catch(() => null);
if (acceptedBody?.status !== "ignored") fail("S22T011_SAFE_PROBE_NOT_IGNORED");

console.log(
  JSON.stringify({
    allowed_updates: allowedUpdates,
    api_image: apiImage,
    api_revision: apiRevision,
    bot_business_capable: "PASS",
    bot_username: botUsername,
    correct_secret_probe: "PASS",
    diagnostic: "s22_telegram_webhook_verification",
    safe_probe_result: "ignored",
    secret_value_exposed: false,
    webhook_configured: "PASS",
    webhook_url: webhookUrl,
    wrong_secret_rejected: "PASS",
  }),
);
