# apps/client

Next.js 16 (App Router, RSC-first, React 19, Tailwind v4) web client. Full reference: `docs/agents/client.md`
(route tree, sub-router, data loading, component map, lib/hooks index). Design language:
`DESIGN.md`. Read both before editing UI. **This is Next.js 16**: read
`node_modules/next/dist/docs/` for anything you are not sure about; `proxy.ts` replaces `middleware.ts`,
`params`/`searchParams` are Promises, Turbopack is the default.

## Commands

```bash
bun run dev                               # next dev on :3000 — check nothing already holds it
bun --bun next dev -p 3001                # another port
bun run typecheck                         # bun check
bun run test                              # bun test --parallel (each file isolated)
bun test src/lib/route-parser.test.ts     # one file
bun run build
```

TanStack Table is used in `src/components/tables/`: run `bunx @tanstack/intent@latest list` and load the
table skill before changing table code. It is Table v9; v8 examples do not apply.

## Layout

- `src/app/` — route tree. Below `/project/[projectId]` a single `[...route]` page hands the URL to
  `src/lib/route-parser.ts`, which returns a discriminated union that `src/modules/` renders. New URL
  shapes extend `parseRoute` and `modules/`; never add file-based routes there.
- `src/modules/<entity>/` — server components per entity (project, collection, track, session), plus shared
  list machinery (`entity-list/`) and sub-pages (`project/repo.tsx`, `project/plugins.tsx`,
  `project/samples.tsx`, `session/history.tsx`). A project's settings are the settings hub's
  (`src/app/(app)/settings/`, `src/components/settings-hub/`), not a module.
- `src/components/<feature>/` — client components grouped by feature (tables, forms, masthead, sidebar,
  music-player, command-palette, notebook, session-structure, work-heatmap, …).
- `src/actions/` — `"use server"` files, one per resource, calling `lib/server-api.ts`.
- `src/lib/` — pure helpers with co-located `*.test.ts`; `src/hooks/` — hooks.
- `src/proxy.ts` — optimistic session gate for `/project/*`, `/notes/*`, `/profile`, `/admin` and `/settings`
  (its `matcher` is the list), and the forward of `/api/*` and `/.well-known/*` to `INTERNAL_API_URL`.

## Data and auth

- **Server side** (RSC, server actions): `lib/server-api.ts` forwards the request cookies and origin; call sites pass
  no headers. Actions return `Data | ActionError`; callers narrow with `isActionError` from
  `@workspace/api/lib/action-result`, which is the only narrowing idiom in the client.
- **Browser side**: `lib/browser-api.ts`. Requests go to `/api/*` on the Next origin, which
  `proxy.ts` forwards to the API server, so the HttpOnly session cookie authenticates them. Never add
  a bearer token to a browser client; `bearer()` exists for non-browser clients such as dit only.
- **Session**: `lib/session.ts` reads the signed `session_data` cookie in-process and falls back to the API
  only when it is absent; `SessionState` keeps "signed out" and "could not tell" distinct so a transport
  failure cannot redirect-loop. `proxy.ts` redirects signed-out callers and lets unreadable sessions through
  for the route to reject.
- Client state is a derived realization of the API; never keep a hand-synced copy. Each transport declares
  who re-renders after a write: a server action's write result goes through `lib/write-action.ts`'s
  `written()`, which calls Next's `refresh()` on success — the route re-renders inside that action's own
  response, so a caller has no reason to call `router.refresh()` after one. A browser mutation is a `Mutation<T>`
  (`lib/mutation.ts`), run only by `applyMutation` (via `hooks/use-mutate.ts`'s `useMutate()`), which applies
  the `InvalidationKey`s it declares on success — `"route"` refreshes the router, any other key notifies a
  client-held list subscribed through `onInvalidated`.
- Uploads go straight to the API (server actions cap bodies at 1 MB). Media URLs go through `/media/*`.
- Prefer `/summary` endpoints and RSC promise streaming for lists; the heavy list endpoints are far larger.

## Gotchas

- The test suite preloads a DOM (`bunfig.toml` → `packages/test/src/dom.ts`, the same preload
  `packages/ui` uses), so a component test can render with Testing Library (`render`, `screen`,
  `fireEvent` from `@testing-library/react`) and assert on an effect or an event handler. A suite that
  needs `typeof window === "undefined"`, or a stubbed `window`, uses `stubGlobal` from
  `@workspace/test/globals` for that one value.
- Dynamic segments are strings even where page types claim otherwise; path params are strings.
- A module that starts with `import "server-only"` cannot be imported by a test. Keep the pure half in its
  own module (`lib/session-state.ts` / `lib/session.ts` is the pattern) or `mock.module("server-only", …)`.
- `mock.module` is not hoisted: static imports load first. Call it at the top, then `await import(...)` the
  module under test (`lib/session.test.ts`).
- Every in-app link is `AppLink` (`components/navigation/AppLink.tsx`), never `next/link` directly: a
  `no-restricted-imports` rule in `eslint.config.js` forbids the default import everywhere but `AppLink`
  itself. `useLinkStatus` and the module's other named exports stay available.
- `tsconfig.json` includes the route types an earlier `next build` or `next dev` left in `.next/types` and
  `.next/dev/types`, and the type check never regenerates them. After a merge deletes a page, `typecheck` fails on
  `validator.ts` importing it: `rm -rf .next/types .next/dev/types` and re-run.
- `images.unoptimized: true`; both `next/image` and `<img>` are used on proxied URLs.
- Tailwind palette colours are never used; colour comes from the artwork tokens (`DESIGN.md` Colors).
- Heatmap `day` strings are the viewer's local calendar days: the server buckets saves in the `tz` it is
  sent, the formatter set's zone. `@workspace/ui/lib/heatmap` and `lib/heatmap-range.ts` carry each day as a
  UTC-midnight timestamp, so never mix them with local-time `Date` constructors or getters.
  `trailingWeekRange` keeps the two notions of the window apart: `from`/`to`/`today` are calendar days for
  the grid and `streaks`, `query` is the local-midnight instants the server is asked for. Callers get both
  from `hooks/use-heatmap-window.ts`, in `useFormat().timeZone`.
- Never format a date, time, duration, size, loudness, count, key or tempo by hand or with `Intl`/`toLocale*`:
  `useFormat()` (client), `<Formatted>` (a table cell or peek field), `cachedFormatters()` (server). The
  server's first render for a browser with no zone cookie yet reads the server's zone; `FormatProvider`
  hydrates in it and moves to the browser's on the next render, so markup that depends on the zone must read
  it from the set, never from `Intl` directly.
- zod is v4; TypeScript is v7.
- Per-frame playback values never enter React state; write the DOM from a subscription, as
  `useProgressFrames` and `useLoudnessFrames` do. A `useSyncExternalStore` update is blocking, and one per
  frame restarts every navigation transition so pages hang in "Rendering…" while a track plays.
- A metadata image route with `generateImageMetadata` (`share/[token]/opengraph-image.tsx`) gets a
  Next-generated `generateStaticParams` and is served as ISR unless it exports `dynamic = "force-dynamic"`.
  One that reads per-request data then 404s and caches the 404 in a production build; `next dev` never
  shows it, so check such a route on `next start`.

## Skills

When touching the client code:

- Always use the vercel- skills
- Always use ui-skills-root
- Always use tailwind-design-system

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
