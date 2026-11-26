import { designTokens } from "@workspace/eslint-config/design-tokens";
import { nextJsConfig } from "@workspace/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  /* The app's own source carries the design language; generated and config
     files at the package root do not. */
  {
    files: ["src/**/*.{ts,tsx}"],
    ...designTokens,
  },
  /* `AppLink` shows the pending hint on every in-app link, so nothing outside
     it reaches for `next/link`'s default export. Named exports
     (`useLinkStatus`) stay available. */
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message: "Use AppLink from @/components/navigation/AppLink.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/navigation/AppLink.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  /* A CommonJS Turbopack loader (next.config.ts's `turbopack.rules`), never
     bundled into the app, so it keeps Node's module system. */
  {
    files: ["turbopack/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly" },
    },
  },
  {
    /* Built by `bun run build:worklet` from src/lib/dsp/processor.worklet.ts;
       gitignored, and its minified output is not meant to satisfy a linter
       written for hand-authored source. */
    ignores: ["public/dsp-processor.js"],
  },
];
