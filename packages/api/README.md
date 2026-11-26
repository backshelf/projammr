# `@workspace/api`

The typed edge between the apps and the API: generated OpenAPI types, an `openapi-fetch` client built over them, a
Better Auth browser client, and the enums the server and the apps agree on. Consumed as TypeScript source (no
build step) by the web client, dit and the server's own tests.

## Exports

```json
"./api":   "./src/api.d.ts"     // the OpenAPI types, re-exported under stable names
"./lib/*": "./src/*.ts"         // everything below
```

| Module | What it gives you |
| --- | --- |
| `lib/api-client` | `openapi-fetch` clients over the generated `paths`, with a retrying fetch and the JSON conventions the API expects |
| `lib/authed-client` | A client that carries a bearer token, for non-browser clients such as dit |
| `lib/auth-client` | The Better Auth React client (email and password, anonymous sessions, the OAuth provider client the MCP consent flow uses), built for whichever server it is pointed at |
| `lib/api-base-url` | `FALLBACK_API_URL` (`http://localhost:8080`) and `serverApiBaseUrl`, which honours `INTERNAL_API_URL`, read at start-up |
| `lib/enums` | Generated: DAW names, relation types, priorities, member roles, entity kinds, comment targets, label targets, saved-view kinds, activity actions, job kinds and statuses, audio extensions, measure names |
| `lib/entity` | The shared shape of the four entity kinds (project, collection, track, session) for code that treats them alike |
| `lib/upload` | Multipart upload helpers for assets and images |
| `lib/action-result` | The `{ data } \| { error }` envelope server actions return, and its helpers |

Import as `@workspace/api/lib/api-client`, `@workspace/api/api`, and so on.

## Generated files

`src/v1.d.ts` and `src/enums.ts` are written by `bun run typegen` at the repo root, which runs the server's
generator in-process against its OpenAPI document. No server or database is needed.

- `src/v1.d.ts` is **gitignored**. A fresh checkout runs `bun run typegen` (or `bun run typecheck`, which runs it
  first) before anything that imports the types compiles. turbo's `build` and `typecheck` tasks depend on it, so
  the normal gates regenerate it for you.
- `src/enums.ts` is **committed**, because runtime code imports it. Regenerate and commit it with any server enum
  change; CI fails if the committed copy drifts from the generator.

Neither file is ever hand-edited.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run typecheck` | `bun check` |
| `bun run lint` | ESLint (`@workspace/eslint-config/base`) |
| `bun run test` | `bun test --parallel`; `enums.test.ts` imports the server's schema source and asserts the generated enums match it, which is why `server` is a devDependency here |

## Gotchas

- The MCP endpoint is not in the OpenAPI document, so nothing here describes it.
- `server` is a devDependency of this package for the enums test, so the server cannot depend on this package
  without a cycle. Shared runtime code the server needs (the DSP loader, for instance) lives in its own package.
