import { readFileSync } from "node:fs";

const secret = "lead-agent-staging-channel-credentials";
const resource =
  /^projects\/(?:[1-9][0-9]*|lead-agent-stg-739284)\/secrets\/lead-agent-staging-channel-credentials\/versions\/([1-9][0-9]*)$/u;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

try {
  const head = process.argv[2];
  const upgrade = head === "0033_first_owner_signup";
  const versions = JSON.parse(readFileSync(0, "utf8"));
  if (
    (!upgrade && head !== "0031_s22_widget_inbound_route_management") ||
    !Array.isArray(versions)
  ) {
    throw new Error();
  }
  const seen = new Set();
  const lines = versions.map((version) => {
    const id = typeof version?.name === "string" ? resource.exec(version.name)?.[1] : undefined;
    const created = version?.createTime;
    if (
      !id ||
      seen.has(id) ||
      version.state !== "ENABLED" ||
      typeof created !== "string" ||
      !timestamp.test(created) ||
      !Number.isFinite(Date.parse(created))
    ) {
      throw new Error();
    }
    seen.add(id);
    return `channel_credential_version=${id} created_at=${created} state=ENABLED`;
  });
  console.log(`${secret}: enabled_versions=${seen.size} (application-managed)`);
  if (upgrade) {
    for (const line of lines) console.log(line);
    console.log("application_managed_channel_secret_mode=existing_staging");
  } else if (seen.size === 0) {
    console.log("application_managed_channel_secret_empty=true");
  } else {
    console.error("Initial staging setup requires an empty channel credential container.");
    process.exitCode = 1;
  }
} catch {
  console.error("Channel credential version metadata is invalid.");
  process.exitCode = 1;
}
