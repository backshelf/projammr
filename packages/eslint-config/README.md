# `@workspace/eslint-config`

Shared ESLint flat configs for the workspace.

| Export | What it is | Used by |
| --- | --- | --- |
| `./base` | `js.configs.recommended`, `eslint-config-prettier`, typescript-eslint's recommended rules, turbo's `no-undeclared-env-vars`, and `eslint-plugin-only-warn`, which downgrades every rule to a warning | the server (with its own extra rule), and every config below |
| `./next-js` | base + `@next/eslint-plugin-next` (recommended and core-web-vitals) + `./react` + `./react-hooks` | the web client |
| `./react-internal` | the same as `./next-js` without the Next.js plugin | `@workspace/ui` |
| `./react` | `@eslint-react/eslint-plugin`'s `recommended-typescript` preset | client, ui, dit-app |
| `./react-hooks` | `eslint-plugin-react-hooks` recommended, with `incompatible-library` off for TanStack Table and Virtual | client, ui, dit-app |
| `./typescript` | re-exports `typescript-eslint` | dit-app, which builds its own rule set |
| `./design-tokens` | an opt-in `no-restricted-syntax` rule that flags class names outside the design language: Tailwind's raw type scale, arbitrary font sizes, named colour hues, `shadow-*`, and hex colour literals, in string and template literals alike | dit-app; spread under a `files` glob |

Because of `only-warn`, `bun run lint` never fails locally; read its output anyway. CI runs `bun run lint:ci`
(`--max-warnings 0`), so any warning fails the job there.

This package pins `typescript` to the 6.x line that typescript-eslint can parse with, while every other workspace
is on TypeScript 7. A config that needs typescript-eslint imports it from here, never from a package that would
resolve TypeScript 7.
