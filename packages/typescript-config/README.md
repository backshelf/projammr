# `@workspace/typescript-config`

Shared tsconfig presets for the workspace, consumed by path:

```json
{ "extends": "@workspace/typescript-config/base.json" }
```

| Preset | What it sets | Used by |
| --- | --- | --- |
| `base.json` | strict, `noUncheckedIndexedAccess`, ES2022, `NodeNext` modules, `isolatedModules`, `declaration` + `declarationMap`, `skipLibCheck` | the server (with its own overrides), and every preset below |
| `nextjs.json` | base + the `next` plugin, `ESNext` modules with `Bundler` resolution, `allowJs`, `jsx: preserve`, `noEmit` | the web client |
| `react-library.json` | base + `jsx: react-jsx`, `ESNext` modules with `Bundler` resolution, which is what lets Turbopack and Vite consume the package as source | `@workspace/ui` |
| `library.json` | base + `ESNext` modules with `Bundler` resolution and `verbatimModuleSyntax` | `@workspace/api`, `@workspace/test` |

Every workspace is on TypeScript 7.
