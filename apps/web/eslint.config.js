import { designTokens } from "@workspace/eslint-config/design-tokens";
import { config } from "@workspace/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  /* The site's own source carries the design language. `.astro` files have no
     parser here; their script is type-checked and their classes follow the
     same tokens by review. */
  {
    files: ["src/**/*.{ts,tsx}"],
    ...designTokens,
  },
  { ignores: ["dist/**", ".astro/**", "openapi/**"] },
];
