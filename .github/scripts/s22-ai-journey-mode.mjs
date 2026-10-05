import { readFileSync } from "node:fs";

// Resolve only a non-secret setting. Never dump state or environment entries.
const [phase, requested] = process.argv.slice(2);
try {
  if (!["preserve", "paused", "booking"].includes(requested)) throw new Error();
  if (requested !== "preserve" && phase !== "full") throw new Error();
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
    if (settings.length > 1 || settings.some((e) => !["paused", "booking"].includes(e.value)))
      throw new Error();
    previous = settings[0]?.value ?? "paused";
  }
  process.stdout.write(`${requested === "preserve" ? previous : requested}\n`);
} catch {
  console.error("S22_AI_JOURNEY_MODE_STATE_INVALID");
  process.exitCode = 1;
}
