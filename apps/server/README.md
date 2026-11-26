# Projammr API (`apps/server`)

The source of truth. A Hono REST API on Bun, listening on port **8080** with every route mounted under `/api`.
PostgreSQL through Drizzle ORM, auth through Better Auth, background jobs for anything that touches ffmpeg or the
WebAssembly analysis, an OpenAPI document generated from the route definitions, and an MCP endpoint for AI clients.

## Setup

```bash
bun install                 # from the monorepo root; then create .env (see below)
bun run migrate             # apply pending Drizzle migrations
bun run dev                 # bun --watch src/server.ts → http://localhost:8080/api
```

### Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | yes | — | Session cookie signing key; the server refuses to boot without one |
| `NOTES_MASTER_KEY` | yes | — | Root of every note's key hierarchy, 32 bytes base64-encoded; the server refuses to boot without one, and losing it makes every note unreadable |
| `BETTER_AUTH_URL` | no | `http://localhost:3000` | The browser-facing origin Better Auth is served from. In development that is the Next dev server, which proxies `/api` here. The OAuth issuer, its JWKS URL and the MCP resource derive from it |
| `TRUSTED_ORIGINS` | no | `CLIENT_URL`, else `http://localhost:3000` | Comma-separated origins allowed to call the API with credentials; feeds both CORS and Better Auth |
| `CLIENT_URL` | no | — | Fallback for `TRUSTED_ORIGINS` when it is unset |
| `BASE_URL` | no | `http://localhost:8080` | Server URL advertised in the OpenAPI document |
| `MAX_UPLOAD_MB` | no | `128` | Upload size cap for assets and images, in MiB, at most 2048 (the fixed transport ceiling the server reads bodies up to). The server holds a whole upload in memory, so a higher cap costs that much RAM per upload in flight |
| `MEDIA_CONCURRENCY` | no | `2` | Background jobs running at once; each analysis spawns an ffmpeg child |
| `JOB_RETRY_DELAY_MS` | no | `5000` | Delay before a failed job is retried, multiplied by the attempt number |
| `DB_POOL_MAX` | no | `20` | Maximum PostgreSQL connections held by the pool |
| `LOG_FORMAT` | no | readable lines | `json` writes one JSON object per line for a log aggregator |
| `LOG_LEVEL` | no | `info` | Lowest level written: `debug`, `info`, `warn` or `error` |
| `FFMPEG_PATH` | no | `./deps/ffmpeg/bin/ffmpeg` | The ffmpeg binary. Set it to `ffmpeg` when it is installed system-wide |
| `MCP_DISABLED` | no | — | `1` turns the MCP endpoint and its OAuth provider off outright (typegen sets it, since it runs without a database) |

### Media binaries

Track audio processing runs `ffmpeg` through `src/lib/media.ts`, the only module that spawns a child process. It
decodes an audio once into `@workspace/dsp`'s analysis session, which produces peaks, loudness, spectrum, tempo,
key, sections and the rest together. The decode is queued when an audio is linked and runs in the background at
`MEDIA_CONCURRENCY` at a time, so no request waits on a spawn. Local development expects the binary either on
`PATH` (`FFMPEG_PATH=ffmpeg`) or vendored under `deps/` (gitignored):

```
deps/ffmpeg/bin/ffmpeg
```

## Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Hot-reloading dev server via `bun --watch` |
| `bun run build` | `bun build` → `dist/server.js` and `dist/migrate.js` |
| `bun run start` | Run the built server |
| `bun run test` | `bun test` (one file per concern, needs a live database) |
| `bun run typegen` | Write the OpenAPI document into `packages/api` (offline, no database) |
| `bun run generate` | Drizzle Kit: generate a migration from schema changes |
| `bun run migrate` | `src/db/migrate.ts`: apply pending migrations |

Run one test file or pattern directly:

```bash
bun test src/routes/notes.test.ts
bun test -t "returns 403"
```

## Layout

```
src/app.ts                App wiring: basePath, CORS, OpenAPI, session middleware, route mounts (no listen)
src/server.ts             Binds :8080, starts the job runner, handles shutdown
src/static.ts             The gated `/static/*` handler: access control, MIME policy, cache and CORS headers
src/auth.ts               Better Auth config: email/password, Drizzle adapter, bearer, OAuth provider + JWT for MCP
src/entities/             One directory per entity (project, collection, track, session, track-audio): schema
                          refs, queries, routes, registered through src/entities/index.ts. A new entity is one
                          directory plus a registration, not a case added to every consumer
src/routes/               Non-entity routers: activity-log, assets, auth, comments, images, invites, jobs, lyrics,
                          me, notes, sharelinks, statuses, track-audios, uploads; generic.ts builds the per-entity
                          CRUD routes the registry mounts
src/mcp/                  The MCP endpoint: route, actor and scope checks, the tool and resource registry
src/middleware/           authenticated, authorizeProject, per-mount project resolvers, request log, rate limit
src/lib/                  Storage, media (ffmpeg), jobs and job events, notes crypto, palette extraction,
                          spectrogram PNGs, the scoped logger, env, health
src/db/schema/            Drizzle tables, enums, and generated zod insert/select/update schemas, one file per area
src/db/queries/           Query layer: business logic and response schemas live here, not in routes
src/db/migrations/        Drizzle migrations (generated; never hand-edit the SQL)
src/test/                 Test fixtures: setupSuite, media helpers
static/                   Uploaded images, assets and analysis PNGs (gitignored, served at /static/*)
```

## Request pipeline

Order in `src/app.ts` matters:

1. `requestId()` stamps every request with an `X-Request-Id` (an incoming one is honoured) and the request logger
   writes one line per request once its status is known.
2. `GET /api/health` is registered here, ahead of the session middleware: a monitor carries no cookies and should
   not wait on a session lookup that will find nothing.
3. A global middleware resolves the Better Auth session and sets `user` and `session` on the context. It never
   throws. It sits on the **root** app, ahead of `basePath`, so `/static/*` is covered by the same resolution.
4. `/static/*` (`src/static.ts`) is mounted **before** `basePath`, so uploads are served at `/static/...`, not
   `/api/static/...`. It is deny-by-default: a path with no row in the database is a 404 for everyone, and the row
   it does find decides who may read it. A project image or asset needs `viewer` on that project; an image with no
   project (an avatar) is readable by any signed-in user. Anonymous callers get 401, signed-in non-members 403.

   Serving is policy-driven rather than a replay of what was uploaded. Uploads themselves stay unrestricted (a
   music project legitimately stores stems, PDFs and zips) but only `audio/*` and `image/*` are served inline under
   their stored MIME type; everything else becomes `application/octet-stream` with
   `Content-Disposition: attachment`, so an uploaded HTML file cannot run script on the API origin. `?download`
   forces an attachment for the inline types too. Every response carries `X-Content-Type-Options: nosniff`,
   `Cache-Control: private, max-age=3600`, an `ETag`, and `Accept-Ranges: bytes`. Image requests can ask for a
   cached resized variant by width.

5. `app.basePath("/api")`, then CORS (`TRUSTED_ORIGINS`, credentials on).
6. `GET /api/openapi` serves the generated spec. `bun run typegen` reads it, and `GET /api/docs` renders it as a
   Scalar reference.
7. Each resource is mounted as `app.use("/x/*", authenticated)` + `app.use("/x/*", authorizeProject(...))` +
   `app.route("/x", router)`. `/mcp` and `/auth` are mounted last; `/auth` is unguarded.

## Operability

- **`GET /api/health`** is public and cheap. It reports database reachability (a `select 1` capped at two seconds),
  whether ffmpeg is present, and how deep the media queue is. A missing binary is `degraded` with a 200; an
  unreachable database is a 503. It also carries the server's `version` (already public on `/api/instance`). It carries no
  configuration.
- **`GET /api/docs`** renders the OpenAPI spec through Scalar. In production it needs a session; anonymous callers
  get a 404 rather than a 401, since there is nothing there to sign in to.
- **Logging** goes through `src/lib/log.ts`. A module takes a scoped logger (`const logger = log("tracks")`) and
  calls `info`/`warn`/`error`/`debug` with a message and fields; the codebase never uses `console.*`.
  `LOG_FORMAT=json` writes one JSON object per line. Every request logs once on completion with its `requestId`,
  and failures repeat that id in the response body, so a user can quote it and it can be grepped.
- **Rate limits** come in two layers. Better Auth meters its own endpoints (60 a minute in general, 5 sign-ins a
  minute, 5 sign-ups an hour), counted in the `rate_limits` table so the limits survive a restart. The limiter keys
  on the caller's address taken from `X-Forwarded-For`, which is only trustworthy if a proxy in front of this server
  overwrites it. On top of that, `src/middleware/rate-limit.ts` is an in-process token bucket keyed per user,
  applied to the endpoints that cost real work: uploads, conversion, backfills, bulk moves, note saves, the lyrics
  analysis, OAuth client registration and the MCP endpoint. It answers 429 with `Retry-After`.
- **Shutdown** is graceful: in-flight requests and event streams are given a moment, running jobs are marked so a
  restart resumes them, and the Docker image's healthcheck keeps the web container waiting until the database is
  actually reachable.

## Auth and authorization

- Better Auth handles sign-up and sign-in with cookie sessions. The `bearer` plugin lets dit authenticate
  with a token instead of a cookie. The OAuth provider and JWT plugins
  issue the tokens MCP clients present (see below).
- `members.role` is a `member_role` enum (`owner | admin | editor | viewer`). `authorizeProject` resolves each
  request to a project and requires viewer for reads, editor for writes, admin for member management and invites,
  and owner to delete a project or transfer it. Resolvers return `null` for a missing entity (404) or `"unscoped"`
  for entities with no project, which fall through to auth-only. On success the gated project and the caller's role
  are on the context (`c.get("projectId")`, `c.get("role")`).
- `TRUSTED_ORIGINS` decides who may call the API with credentials: it feeds both Hono's CORS and Better Auth's
  `trustedOrigins`. dit's clients sign in through a token flow instead.
- Because a wildcard `app.use("/x/*")` never sees the downstream `:id` param, resolvers parse ids from the path.

## Connect an AI client

`POST /api/mcp` is a Model Context Protocol endpoint: a bearer-token surface, separate from the cookie-session
API, that gives an AI client tools and resources over a project's data. Access tokens are JWTs minted by the
OAuth provider Better Auth runs (dynamic client registration, PKCE, `read` and `write` scopes, a consent page in
the web client), verified against the server's own JWKS. A read-only token gets a 403 naming the missing scope on
any write tool; every caller is rate limited per user.

It is only on when `BETTER_AUTH_URL` is HTTPS or a loopback host; a plain-HTTP LAN address turns it off and the
server answers 404 there like any unknown path.

```bash
claude mcp add --transport http projammr https://<PUBLIC_HOST>/api/mcp
claude mcp login projammr      # opens the browser: sign in, choose read or read+write, done
```

In development, add it at `http://localhost:3000/api/mcp`: the Next dev server proxies `/api` here, and
`http://localhost` satisfies the loopback rule without HTTPS.

Tools cover the catalogue (`list_projects`, `get_project`, `list_collection_tracks`, `list_track_sessions`,
`search`, `get_activity`, bulk updates and labels, session linking), the notebook and lyrics (`list_notes`,
`read_note`, `write_note`, `create_note`, `link_note`, `read_lyrics`, `write_lyrics`), audio (`audit_audio`,
`get_track_audio_facts`, `link_audio_versions`, `set_primary_audio`, `queue_analysis`, `queue_backfill`) and jobs
(`list_jobs`, `get_job`, `cancel_job`). The full list is in `src/mcp/tools/`, and the same authorization helpers
gate them as gate the HTTP routes.

## Routes

The four entities (`/projects`, `/collections`, `/tracks`, `/sessions`) get their create, read, update, delete,
bulk patch and delete, label and attachment routes from `src/routes/generic.ts` through the registry in
`src/entities/`; each entity adds its own routes beside its queries. Highlights:

- `PUT` is a full update, `PATCH` is partial. Lists come as `/paginated` (filters, facets, sorting, grouping) and
  `/summary` (light rows for sidebars and pickers); prefer `/summary` for lists, the heavy endpoints are far larger.
- Uploads are multipart to `POST /api/assets/upload` and `POST /api/images/upload`; `GET /api/uploads/limits`
  reports the cap. Attachments are separate JSON calls that link an existing `assetId` to an entity.
- A track's audio versions: `POST /tracks/:id/audios` links assets (idempotent, resequences versions, queues
  analysis), `/track-audios/:id/measures/:measure` serves the lazy measurement columns, `/track-audios/:id/diff/:otherId`
  the comparison between two versions.
- Sessions: `/sessions/:id/saves` and `/projects/:id/saves` read a session's saves back; `/projects/:id/heatmap`
  and `/me/heatmap` count them by day; `/projects/:id/plugins` inventories the devices they name.
- Jobs: `/projects/:id/jobs` lists them, `/projects/:id/jobs/events` streams changes as server-sent events,
  `/jobs/:id/retry` and `/jobs/:id/cancel` do what they say.
- `/notes` is gated on authorship rather than project membership (a note belongs to its author whether or not it
  is linked into a project); `/lyrics/analyze`, `/lyrics/rhymes` and `/lyrics/synonyms` answer about words only.
- `/share` creates, lists and edits share links; `/share/:token`, `/share/:token/stream`, `/share/:token/cover/:id`
  and `/share/:token/comments` are public, and answer 410 once a link expires or is revoked.
- Project deletion cascades members, statuses, assets and images, and unlinks those files from disk. Deleting a
  single asset or image unlinks its file too.

The complete table, with roles and notes per route, is in `docs/agents/server-api.md`, and the live document is
at `/api/docs`.

## Jobs

Anything slow runs as a job row: `audio_analysis` (one decode into the WebAssembly analysis, then the row, the
spectrogram PNG, the features and the diffs), `audio_backfill` (every version in a project that is behind the
current analysis version), `convert` (an ffmpeg transcode) and `image_variants` (cached resizes). Each kind
registers its handler, its step ladder and, where its unfinished state persists on its own rows, an
"outstanding work" finder the boot pass uses to queue what nobody asked for. Progress is real (frames decoded
against ffmpeg's own duration), written at most every 250 ms, and published to the project's event stream. A
killed process resumes its interrupted jobs on boot; finished rows are pruned after a week.

## Database rules

All schema changes go through Drizzle. Edit the owning file in `src/db/schema/`, run `bun run generate`, then
`bun run migrate`. Never hand-edit generated migration SQL or run DDL directly; the snapshot must stay in sync with
the schema. Data-only migrations use `drizzle-kit generate --custom`.

Notes are stored as ciphertext: a per-note key wrapped under a scope key derived from `NOTES_MASTER_KEY`, with the
body and a `{title, preview}` summary sealed separately so a list never opens a body. No key material leaves the
server through the API.

## Testing

Tests live beside the code they cover (`src/routes/*.test.ts`, `src/lib/*.test.ts`, …) and drive the app
in-process with `app.request()` against a real database; no port is bound. `src/test/fixtures.ts` gives each
route-test file its own project with an owner, editor, viewer and outsider via `setupSuite`, so files run in
parallel, and tears it down afterwards, so a run is net-zero on rows. The few files that reach past their own
rows run serially last.

## Gotchas

- `tsconfig` extends the shared base directly. Module resolution is NodeNext, so relative imports need `.js`
  suffixes.
- `bun run typegen` builds the OpenAPI document in-process; it needs no running server and no database, but it
  does need `BETTER_AUTH_SECRET` and a 32-byte `NOTES_MASTER_KEY` in the environment, because the env module
  refuses to load without them.
- The `/mcp` route is not in the OpenAPI document, so the generated client types are the same whether it is on
  or off.
