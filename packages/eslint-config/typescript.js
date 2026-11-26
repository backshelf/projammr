/**
 * typescript-eslint, re-exported for configs that build their own TypeScript
 * rule set (the dit app). typescript-eslint parses with the `typescript` its
 * importer resolves; TypeScript 7 has no JavaScript API, so it has to be
 * imported from here, where `typescript` is pinned to 6.0.
 */
export { default } from "typescript-eslint";
