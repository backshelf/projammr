import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";
import { reactRefresh } from "eslint-plugin-react-refresh";
import { designTokens } from "@workspace/eslint-config/design-tokens";
import { reactConfig } from "@workspace/eslint-config/react";
import { reactHooksConfig } from "@workspace/eslint-config/react-hooks";
import tseslint from "@workspace/eslint-config/typescript";

export default defineConfig(
  { ignores: ["**/node_modules", "**/dist", "src-tauri/**"] },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  tseslint.configs.recommended,
  /* The rule set the renderer lints with, kept here rather than shared
     because it must not start from a toolkit's defaults. */
  {
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": "allow-with-description" },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowIIFEs: true,
        },
      ],
      "@typescript-eslint/no-empty-function": [
        "error",
        { allow: ["arrowFunctions"] },
      ],
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "always" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTaggedTemplates: true,
          allowTernary: true,
        },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  reactConfig,
  {
    files: ["**/*.{ts,tsx}"],
    ...reactHooksConfig,
  },
  {
    files: ["**/*.{ts,tsx}"],
    ...reactRefresh.configs.vite(),
  },
  /* The panel carries the design language, so the drift guardrail applies to
     its source and not to the config files at the package root. */
  {
    files: ["src/**/*.{ts,tsx}"],
    ...designTokens,
  },
  eslintConfigPrettier
);
