import pluginReactHooks from "eslint-plugin-react-hooks";

/**
 * The react-hooks rules shared by every React surface in the monorepo — the
 * Next.js client, the shared UI library, and the dit app renderer.
 *
 * @type {import("eslint").Linter.Config}
 */
export const reactHooksConfig = {
  plugins: {
    "react-hooks": pluginReactHooks,
  },
  rules: {
    ...pluginReactHooks.configs.recommended.rules,
    /* TanStack Table and TanStack Virtual return functions the React Compiler
       refuses to memoize, so it skips the whole component. The skip is the
       library's design, not a defect at the call site. */
    "react-hooks/incompatible-library": "off",
  },
};
