import js from "@eslint/js";
import pluginNext from "@next/eslint-plugin-next";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

import { config as baseConfig } from "./base.js";
import { reactConfig } from "./react.js";
import { reactHooksConfig } from "./react-hooks.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config}
 * */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  reactConfig,
  {
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    /* Satori metadata routes (ImageResponse) require raw <img> elements.
       @next/eslint-plugin-next tries to exempt them via
       filename.replace(path.sep, "/"), which only replaces the first
       backslash on Windows and causes cross-OS lint drift. */
    files: ["**/app/**/{opengraph-image,twitter-image,icon}.{js,jsx,ts,tsx}"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  reactHooksConfig,
];
