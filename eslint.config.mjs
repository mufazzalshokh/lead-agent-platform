import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

const typeScriptFiles = ["**/*.{ts,tsx}"];
const webFiles = ["apps/web/**/*.{ts,tsx}"];

const scopeConfigs = (configs, files) =>
  configs.map((config) => ({
    ...config,
    files,
  }));

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "apps/web/.next/**",
    "coverage/**",
    "tests/fixtures/**",
    "docs/architecture/**",
    "AGENTS.md",
  ]),
  {
    ...eslint.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...scopeConfigs(nextVitals, webFiles),
  ...scopeConfigs(nextTypeScript, webFiles),
  {
    files: webFiles,
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  ...scopeConfigs(tseslint.configs.recommendedTypeChecked, typeScriptFiles),
  {
    files: typeScriptFiles,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
          prefer: "type-imports",
        },
      ],
    },
  },
]);
