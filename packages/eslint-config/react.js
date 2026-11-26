import eslintReact from "@eslint-react/eslint-plugin";

/**
 * The React rules shared by every React surface in the monorepo — the Next.js
 * client, the shared UI library, and the dit app renderer. The TypeScript
 * preset leaves prop checking to the compiler.
 *
 * @type {import("eslint").Linter.Config}
 */
export const reactConfig = eslintReact.configs["recommended-typescript"];
