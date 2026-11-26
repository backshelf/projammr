import { config } from "@workspace/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    ignores: ["dist/**", "static/**", "deps/**", "src/db/migrations/**"],
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:child_process",
              message:
                "Only src/lib/media.ts (ffmpeg) and src/db/migrator.ts (pg_dump) spawn processes.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/lib/media.ts",
      "src/db/migrator.ts",
      "src/test/**/*.ts",
      "**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
