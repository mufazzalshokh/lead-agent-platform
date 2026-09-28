import process from "node:process";

import { runStagingMigrator } from "./runtime.js";

process.exitCode = await runStagingMigrator({
  environment: process.env,
  loadMigration: async () => (await import("./migrate.js")).migrateStagingDatabase,
  writeError: (message) => console.error(message),
  writeInfo: (message) => console.info(message),
});
