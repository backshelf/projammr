# apps/server

Hono REST API on :8080, mounted at `/api`; PostgreSQL through Drizzle. The source of truth for every entity.
Full references: `docs/agents/server-api.md` (wiring, route table, entity registry, tests) and
`docs/agents/db.md` (every table, enum, query function, SQL gotchas). Read the one you need before editing.

## Commands

```bash
bun run dev              # bun --watch src/server.ts (:8080); check nothing already holds the port
bun run test             # bun test — needs a live Postgres (apps/server/.env DATABASE_URL); no port bound
bun run test:smoke       # eight core route files; the upgrade job runs them on a migrated release baseline
bun test src/routes/notes.test.ts          # one file
bun test -t "returns 403"                  # by name
bun run typecheck        # bun check -p tsconfig.typecheck.json (stricter than the build: noUncheckedIndexedAccess)
bun run generate         # drizzle-kit generate — after any src/db/schema/ change
bun run migrate          # src/db/migrate.ts — drizzle-orm's migrator; the api container runs it before listening
bun run typegen          # rebuild packages/api types from the in-process OpenAPI doc (root bun run typecheck runs it)
```

## Layout

- `src/app.ts` builds the Hono app (middleware order matters; see the reference). `src/server.ts` is the only
  file that listens. Tests and typegen import `app.ts` and never bind a port.
- `src/entities/<entity>/` — schema refs, queries, routes and registration for project, collection, track,
  session, track-audio. Entity-specific routers mount **before** the generic `/:id` routes so static paths
  are not swallowed. A new entity is a new directory plus an entry in `src/entities/index.ts`.
- `src/routes/` — non-entity routers (auth, me, images, assets, comments, statuses, jobs, notes, lyrics,
  sharelinks, invites, track-audios). Every route is declared with `hono-openapi`.
- `src/middleware/` — `session` (global), `authenticated`, `authorizeProject` (role gate, one project per
  request), `rate-limit` (in-memory buckets), `trusted-origin`, `request-log`.
- `src/db/schema/` — one file per area; `src/db/queries/` — cross-entity queries; `src/db/migrations/`.
- `src/lib/` — storage, media (ffmpeg), jobs, notes crypto, env, palette, dictionaries.
- `src/test/fixtures.ts` — `setupSuite(label)` gives each test file its own project with owner/editor/
  viewer/outsider, `request`, `expectAccess`, and `mk*` builders. Use it for every route test.

## Rules

- **Adding or changing a route**: declare it with `hono-openapi`, then run the drift gate before committing:
  `bun run typegen && git diff --exit-code packages/api/src/enums.ts` (`v1.d.ts` is gitignored). Commit the
  regenerated files with the change.
- **Schema-owned value lists** (DAWs, roles, …) are mirrored into `packages/api` by `scripts/generate-api.ts`;
  add new ones there, never as a literal in `packages/api`.
- **Schema changes** go through `bun run generate` migrations. No compatibility shims (pre-release).
  drizzle-kit loads every file in `src/db/schema/`, so a test there breaks `generate`; schema tests live in
  `src/db/`.
- `respond()` throws outside production when a payload does not match its declared schema. That is a bug
  in the route, not a test nuisance.
- `authorizeProject` gates one project per request; every other foreign id in a body is the handler's job
  (`assertInProject`, `assertStatusUsable`), answering 404 for a foreign row.
- Notes are outside project authorization entirely; `loadNoteAccess` is their gate.
- NodeNext modules: `.js` suffix on relative imports, `import type` for types (`verbatimModuleSyntax`).

## Gotchas

- A raw `sql` timestamp is a bare UTC string that `new Date()` reads in the process zone: `.mapWith(<column>)` in a
  `db.select`; in `db.execute` select `to_char(col, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` (see `db.md`, Raw-SQL gotchas).
- A `sql` fragment with an interpolated value cannot be repeated across SELECT/GROUP BY/ORDER BY; alias it.
- `Pool.prototype.query` spies see nothing inside `db.transaction`; spy `Client.prototype.query`.
- `jobs.test.ts` and `static.test.ts` run serially last (they reach past their own rows); everything else
  runs in parallel, which is why every file needs its own `setupSuite` project.
- Dictionaries (CMU, WordNet) load lazily from the listen callback; never at module scope.
- Deleting an asset removes the file after the row commits; a crash between the two leaves an orphan file.
