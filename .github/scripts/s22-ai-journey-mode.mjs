import { readFileSync } from "node:fs";

// Resolve only the non-secret mode/session. Never dump state or environment entries.
const [phase, requested, requestedSession = "", output = "mode"] = process.argv.slice(2);
const modes = ["paused", "booking", "widget_booking"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
try {
  if (!["preserve", ...modes].includes(requested) || !["mode", "json"].includes(output))
    throw new Error();
  if (requested !== "preserve" && phase !== "full") throw new Error();
  if (requestedSession !== "" && !uuid.test(requestedSession)) throw new Error();
  if (requested === "widget_booking" && requestedSession === "") throw new Error();
  if (["paused", "booking"].includes(requested) && requestedSession !== "") throw new Error();
  const state = JSON.parse(readFileSync(0, "utf8"));
  if (!state || state.version !== 4 || !Array.isArray(state.resources)) throw new Error();
  const workers = state.resources.filter(
    (r) =>
      r.mode === "managed" && r.type === "google_cloud_run_v2_worker_pool" && r.name === "worker",
  );
  if (workers.length > 1) throw new Error();
  const instances = workers.flatMap((r) => r.instances ?? []);
  if (instances.length > 1) throw new Error();
  let previous = "paused"; // Legacy images have no setting; new code defaults paused.
  let previousSession = "";
  if (instances.length === 1) {
    const resource = instances[0].attributes;
    if (
      resource?.project !== "lead-agent-stg-739284" ||
      resource.location !== "me-central1" ||
      resource.name !== "lead-agent-staging-worker"
    )
      throw new Error();
    if (
      !Array.isArray(resource.template) ||
      resource.template.length !== 1 ||
      !Array.isArray(resource.template[0]?.containers) ||
      resource.template[0].containers.length !== 1
    )
      throw new Error();
    const env = resource.template[0].containers[0].env;
    if (!Array.isArray(env)) throw new Error();
    const settings = env.filter((e) => e.name === "AI_JOURNEY_MODE");
    if (settings.length > 1 || settings.some((e) => !modes.includes(e.value))) throw new Error();
    previous = settings[0]?.value ?? "paused";
    const sessions = env.filter((e) => e.name === "AI_JOURNEY_WIDGET_SESSION_ID");
    if (
      sessions.length > 1 ||
      sessions.some((e) => typeof e.value !== "string" || !uuid.test(e.value))
    )
      throw new Error();
    previousSession = sessions[0]?.value ?? "";
    if ((previous === "widget_booking") !== (previousSession !== "")) throw new Error();
  }
  if (requested === "preserve" && requestedSession !== "" && requestedSession !== previousSession)
    throw new Error();
  const mode = requested === "preserve" ? previous : requested;
  const widgetSessionId = requested === "preserve" ? previousSession : requestedSession;
  process.stdout.write(
    output === "json" ? `${JSON.stringify({ mode, widgetSessionId })}\n` : `${mode}\n`,
  );
} catch {
  console.error("S22_AI_JOURNEY_MODE_STATE_INVALID");
  process.exitCode = 1;
}
