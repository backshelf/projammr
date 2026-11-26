/**
 * `@workspace/dsp` and `@workspace/settings` declare `"type": "module"` in
 * their package.json, so TypeScript's NodeNext resolution — which
 * `apps/server`'s tsconfig uses, and which governs every file NodeNext
 * resolves regardless of which program reached it — requires a literal
 * extension on every relative import inside them (`./analysis.js`, not
 * `./analysis`), even though the file on disk is `analysis.ts`. Their own
 * tsconfigs resolve that the TypeScript "bundler" way, mapping the `.js`
 * specifier back to the `.ts` file, and Bun's bundler and runtime do the same
 * — but Turbopack does not: it looks for a literal `analysis.js` and fails.
 * Webpack's equivalent knob (`experimental.extensionAlias`) is explicitly
 * unsupported under Turbopack.
 *
 * This loader is the seam: applied only to those packages' own source
 * (`next.config.ts`'s `turbopack.rules`), it strips the trailing `.js` from a
 * relative import specifier before Turbopack resolves it, so the same source
 * satisfies the server's NodeNext typecheck and the client's Turbopack build
 * without either side changing.
 */
module.exports = function stripRelativeJsExtension(source) {
  return source.replace(
    /(\bfrom\s+["'])(\.\.?\/[^"'\n]+)\.js(["'])/g,
    "$1$2$3"
  );
};
