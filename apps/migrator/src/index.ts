import process from "node:process";

import { migrateStagingDatabase } from "./migrate.js";

const safeDeploymentValue = (environment: NodeJS.ProcessEnv, key: string): string =>
  environment[key]?.trim() || "unavailable";

const main = async (): Promise<void> => {
  const result = await migrateStagingDatabase(process.env);
  console.info(
    JSON.stringify({
      deployment_timestamp: safeDeploymentValue(process.env, "DEPLOYMENT_TIMESTAMP"),
      environment: "staging",
      git_commit_sha: safeDeploymentValue(process.env, "DEPLOYMENT_GIT_SHA"),
      image_digest: safeDeploymentValue(process.env, "DEPLOYMENT_IMAGE_DIGEST"),
      migration_count: result.migrationCount,
      migration_head: result.migrationHead,
      operation: "database_migration",
      outcome: "succeeded",
    }),
  );
};

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      environment: "staging",
      error_name: error instanceof Error ? error.name : "UnknownError",
      operation: "database_migration",
      outcome: "failed",
    }),
  );
  process.exitCode = 1;
});
