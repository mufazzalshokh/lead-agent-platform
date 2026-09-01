import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lead-agent/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "tests/**/*.test.ts"],
    passWithNoTests: false,
    reporters: ["default"],
    sequence: {
      concurrent: false,
    },
  },
});
