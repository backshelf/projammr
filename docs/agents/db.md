# Reference: Database layer (`apps/server/src/db`)

_Updated 2026-09-19. Stack: drizzle-orm 1.0.0-rc.4 + drizzle-kit 1.0.0-rc.4, `pg` (node-postgres driver), zod v4,
Better Auth Drizzle adapter._

## Layout

- **Schema is one file per table group under `src/db/schema/`** (no single `schema.ts`). `drizzle.config.ts` points
  `schema: "./src/db/schema"` — `drizzle-kit` finds every table by scanning the folder, so a new module needs no
  config change.
- `src/db/tables.ts` spreads every `schema/*.ts` module into one `tables` object — the single argument
  `defineRelations` (`src/db/relations.ts`) and the Better Auth adapter each take. Nothing else imports `tables`;
  a consumer imports the `schema/<file>.js` module that owns what it needs.
- `src/db/index.ts` builds the `db` client: `drizzle({ connection, relations })` over a `pg` pool with
  `statement_timeout: 30_000`, `max: DB_POOL_MAX ?? 20`, `idleTimeoutMillis: 30_000` — set explicitly because an
  unbounded statement holds its connection indefinitely and the driver default of 10 connections saturates well
  before Postgres does. Every connection starts with `plan_cache_mode=force_custom_plan` (the pool's `options`),
  so each foreign-key check is planned for the referenced table as it stands: a plan Postgres cached while
  `objects` was a page or two is a sequential scan, and a commit linking 33,000 objects through it ran past 30 s
  until autovacuum next analysed the table. The cost is roughly 10 µs of planning per check, which doubles a bulk
  insert's trigger time and is noise for a single row. `src/db/index.test.ts` pins it; the app's own queries are
  unnamed statements, planned fresh either way. It also exports `Tx`, the client a `db.transaction` callback receives; every helper that
  runs inside a caller's transaction takes that type rather than spelling it out.
- `src/db/queries/*.ts` — cross-cutting and supporting-table query functions (auth, comments, images, assets,
  labels, search, pagination, jobs, notes, sharelinks, session saves, moves, track audios, track relations,
  statuses, saved views, invites, activity, artwork). Per-entity CRUD (`createTrack`, `getTracksPage`, …) instead
  lives in `src/entities/<kind>/queries.ts` (project, collection, track, session) — see
  `docs/agents/server-api.md` for the entity-registry pattern (`src/entities/index.ts`) that wires those into
  routes.
- Migrations in `src/db/migrations/<timestamp>_<name>/` — each folder is `migration.sql` + `snapshot.json`. There
  is no `meta/_journal.json`.
- Release baselines in `src/db/baselines/`: at most one `<version>.dump`, a full custom-format dump (journal rows
  included, so `applyMigrations` runs only what came after) of a demo-seeded database at the newest release tag. The
  upgrade job (`.github/workflows/upgrade.yml`) restores the newest one, runs `bun run migrate` and `bun run
  test:smoke` on it, and passes without a dump. The directory's `README.md` holds the recipe that produces one.

## Rules

- **All schema changes go through Drizzle.** Declare in `schema/*.ts`, `bun run generate` to produce the migration,
  `bun run migrate` to apply. Never hand-edit `migration.sql` or run raw DDL — the snapshot/SQL pair is the source of
  truth and skipping Drizzle desyncs types from what the database actually has.
- **A `pgTable`, `pgEnum` or relation in `schema/` that only its own file uses carries a `/** @public … */` tag.**
  drizzle-kit reads what the directory exports, so un-exporting one drops it from the next migration; the tag is
  what keeps knip from reporting it.
- **`bun run migrate` is `src/db/migrate.ts`**, drizzle-orm's own migrator (`src/db/migrator.ts`, which also owns the
  folder path `drizzle.config.ts` imports). It reads the same folders and `drizzle.__drizzle_migrations` journal as
  `drizzle-kit migrate` but needs no drizzle-kit, which is how the api container migrates before it listens.
  `applyMigrations` holds a session-level `pg_advisory_lock` for the whole run, so two replicas booting together
  serialize instead of racing drizzle's own `migrate()`; it diffs the on-disk migration folders against
  `drizzle.__drizzle_migrations` itself (`readMigrationFiles`/`getMigrationsToRun` from `drizzle-orm/migrator` and
  `drizzle-orm/migrator.utils`) to know whether anything is pending before doing anything else. When something is
  pending and `MIGRATE_BACKUP` is not `"0"`, it shells out to `pg_dump --format=custom` (the api image installs
  `postgresql-client-17` for this) into `apps/server/backups/pre-<first-pending-migration>-<timestamp>.dump`,
  keeping the newest `BACKUPS_KEPT` (5) and aborting the migration if the dump fails; a `pg_dump` missing from
  `PATH` (e.g. running outside Docker) only warns. The compose `backup` profile
  (`docker compose --profile backup run --rm backup`) is a separate, on-demand dump into the same volume for a
  manual backup before a risky operation.
- **Custom (hand-written) migrations:** `bunx drizzle-kit generate --custom --name <name>` from `apps/server` writes
  the folder with a matching `snapshot.json` (only `id`/`prevIds` differ from the prior one) and an empty
  `migration.sql` to fill in — the sanctioned way to ship data backfills or DML that isn't schema-derived.
- **Two branches that each generated a migration from the same parent** merge with no textual conflict and leave
  the snapshot chain with two leaves (two `snapshot.json`s whose `prevIds` name the same parent). When the two
  leaves touch different objects, drizzle-kit accepts that (`check` passes; the next `generate` lists both leaves
  in its `prevIds`), and the migrator applies every folder its journal does not record, so a database that already
  ran the later-dated leaf still picks up the earlier one, out of timestamp order. When they conflict, `check` and
  `generate` both stop with "Non-commutative migrations detected": delete one side's folder,
  `bun run generate --name <name>` so it follows the other's tip, diff its SQL against the old one, and drop and
  recreate any database that applied the old folder (`.claude/hooks/worktree-db.sh drop` then `create`), since
  its journal names a folder that no longer exists.
- **Ambiguous diffs need `--hints` outside a TTY.** When a change could be a rename or a drop-and-create (an index
  replaced by one with a new name, a column swapped for another), `drizzle-kit generate` prompts; run
  non-interactively it prints the missing decisions and exits `2` without writing anything. Re-run with one hint
  per decision, e.g. `--hints '[{"type":"create","kind":"index","entity":["public","saved_views","saved_views_project_kind_owner_name"]}]'`
  (`rename` takes `from`/`to` tuples instead; `confirm_data_loss` approves dropping a non-empty entity).
  drizzle-kit's bundled `drizzle-hints` skill has the full shape.
- **Generated-column drop ordering:** `drizzle-kit` does not order `DROP COLUMN` to respect intra-table generated-
  column dependencies. Dropping a base column and its `GENERATED ALWAYS AS` dependent in one migration comes out
  base-first and fails at apply time with Postgres `2BP01`. Reordering the pre-existing statements (adding/removing
  none) is safe — see `20260908002139_previous_wolf_cub` (drops `tracks.lyrics_text` before `tracks.lyrics`).
  The same holds for an index re-keyed off a dropped column: `drizzle-kit` emits the `DROP COLUMN` before the
  `DROP INDEX`, and Postgres has already dropped the index with the column, so the `DROP INDEX` fails. Move the
  `DROP INDEX` first — see `20260927014224_track-relation-types-required`.
- **Merging branches that both added migrations.** Each snapshot names its parents in `prevIds`, so two branches
  leave two leaves. `drizzle-kit check` compares, under every fork, the branches that share no leaf; when both
  carry the same earlier migration (each merged a third branch before generating), it reports "Non-commutative
  migrations detected" over DDL neither wrote, and `generate` refuses to run. Join the leaves with a merge node:
  move the newer branch's folders aside, `bunx drizzle-kit generate --name <tmp>` for a snapshot of the whole
  schema, put the folders back, and ship that snapshot in its own folder with a fresh `id`, `prevIds` set to
  every leaf, and a no-op `migration.sql` — see `20260927035534_fleet-leaves-merge`. `check` then passes and
  `generate` finds no diff.
- **Deferrable unique constraints are not expressible in Drizzle.** A reorder that would momentarily violate a
  unique constraint (e.g. swapping two `track_number`s) must clear-then-set inside `FOR UPDATE` rather than rely on
  `DEFERRABLE INITIALLY DEFERRED`.
- **Empty id sets in raw SQL: use `array[]::int[]` with `= any(...)` / `<> all(...)`, never `in (null)`.**
  `x in (null)` evaluates to `NULL`, and a surrounding `not (...)` then swallows the row — this misclassified
  shared assets as exclusive in `move.ts` until a test caught it. `idArray(ids)` in `db/queries/move.ts` builds the
  literal; an empty array correctly answers `false`/`true` for membership/negation.

## Enums (`schema/enums.ts`)

| Enum (pg name) | Values |
| --- | --- |
| `member_role` | owner, admin, editor, viewer (ranked in that order, low→high) |
| `image_scope` | project, user, instance |
| `activity_target_type` | project, collection, track, session |
| `comment_target_type` | project, collection, track, session, track_audio |
| `label_target_type` | track, collection, session |
| `saved_view_kind` | track, collection, session |
| `activity_action` | created, updated, deleted, commented, archived, unarchived, resolved, reopened |
| `job_kind` | audio_analysis, convert, audio_backfill, image_variants, storage_audit, save_content_sweep |
| `storage_scope` | project, user |
| `job_status` | queued, running, done, failed, cancelled |
| `save_source` | scan, backup, app, dit |
| `content_state` | none, stored, pruned |
| `commit_kind` | user, checkpoint |
| `segment_source` | script, log, title, saves |
| `instance_role` | admin, user |
| `sharelink_entity` | collection, track |
| `sharelink_type` | snapshot, connected |
| `admin_audit_action` | reset_link_issued, role_changed, account_disabled, account_enabled, account_self_deleted |
| `settings_audit_scope` | project, instance |

`schema.test.ts` asserts every `pgEnum` in `enums.ts` matches a `raw*Enum` array of the same name in both
membership and order — a drifted raw array is as wrong as a drifted enum. Two enums may legitimately
carry the same values, so the test counts raw arrays rather than de-duplicating them.

## Base columns (`schema/base.ts`)

- `baseTimestamps` — `createdAt` (`timestamp`, default now), `updatedAt` (`timestamp`, default now,
  **`$onUpdate(() => new Date())`** — any `db.update` on a domain table bumps it, semantic or not).
- `baseSchema` — `id` (`integer`, `generatedAlwaysAsIdentity`, PK) + `baseTimestamps`. Every domain table spreads
  this; `id` needs no entry in `baseSchemaIgnores` since drizzle-zod already excludes identity columns.
- `baseSchemaIgnores = { createdAt, updatedAt }` — omitted from every insert/update zod schema (DB-owned).
- `scopeIgnores = { projectId }` — omitted from every *update* schema only: scope is fixed at creation, so an edit
  body cannot smuggle a row past the project it was authorized against.
- A write schema built as `createInsertSchema(t).omit(...)` or `createUpdateSchema(t)` takes every column it does
  not omit, so a new column on such a table is writable through the public routes the moment it lands. A column
  only the server writes (`sessions.repoId`, `ditSetId`, `currentBranchId`) joins that table's omit set in the
  same change.
- `BlockDocument` / `blockDocumentSchema` — a BlockNote document (`Record<string, unknown>[]`), stored as `jsonb`,
  handed back to the editor untouched. Used by `tracks.notes`, `collections.notes`, `sessions.notes`,
  `projects.description`.

## Tables

### Better Auth adapter (`schema/auth.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `id` text PK, `name`, `email` unique, `emailVerified`, `image`, `isAnonymous`, `instanceRole` (`instance_role`, default `user`, not null), `disabledAt` (nullable), `createdAt`/`updatedAt` | A user's own settings are rows of `user_settings` (see **Settings**), not a column here. `instanceRole` and `disabledAt` are declared to Better Auth as `user.additionalFields` with `input: false`, so they are read onto the session user but no request body can set them — the only writers are the first-user bootstrap and `PATCH /admin/users/:id`. **`isAnonymous` is nullable**: ask `is not true`, never `= false`, or a NULL row (a real account) reads as a guest. |
| `authSessions` (`auth_sessions`) | `id`, `expiresAt`, `token` unique, `ipAddress`, `userAgent`, `deviceName` (nullable, from an `X-Device-Name` header at sign-in; written only by `databaseHooks.session.create.before` in `auth.ts`, a `session.additionalFields` entry with `input: false`), `userId` → users cascade | index `sessions_userId_idx`. |
| `accounts` | `id`, `accountId`, `providerId`, `userId` → users cascade, OAuth token columns, `password` | index `accounts_userId_idx`. |
| `rateLimits` (`rate_limits`) | `id`, `key` unique, `count`, `lastRequest` bigint | Better Auth's own `storage: "database"` rate limiter; property names match what the adapter expects. |
| `deviceCodes` (`device_codes`) | `id`, `deviceCode` unique, `userCode` unique, `userId` → users cascade (set when the first signed-in caller looks the code up), `expiresAt`, `status` (`pending`/`approved`/`denied`), `lastPolledAt`, `pollingInterval` (ms), `clientId` (`dit`), `scope` | Better Auth's `deviceAuthorization` plugin (RFC 8628 for `dit login`); property names are the plugin's, so the adapter's plural lookup finds it through `tables`. The plugin deletes a row when it is redeemed, denied, or polled past `expiresAt`; a code never polled again is deleted by `reapExpiredDeviceCodes` (`db/queries/device-codes.ts`, a day past `expiresAt`; `startDeviceCodeReaper` runs it at boot and daily). |
| `verifications` | `id`, `identifier`, `value`, `expiresAt` | index on `identifier`. |

`publicUserSchema` / `publicUserColumns` / `publicUserMask` (also `auth.ts`) — the `users` shape with `email`,
`instanceRole` and `disabledAt` stripped, for anything a project member (not just `/me`) may read: member lists, activity feeds, uploader
columns. An email is contact detail, not public identity — it stays out of these; the invite list keeps it because
inviting by address is the point.

### OAuth provider and JWT plugin (`schema/oauth.ts`)

Eight tables, hand-declared the same way as `schema/auth.ts`: the OAuth Provider plugin's seven models
(`@better-auth/oauth-provider`) plus the JWT plugin's signing-key table. Column set and nullability were verified
against the field definitions in the installed package's built `dist` bundles, not the docs' Schema section (which names five models; the
package has seven).

| Table | Key columns | Notes |
| --- | --- | --- |
| `oauthClients` (`oauth_clients`) | `id` text PK, `clientId` unique not null, `clientSecret`, `redirectUris` text[] not null, `scopes`/`grantTypes`/`responseTypes`/`contacts` text[], `clientCredentialsScopes` text[] default `{}`, `disabled`/`dpopBoundAccessTokens` boolean default false, `userId` → users (nullable), `metadata` jsonb, registration metadata (`name`, `uri`, `icon`, `tos`, `policy`, software statement fields) | index `oauth_clients_user_id_idx`. A dynamically registered client has no `userId`. |
| `oauthResources` (`oauth_resources`) | `id`, `identifier` unique not null, `name` not null, `accessTokenTtl`/`refreshTokenTtl`/`policyVersion` integer (`policyVersion` default 1), `allowedScopes` text[], `customClaims` jsonb, `disabled`/`dpopBoundAccessTokensRequired` boolean default false | RFC 8707 resource indicators as first-class rows; a null policy column inherits the plugin-level default. |
| `oauthClientResources` (`oauth_client_resources`) | `id`, `clientId` → `oauth_clients.client_id` cascade, `resourceId` → `oauth_resources.identifier` cascade, `metadata` jsonb | Join table, authoritative only under `enforcePerClientResources`; unique `(clientId, resourceId)` plus indexes on both. |
| `oauthRefreshTokens` (`oauth_refresh_tokens`) | `id`, `token` unique not null, `clientId` → `oauth_clients.client_id`, `sessionId` → `auth_sessions.id` set null, `userId` → users not null, `scopes` text[] not null, `resources`/`requestedUserInfoClaims` text[], rotation columns (`revoked`, `rotatedAt`, `rotationReplayResponse`, `rotationReplayExpiresAt`), `authTime`, `confirmation` jsonb | Indexes on `clientId`, `sessionId`, `userId`, `authorizationCodeId`. |
| `oauthAccessTokens` (`oauth_access_tokens`) | `id`, `token` unique not null, `clientId` → `oauth_clients.client_id`, `sessionId` → `auth_sessions.id` set null, `userId` → users (nullable), `refreshId` → `oauth_refresh_tokens.id`, `scopes` text[] not null, `confirmation` jsonb | Opaque tokens only — a token with a resource audience is a JWT and never rows here. Created at refresh, destroyed at revoke, read at introspection. |
| `oauthConsents` (`oauth_consents`) | `id`, `clientId` → `oauth_clients.client_id`, `userId` → users (nullable), `scopes` text[] not null, `resources`/`requestedUserInfoClaims` text[] | Indexes on `clientId`, `userId`. |
| `oauthClientAssertions` (`oauth_client_assertions`) | `id` (a replay digest, not adapter-generated), `expiresAt` not null | Single-use `private_key_jwt` `jti` guard: a replayed or concurrent assertion collides on the primary key and the insert fails atomically. Nothing prunes expired rows. |
| `jwks` | `id`, `publicKey`/`privateKey` not null, `createdAt` not null, `expiresAt`, `alg`, `crv` | The JWT plugin's signing-key table. |

**The `jwkss` trap:** under `usePlural: true`, the adapter resolves a model's Drizzle key as `${model}s` — the JWT
plugin's model is `jwks`, so the adapter looks it up as **`jwkss`**. `auth.ts`'s schema map aliases `jwkss: jwks`
(beside `sessions: authSessions`) rather than naming the table `jwkss`. Both `oauthRefreshTokens.sessionId` and
`oauthAccessTokens.sessionId` reference `auth_sessions.id` (`authSessions`), never the music `sessions` table. Every reference to `users`, `oauth_clients` and `oauth_refresh_tokens` cascades on delete, matching what Better Auth's generator emits for a reference with no `onDelete`; the two `sessionId` columns set null.

### Sign-in lockout (`schema/signin-attempts.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `signinAttempts` (`signin_attempts`) | `emailHash` text PK, `failures` int default 0, `windowStartedAt` timestamp default now, `lockedUntil` timestamp (nullable) | `emailHash` is `sha256(lowercased email)` (`emailHashOf`, `db/queries/signin-attempts.ts`), never the address itself, so the table names no account that doesn't exist and a row leaked on its own reveals nothing readable. One row per email that has ever failed a sign-in since its window opened; a row is deleted outright on the next successful sign-in or an admin-issued reset link (`clearLockout`). |

Brute-force protection for `POST /auth/sign-in/email`: by default five failures in a 15-minute window are free,
the sixth locks the account, and each failure after that doubles the lock (1, 2, 4 … capped at 60 minutes) —
`lockAfter(failures, now)` in `db/queries/signin-attempts.ts` is the whole rule, a function of the failure count
and the instance policy's `lockoutFreeFailures`, `lockoutBaseMinutes` and `lockoutMaxMinutes`, read per failure
(the 15-minute window is fixed). `recordFailure` reads and updates the row inside one `FOR UPDATE` transaction so two failures racing the
same account can't both read the pre-lock count. A window that has elapsed since its own first failure resets on
the next failure rather than accumulating forever. Wired as a Better Auth `hooks.before`/`hooks.after` pair in
`auth.ts`, not a route: `before` refuses a locked account with 429 and `Retry-After` — the same status, body and
header whether or not the email belongs to a real account, so a lockout can't be used to probe which addresses
have signed up — before the password is ever checked; `after` reads `ctx.context.newSession` (clears on success)
or `ctx.context.returned` (`isAPIError` records a failure) once Better Auth has already decided the outcome. The
per-address `auth-signin` rate-limit bucket (`middleware/rate-limit.ts`, mounted in `app.ts`) is what bounds how
fast one caller can drive this lockout against a victim; this table is the per-account half.

### Settings (`schema/settings.ts`, `db/queries/settings.ts`)

Every setting is declared once, in the `@workspace/settings` registry (`docs/agents/packages.md`); the
server stores values per scope, one table each, and resolves them through the registry's `resolve`. A key a
scope leaves to the scope below it has no row; a row never holds a null.

| Table | Key columns | Notes |
| --- | --- | --- |
| `userSettings` (`user_settings`) | `user_id` → users cascade, `key`, `value` jsonb, `updated_at`; PK (`user_id`, `key`) | A user's own values (the Personal section). Never locked, never audited. |
| `projectSettings` (`project_settings`) | `project_id` → projects cascade, `key`, `value`, `locked` bool default false, `updated_by` → users set null, `updated_at`; PK (`project_id`, `key`) | A project's values and the member defaults it sets or locks. |
| `instanceSettingValues` (`instance_setting_values`) | `key` PK, `value`, `locked`, `updated_by`, `updated_at` | The instance's values and the defaults it sets or locks for everyone. `updated_by` is null where the instance wrote the row itself (the bootstrap, `setRegistration`). |
| `settingsAudit` (`settings_audit`) | `id` identity PK, `scope` (`settings_audit_scope`), `scope_id` text (the project id; null for the instance), `key`, `old`/`new` jsonb (null: no row before / none after), `locked_before`/`locked_after`, `actor_id` → users set null, `at`; index (`scope`, `scope_id`, `id` desc) | One row per changed value or lock at project and instance scope; a write of the value already stored records nothing. `scope_id` has no foreign key (it names whichever row its scope is keyed by), so a deleted project's rows stay, unreachable. |

**The column helper.** Every per-scope table spreads `settingValueColumns` (`key`, `value`, `updated_at`), and a
scope that can lock adds `lockableSettingColumns` (`locked`, `updated_by`), the way `baseSchema` is spread; a
new scope's table is its owner column, the two spreads and a composite primary key.

**Targets.** `db/queries/settings.ts` reaches each table through a `SettingTarget` — `userTarget(userId)`,
`projectTarget(projectId)`, `instanceTarget` — which carries everything the reads
and writes need to know about its scope: how to read, write and delete its rows, whether it can lock, whether
an instance lock refuses a write there, how the audit names it, and `mayWrite(definition, actor)` (the user:
always, the route having checked the id; a project: the actor's role against the key's
`minRole`, default `admin`; the instance: an instance admin). Nothing else branches on the scope.

**Reads.** `effectiveFor({userId, projectId?, role?, isAdmin})` reads the user's rows, the named project's,
the instance's and the `env` layer, and resolves every key the caller receives (`audience: "admin"` keys only
for an instance admin); `version` is a digest of the values, so it moves whenever one does, a cleared row
included. `hubRowsFor(context, keys?)` is the same read per key as the hub shows it — effective value,
source, `lockedBy`, `writable` and `values` keyed by scope, and `running` for a restart-required key (the
value the process runs with, from `runningInstancePolicy()`). `publicSettings()` resolves the
`audience: "public"` keys at the instance for `GET /api/instance`; `instanceSetting(definition)` one instance
key's value, for that route's `registration`. Membership in the project a read names is the route's check.

**The env layer.** `envLayer()` (`db/queries/settings-env.ts`) returns `{[key]: value}` for the seeded instance
keys whose variable is set (`SEEDED_SETTINGS`, `lib/instance-policy.ts`, read once at import through the same
mapping as the policy: `instance-limits.maxUploadMb`, `projectCapGb`, `userCapGb`, `instance-jobs.analysisWorkers`,
`instance-integrations.logLevel`); the resolver puts it below every stored scope and above the default (source
`env`), so a row wins and a reset returns to it. A key whose variable is unset is absent and resolves from the
default. It is a module of its own so a test can stand in for the environment.

**The instance cache.** The instance's rows are cached per process for 30 s (`instanceRows()`); a committed
instance write, lock or `setRegistration` drops it (`forgetInstanceRows`), and a read that began before a drop
is not kept. The effective, hub and public reads go through it; a write, a lock and the sign-up gate read
the rows themselves inside their own transaction, so a stale entry never decides one.
`reloadInstanceSettings()` reads the rows afresh into the cache and refreshes the process's instance policy
from them (`docs/agents/server-api.md`, **Instance policy**): at boot before the app is imported, every 30 s
(`startInstanceSettingsRefresh`, started by `server.ts`), and as the instance target's `committed` hook, awaited
before an instance write or lock answers. A reload that a forget overtook is dropped, one whose read fails
keeps the cache and the policy it had, and one whose rows make no policy updates the cache but keeps the policy. `instanceValues(keys)` resolves several instance keys through the cache, typed
per key (the `brand` of `GET /api/instance`); `projectValues(projectId, keys)` does the same for a project's
keys, reading its rows fresh and applying the instance's locks (what `projectPolicy` reads through).
`cachedRegistrationMode()` is the synchronous reader over the same cache for Better Auth's
`requireEmailVerification` getter: `instance-access.registration` as last read, or the registry default
(`open`) while nothing is cached.

**Writes.** `writeSettings(target, patch, actor)` parses `{[key]: value | null}` with
`valuesSchema(settingsFor(scope))` (400 for a key the scope does not accept), checks `mayWrite` per key
(403), then in one transaction under a per-target `pg_advisory_xact_lock(SETTINGS_LOCK_CLASS,
hashtext(target))` refuses a key the instance locks (409 `setting_locked`, `details: {scope, by, key}`,
nothing written), upserts or deletes each row, runs the target's `check` over the rows it leaves (the
instance's: the policy those rows would give, a 400 `invalid_request` naming both settings of a pair out of
order, nothing written), and writes an audit row per change at a scope that records them. The per-target lock
is what makes each audit row's `old` the value its write replaced. The target's `committed` hook runs after the
transaction, awaited.

**Locks.** A lock is the `locked` flag on a row at the locking scope, and the resolver's rule decides what
counts: a key not declared `lockable: false`, at a scope the key accepts, over a row that exists; the
instance's lock beats the project's. `setLocks(target, patch, actor)` takes `{[key]: boolean}` over the
scope's lockable keys (400 otherwise); locking a key with no row first writes the value it resolves to there
(the scopes below plus `env`), so the lock pins what everyone already sees, and later writes at the locking
scope move it. Rows above a lock are kept but inert, and live again when it lifts. An instance lock refuses
a write at every other scope (409); a project lock refuses none — it pins a member's value only inside that
project, and a user's row is written with no project in view — so the hub read reports it as
`writable.user: false` in that project's context instead. Clearing a locked row lifts its lock with it, so
only a role that may lock there (the target's `mayLock`: a project's owner or admins, an instance admin) may
clear it; anyone else gets a 403, whatever the key's `minRole`.

**Import and export.** `exportUserSettings(userId)` gives `{version: 1, exportedAt, values}`, the user's
valid rows in registry order. `importUserSettings(userId, file, {dryRun})` skips and reports rather than
refusing: `unknown` (not registered), `scope` (takes no personal value), `invalid` (fails its schema),
`locked` (the instance locks it); a dry run writes nothing. `listAudit(target, {limit, before})` pages the
audit newest first, `before` being the last row's id, with the actor's id and name.

**The first-user bootstrap** (`admitSignUp`, called from `auth.ts`'s `databaseHooks.user.create.before`):
`admitSignUp(email)` answers with the instance role the account being created may have, or `null` for "this
instance refuses you". With no non-anonymous account and registration open, the caller becomes `admin` and
the `instance-access.registration` row is set to `closed` in the same transaction (unaudited, no actor;
unless the instance policy's `closeAfterFirst` is off, read inside that transaction); while registration is
open it is an ordinary `user`; while it is closed only an address holding an unexpired, unaccepted invite is
admitted (`hasOpenInviteFor`, `db/queries/invites.ts`, case-insensitive on the address), and only while the
policy's `invitesBypass` is on. Registration is resolved like every other read — the row, then `env`, then the default — except
that a row whose value the registry rejects **fails closed** here: the gate treats it as `closed`, while the
readouts (`GET /api/instance`, the hub) show the default for it.

The whole decision runs under `pg_advisory_xact_lock(BOOTSTRAP_LOCK)`, and **the claim is a durable row, not
the user count**: the lock is released when that transaction commits, which is *before* Better Auth inserts
the user row it asked about, so a second concurrent sign-up would otherwise still count zero users and also
call itself the first. Closing registration used to be that claim, which is why the guarantee held only while
`closeAfterFirst` was on; the claim is now `FIRST_ADMIN_CLAIM_KEY`, a row in `instance_setting_values` under a
key no settings group registers (`isSettingKey` never matches it, so the hub, the patch route and the lock
route never see or accept it — `admitSignUp` is its only reader and writer), written whenever the "open, no
accounts" branch admits an admin, whether or not `closeAfterFirst` also closes registration. A second
concurrent sign-up for a different address wakes up to that claim and is admitted as `user` instead; the same
address retrying, or a claim older than `FIRST_ADMIN_CLAIM_STALE_MS` (10 minutes — Better Auth's insert can
still fail after admission, and a claim that never yields would strand the instance without an admin), is
treated as no claim at all. The re-read after the lock depends on read-committed snapshots (the default);
under repeatable read it would not see the first caller's commit. `setRegistration(mode, updatedBy)` writes
the registration row outside the audited admin path, as the test fixtures reopen registration with.

**The fold-in.** Three migrations carry `users.prefs` and the one-row `instance_settings` table into rows:
`settings-tables` (generated), `settings-fold-in` (custom DML: each string
`prefs.prefixes.rhyme`/`.synonym` becomes that user's `editor.rhymePrefix`/`editor.synonymPrefix` row, and
the registration mode the `instance-access.registration` row with its `updated_by`/`updated_at`), and
`settings-fold-in-drop` (generated: the column, the table and the `registration` enum). A migrated
database therefore holds a registration row even where no admin ever wrote one. `settings-migration.test.ts`
runs the DML over temporary copies of the tables.

### Instance accounts (`db/queries/instance-users.ts`)

`listInstanceUsers(page, pageSize)` and `changeInstanceUser(userId, patch, actorId, database?)` are the admin
API's account surface: email, name, role, `createdAt`, `lastSeenAt` (the newest `auth_sessions.updated_at`),
storage bytes (from the `storage_usage` user counter), project count and `disabled`. A change locks the admin
rows plus the target `FOR UPDATE` in id order and refuses with **409** anything that would leave the instance
without an admin who can sign in — a disabled admin does not count — and disabling an account revokes its
sessions in the same transaction (`revokeUserSessions`, `db/queries/auth-sessions.ts`), as does demoting an
admin, so a client holding the session's copy of the role cannot keep the admin shell past the cookie cache;
a promotion revokes nothing. `actorId` is who is
making the change, recorded via `recordAdminAction` in the same transaction (see **Admin audit trail**
below) — a patch touching both role and disabled state writes one row per distinct change. The optional
`database` argument is how the tests exercise the rule on an instance whose admins they own
(`src/test/database.ts`).

### Admin audit trail (`schema/admin-audit.ts`, `db/queries/admin-audit.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `adminAudit` (`admin_audit`) | base id, `action` (`admin_audit_action`), `actorId`/`targetUserId` → users **set null** (no cascade), `actorEmail`/`actorName`/`targetEmail`/`targetName` text not null, `detail` jsonb (nullable), `createdAt` | A queryable record of what an admin did to an account, kept separate from `activity` rather than widening that table's entity-kind enum: `activity` is project-scoped and keyed to an integer `entityId`, and an instance-level event on a Better Auth `text` user id has no natural place there. |

`recordAdminAction({ action, actorId, targetUserId, detail? }, database?)` (`db/queries/admin-audit.ts`) is
the single write path — every call site goes through it, never an inline `db.insert(adminAudit)`. It looks
up the actor's and target's current email and name and snapshots them onto the row: `actorId`/`targetUserId`
carry no `ON DELETE CASCADE`, so a row survives either account being deleted later (admin or target), and the
snapshot is what still answers "who did this, and who was it about" once the id behind it resolves to
nothing. Both accounts must still exist when it runs — account deletion writes the row before the `users` row
goes, never after.

`rawAdminAuditActionEnum` (`schema/enums.ts`): `reset_link_issued`, `role_changed`, `account_disabled`,
`account_enabled`, `account_self_deleted`. Call sites: `POST /admin/users/:id/reset-link`
(`routes/admin.ts`), `changeInstanceUser` (role and disabled/enabled, one row per distinct change),
`deleteAccount`'s `beforeDelete` hook (`account-deletion.ts` — the only deletion path; an account only ever
deletes itself, so the action names it a self-deletion with actor and target the same account), and
`scripts/make-admin.ts` (no signed-in admin runs that script, so the promoted account is recorded as its own
actor too).

### Projects & membership (`schema/projects.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `projects` | base, `name`, `description` jsonb `BlockDocument`, `links` jsonb `{name,url}[]`, `image` text | `links` validated as `{name, url (z.url())}` on insert/update. `description` is a BlockNote document like `tracks.notes`/`collections.notes`/`sessions.notes` — no generated text column, since search does not read it. |
| `members` | base, `userId` → users cascade (nullable), `projectId` → projects cascade (nullable), `role` `member_role` default `viewer` | unique `member_user_project` on `(userId, projectId)`; index `members_project` (the unique index leads with `userId`, so it can't serve a project's member list). |
| `invites` | base, `projectId` → projects cascade NOT NULL, `email`, `role` default `viewer`, `token` unique, `invitedBy` → users set-null, `expiresAt`, `acceptedAt` | partial unique index `invite_project_email` on `(projectId, email) WHERE accepted_at IS NULL` — one pending invite per email per project, re-invitable once accepted. |

### Collections (`schema/collections.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `collections` | base, `title`, `notes` jsonb `BlockDocument`, `notesText` **generated** (`regexp_replace(jsonb_path_query_array(notes,'strict $.**.text')::text, ...)`, trgm-indexed), `priorityId` → priority_levels restrict NOT NULL (see **Priority levels**), `projectId` → projects cascade NOT NULL, `image`, `statusId` → statuses set-default (default 1), `releaseDate` date, `upc` varchar(26) | gin trgm on `title`, `upc`, `notesText`; btree `(projectId, updatedAt)`; btree `statusId`; btree `priorityId`. |
| `collectionTracks` | `collectionId` → collections cascade, `trackId` → tracks cascade, `trackNumber` | composite PK `(collectionId, trackId)`; unique `dedupe_track_numbers` on `(collectionId, trackNumber)`; index `collection_tracks_track` on `trackId` (the PK leads with `collectionId`, so a track's own collections need this). |

### Tracks (`schema/tracks.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `tracks` | base, `title`, `artists` jsonb `string[]` NOT NULL, `priorityId` → priority_levels restrict NOT NULL (see **Priority levels**), `statusId` → statuses set-default (default 1), `projectId` → projects cascade NOT NULL, `notes` jsonb `BlockDocument`, `notesText` generated (same pattern as collections), `image`, `isrc`/`iswc` varchar(26), `explicit` boolean NOT NULL default false (filter, facet and sort key `explicit` on the paginated listing), `archivedAt` timestamp nullable (null = live; in `trackSchema`, left out of `newTrackSchema` and `editTrackSchema`, so only the archive routes write it; a session's archived state is its track's, never stored) | gin trgm on `title`, `isrc`, `iswc`, `notesText`, and on `artists` via a `regexp_replace(jsonb_path_query_array(...))` expression index; btree `(projectId, updatedAt)`; btree `statusId`; btree `priorityId`. |
| `trackRelations` | base, `fromTrackId` → tracks cascade (the derivative), `toTrackId` → tracks cascade (the source), `relationTypeId` → track_relation_types restrict NOT NULL (see **Relation types**) | unique index `track_relation_unique` on `(fromTrackId, toTrackId, relationTypeId)`; index `track_relations_to_track` on `toTrackId` (inverse direction — "what is derived from this track"); index `track_relations_type` on `relationTypeId`. Directed: the row is stored once, the inverse label ("remixed by") is derived in the UI. |
| `trackAudios` | base, `trackId` → tracks cascade, `assetId` → assets cascade, `version` int, `isPrimary` bool default false, `audioPeaks` jsonb `number[]`, `ltas` jsonb `Spectrum` (`{hz, db}` from `@workspace/dsp/spectrum`), `durationMs`, `lufs`/`lra`/`truePeakDb` real, `analysisVersion` int, `bpm`/`bpmConfidence`/`beatOffsetMs`, `musicalKey`/`keyConfidence`, `sections` jsonb `{startMs,endMs,group}[]`, `loudnessCurve` jsonb `(number\|null)[]`, `correlationCurve` jsonb `number[]`, `clipping` jsonb `{binIndex,samples,over}[]`, `silence` jsonb `{leadMs,tailMs}`, `pitchTrack` jsonb `number[]`, `spectrogramKey` text, `spectrogramBytes` int NOT NULL default 0, `duplicateOfId` → trackAudios set-null | unique `track_audio_asset` on `(trackId, assetId)`; unique `track_audio_version` on `(trackId, version)`; partial unique index `one_primary_audio` on `(trackId, isPrimary) WHERE is_primary = true`; index `track_audios_asset`; unique index `track_audios_spectrogram_key` on `spectrogramKey` (nullable, so most rows collide on nothing) — what the static route resolves an `analysis/<uuid>.png` request through; `duplicateOfId` is a self-FK added via `foreignKey()` in the extra-config callback (comments.ts's `parentId` pattern), to dodge circular TS inference. Every measured/detected column is written together by one decode and is null until then; `analysisVersion` is the `@workspace/dsp` `ANALYSIS_VERSION` (`packages/dsp/src/version.ts`) that decode ran under, null until first analysed, and the one signal a row is current — see `db/queries/track-audios.ts`'s `outstandingAnalysis` in the reference below. `audioPeaks`, `ltas`, `sections`, `loudnessCurve`, `correlationCurve`, `clipping` and `pitchTrack` are the lazy columns served only through `GET /track-audios/:id/measures/:measure` (`entities/track-audio/measures.ts`'s registry); every normal read excludes them via `trackAudioLazyColumns`/`trackAudioLazyFieldsMask`, both derived in `schema/tracks.ts` from the one `LAZY_TRACK_AUDIO_COLUMNS` list — the registry checks its own column set against that same list at load time and throws if they have drifted apart. `spectrogramKey` names a grayscale PNG (128 × columns, one column per 100 ms) under `STORAGE_DIR.analysis` (`static/analysis/`), written by `lib/spectrogram.ts`, served through `getStaticFileByKey`'s `analysis` branch (`db/queries/assets.ts`, gated on the owning track's project), and removed when a re-analysis replaces it or the owning row is deleted or cascaded away by a deleted asset, track or project — `spectrogramKeysForAsset`/`spectrogramKeysForTracksMatching` in `track-audios.ts` are what every one of those delete paths reads the key through before its own delete runs. `duplicateOfId` points at the lowest-numbered other current version whose fingerprint (below) reads a cosine similarity above 0.98 with a duration within 1 s, set by `analyseTrackAudio` after storing. |
| `trackAudioFeatures` | base, `trackAudioId` → trackAudios cascade (unique — one row per version), `onset`/`mel`/`chroma` `bytea` (quantised `u8`, `@workspace/dsp/offline`'s `QuantisedSeries`) each with its own `min`/`max` real, `analysisVersion` int | Stored exactly as `OfflineAnalyses.features` produces them, so a consecutive diff or a duplicate check (`FeatureSet` in `@workspace/dsp/offline`) reads them back with no re-decode. Upserted on `trackAudioId` in the same transaction as the `trackAudios` update. |
| `trackAudioDiffs` | base, `fromId`/`toId` → trackAudios cascade (both directions), `aligned` bool, `offsetMs` int (null when not aligned), `change` jsonb `number[]`, `loudnessDelta` jsonb `number[]`, `summary` jsonb `{changedSeconds,changedShare,loudestChange}`, `analysisVersion` int | unique `track_audio_diff_pair` on `(fromId, toId)`. One row per consecutive pair (`fromId` earlier, `toId` later): written after every analysis for the pair immediately behind the new version, and, when it would otherwise leave a gap (its own next current version has none yet), the pair ahead of it too — see `db/queries/track-audios.ts`'s `analyseTrackAudio`. Every delete of a version runs the same repair the other way through `closeVersionGaps`: deleting a version cascades its own diffs away, so before it resequences the rest it finds the deleted version's immediate current neighbours (by id, not by the version number that resequencing is about to rewrite) and stores the pair between them if one is not already there. `unlinkTrackAudio` runs it for one row; `deleteAsset` and `deleteAssetsWithin` (bulk delete and duplicate removal) run it for every row their asset delete cascades away, one diff per gap however many adjacent versions went. All of it runs under the per-track analysis lock (`pg_advisory_xact_lock`, keyed per `trackId`: `withTrackAnalysisLock`, or `lockTracksForAnalysis` inside an open transaction), so two versions of the same track analysed — or one analysed while another is deleted — at the same time cannot each read the other as not-yet-current and both miss a pair. Served by `GET /track-audios/:id/diff/:otherId`. |

**Primary pin (`track_audios.primary_pinned`).** A version's `primary_pinned` is set true when someone chooses it as primary (`PATCH /track-audios/:id/primary`, the MCP `set_primary_audio`, an explicit `primaryAssetId` on link, and a render accept's `POST /sessions/:id/renders` when it links through an explicit primary). A pinned primary is kept by a later link, and only an unpinned primary is replaced by the newest version a link adds. `setPrimaryWithin` clears the pin on the old primary and sets it on the new one only when asked (`pinned` argument), so the rest of the system's promotions (an unlink or a removal that heirs the primary) stay unpinned. The audit's `stale_primary` finding never fires on a pinned primary.

**Bounce (`track_audios.bounced_from_save_id`).** A render accepted from a session records the save it was bounced from, `→ saves` set null. The track audio read exposes it as `bouncedFrom` (`{saveId, sessionId, savedAt, commit}`): the commit on that exact save when one exists, else the first commit in the same session whose save was written at or after it, else `commit: null`. `bouncedFrom` is null when no save is recorded. Share guests get neither `primaryPinned` nor `bouncedFromSaveId`.

### Sessions (`schema/sessions.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `sessions` | base, `name`, `daw` text NOT NULL (the scanner module's id — `"ableton"`, `"reaper"` — or `"manual"` for a session added by hand; validated `/^[a-z0-9][a-z0-9-]{0,31}$/`, not a Postgres enum, so a new DAW module needs no migration), `dawName` text (the module's display name, 1–64 chars when set), `dawCapabilities` text[] NOT NULL default `{}` (what the module can report, from the known-capability list in `schema/sessions.ts`; an unrecognised value is dropped on write, not refused), `priorityId` → priority_levels restrict NOT NULL (see **Priority levels**; the scanner's bulk upsert gives a new session the project's default and leaves a rescanned one's level alone), `main` bool default false, `trackId` → tracks set-null, `projectId` → projects cascade NOT NULL, `localFilepath`/`localFileCreatedAt`/`localFileUpdatedAt`/`localFileMachineName`/`fingerprint`, `notes` jsonb + generated `notesText`, `tempo` numeric, `timeSignature`/`rootNote`/`scale` varchar, `tracksCount`/`scenesCount` int, `dawVersion`, `structure` jsonb `SessionStructure` (a session's sample paths are `session_samples` rows, not a column), `repoId` → repos set-null, `ditSetId` text, `currentBranchId` → branches set-null (all three nullable, null on a session the scanner found; see **Repos and objects**) | unique `session_repo_dit_set` on `(repoId, ditSetId)` (nulls never collide); partial unique index `one_main` on `(main, trackId) WHERE main = true AND track_id IS NOT NULL` (unlinked mains may coexist — the scanner's bulk create inserts mains before linking); partial unique index `dedupe_filepaths` on `(projectId, localFilepath) WHERE local_filepath IS NOT NULL` (scoped to project — two people scanning the same folder layout describe different sessions); gin trgm on `name`, `localFilepath`, `notesText`; btree `(projectId, fingerprint)`, `trackId`, `(projectId, updatedAt)`, `priorityId`. |

`rootNote` and `scale` are normalised on the wire, by `normaliseRootNote` / `normaliseScale` (also
`schema/sessions.ts`) wired as transforms on `sessionWireFields` — the one choke point every writer passes
through (create, PATCH, `bulk_update`, the MCP tools). A root note is stored as one of
`ROOT_NOTES` (`C C# D D# E F F# G G# A A# B`); a `♯`, a flat or any letter case is converted to that spelling, and
a string naming none of the twelve is a zod issue, so a 400. A scale is trimmed, `major`/`minor` are pinned to
`Major`/`Minor` whatever case they arrive in, every other mode (Live's `Dorian`, `Harmonic Minor`) is kept exactly
as written so a rescan sees no change, and a blank one is null.

`SessionStructure` (zod, also `schema/sessions.ts`): `{ tracks: {kind: SESSION_TRACK_KINDS, name, devices, id?, groupId?, color?}[], clips?: {audio, midi}, scenes?: number, plugins?: Record<deviceName, {host, manufacturer?}>, truncated?: boolean }`. `SESSION_TRACK_KINDS` is `audio | midi | return | group | master | other`; a kind a track's `.catch("other")` doesn't recognise is kept as `"other"` rather than refused, so an unfamiliar DAW's structure still stores. `color` (`trackColorSchema`) is the track's colour in the DAW as `#rrggbb`; anything else is dropped by `.catch(undefined)`, costing the swatch rather than the save. A plugin's `host` (`pluginHostSchema`) is any lowercase format id (`/^[a-z0-9][a-z0-9-]{0,15}$/`: `vst3`, `vst`, `au`, `clap`, `aax`, `lv2`…), refused when malformed. `clips` and `scenes` are optional — a DAW without a clip-launcher concept, or one that cannot count scenes, reports neither. `plugins` only carries third-party devices — a device absent from the map is one of the DAW's own (`origin: "builtin"` in the plugin inventory), and the scanner only writes the key when a set actually has a third-party plugin. `epochDate` (also here) is the wire type for the two `localFile*At` timestamps: input is epoch milliseconds (`z.preprocess` to `Date`), output stays a date-time string — a plain `z.date()` would reject the JSON number/string a request actually sends.

### Statuses, labels, saved views (`schema/statuses.ts`, `labels.ts`, `saved-views.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `statuses` | base, `name` varchar(255), `percentage` int default 0, `description`, `colourHex` varchar(9) default `#8A8A8A`, `projectId` → projects cascade (nullable = global; the three seeded globals are `To Do` `#8A8A8A`, `In Progress` `#4A7FD4`, `Complete` `#4CAF7A`) | partial unique `statuses_project_name` on `(projectId, name) WHERE project_id IS NOT NULL`; partial unique `statuses_global_name` on `(name) WHERE project_id IS NULL` (Postgres treats NULL project ids as distinct, so seeded/global statuses need their own uniqueness index). |
| `labels` | base, `name` varchar(255), `colourHex` varchar(9) default `#94A3B8`, `projectId` → projects cascade NOT NULL | unique index `labels_project_name` on `(projectId, name)`. Free-form multi-select tag vocabulary, one set per project. |
| `entityLabels` | `labelId` → labels cascade, `entityType` `label_target_type`, `entityId` (no FK — polymorphic) | composite PK `(labelId, entityType, entityId)`; index `entity_labels_entity` on `(entityType, entityId)`. |
| `savedViews` | base, `projectId` → projects cascade NOT NULL, `ownerId` text → users cascade NOT NULL, `shared` boolean NOT NULL default false, `name` varchar(255), `kind` `saved_view_kind`, `config` jsonb `{query: string}` | unique index `saved_views_project_kind_owner_name` on `(projectId, kind, ownerId, name)`, so two members may each keep a view of the same name. A view is private to its owner until `shared`. The owner FK is to the user, not the membership: a member who leaves keeps their views. `config.query` is the table's URL query string; the client owns its shape. |

### Priority levels (`schema/priority-levels.ts`, `db/queries/priority-levels.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `priorityLevels` (`priority_levels`) | base, `projectId` → projects cascade NOT NULL, `name` text, `colour` text, `rank` int, `isDefault` bool NOT NULL default false | unique `priority_levels_project_name` on `(projectId, name)`; unique `priority_levels_project_rank` on `(projectId, rank)` (not deferrable, so a reorder clears first); partial unique `priority_levels_project_default` on `(projectId) WHERE is_default = true`. |

- **A project's own scale, never empty.** `tracks.priorityId`, `collections.priorityId` and `sessions.priorityId` are
  `NOT NULL` → `priority_levels` `ON DELETE RESTRICT`, and every row points at a level of its own project. A level
  cannot fall back through `SET DEFAULT` the way a status does (a column default is a constant, a level is per
  project), so a level only goes by naming the level its rows move to. Deleting a project still works: the
  cascade deletes the rows and the levels in one statement, and `RESTRICT` is checked after both.
- **Seeding.** `createProject` (`entities/project/queries.ts`) calls `seedPriorityLevels(tx, projectId)` inside its
  transaction: `DEFAULT_PRIORITY_LEVELS` is None (the default, rank 0), Low, Medium, High, Urgent, on a five-step
  ramp (PROJ-1273) from neutral grey through blue, gold and orange to red (`#6C7278`, `#0891C9`, `#D6B529`,
  `#F06B00`, `#D0183A`), each legible as the `StatusChip` 18%-fill/35%-border tint on both themes. The migration
  `20260926204628_priority-levels-backfill` first seeded every existing project in the old badge's greys
  (`#525252`, `#898989`, `#525252`, `#020202`, `#020202`) and pointed every row at its project's level of the old
  enum value's name; the enum (`priority`) is gone. `20260927223610_priority-levels-recolour` then carried every
  level still holding both its seeded name and its seeded old colour, at its seeded rank, on to the new ramp;
  a level a user had renamed or recoloured was left alone (name or colour edited, matched on both together since
  two of the old colours repeat).
- **The default.** `defaultLevelId(projectId, exec?)` is the one place a missing level becomes the default;
  `withDefaultLevel(values, exec?)` fills a create's `priorityId` from it. Every create path goes through one of
  them: `createTrack`, `createCollection` and `createSession`. `DefaultableLevel<T>` is an insert
  type whose `priorityId` may be left out. A test inserting a project straight into `projects` gives it a scale with
  `seedScale` (`src/test/priority.ts`).
- **Writes naming a level.** `assertLevelsInProject(ids, projectId)` refuses a level of another project (or none)
  with a **400**, not the 404 other foreign ids get (`assertInProject(..., 400)`); every entity's `assertWritable`
  (create, `PATCH /:id`, bulk patch, MCP writes) call it.
- **Scale writes** (`createPriorityLevel`, `updatePriorityLevel`, `reorderPriorityLevels`, `deletePriorityLevel`)
  each run in one transaction that first locks every level of the project `FOR UPDATE` (`lockScale`), so two writes
  to one scale queue. Create appends at `max(rank) + 1`; a taken name is a 409 (`onConflictDoNothing` on create, the
  unique violation on rename). `isDefault: true` clears the old default before setting the new one. A reorder moves
  every rank to its level's negated id, then writes `0..n-1` in one `UPDATE ... FROM (VALUES ...)`; ranks can have
  gaps after a delete. A delete refuses the default, the level itself and a replacement outside the project (all
  400), repoints the three tables in plain SQL (`updated_at` untouched: the scale changed, not the rows), then
  deletes the level. Create, update and delete record a project activity row with `{ priority: <name> }` (plus
  `colour`/`isDefault` on an update), as statuses and labels do.
- **Reads.** `getPriorityLevels(projectId)` is the scale in rank order, each level with `counts` of the tracks,
  collections and sessions holding it (`scaleEntrySchema`). A row carries its level as `priorityLevelSchema`
  (`{ id, name, colour, rank }`, the OpenAPI component `PriorityLevel`) through the `priority` relation
  (`priorityLevelColumns`); the scale routes answer `scaleLevelSchema` (`+ isDefault`). `levelByName(projectId,
  name)` is the MCP tools' lookup.
- **Listings.** `sort=priority` orders by `priority_levels.rank` (each entity's `priorityJoin`), `groupBy=priority`
  keys groups by level id and orders them by rank, labelled by name (only levels with rows appear, as for
  statuses), and `priority=<id>,<id>` (`idListParamSchema` in each listing's `entities/<kind>/filters.ts`, from
  `entities/filters.ts`, + `membershipFilterSql`, `pagination.ts`) filters by membership; a `priority` facet counts rows per level under every other filter. An `all: true` bulk selection
  carries the same comma-separated list (`selectionIds`).
- **Moves.** `remapPriorities` (`move.ts`) repoints every moved track, collection and session at the target's level
  of the same name, else the target's default, and reports each name that fell back.

### Relation types (`schema/track-relation-types.ts`, `db/queries/track-relation-types.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `trackRelationTypes` (`track_relation_types`) | base, `projectId` → projects cascade NOT NULL, `name` text, `rank` int | unique `track_relation_types_project_name` on `(projectId, name)`. The ordered list of nouns a track relation is one of ("remix", "live version"), each completing "this track is a … of" another; see **Tracks** for `trackRelations.relationTypeId`, which restricts the type's own delete while any relation carries it. |

- **Seeding.** `seedRelationTypes` gives a new project `DEFAULT_RELATION_TYPES`, the eight kinds a relation
  starts as (remix, remaster, rework, edit, live version, cover, instrumental, acoustic), inside the
  transaction that creates the project.
- **Writes.** `createRelationType`/`renameRelationType` are a 409 on a name the project's list already has
  (`onConflictDoNothing` on create, the unique violation on rename); create appends at `max(rank) + 1`.
  `reorderRelationTypes` takes every id once. `deleteRelationType` is a 409 (`relation_type_in_use`,
  `details.inUse`) while any relation still carries the type.
- **Reads.** `getRelationTypes(projectId)` is the list in rank order, each type with `inUse` (the count of
  relations carrying it, `relationTypeEntrySchema`).
- **Project delete.** `deleteProject` deletes through `deleteProjectRow(tx, projectId)`
  (`entities/project/queries.ts`), which deletes the project's tracks in a statement of their own before the
  project row. The cascades from `projects` fire in trigger-name order, which follows constraint OIDs compared
  as strings, so on a database old enough that `tracks`' key has fewer OID digits than the types table's, the
  types would go before the relations and the RESTRICT key would refuse the delete. Changing the key to `NO
  ACTION` does not help: the cascade's inner delete checks it when that inner statement ends, before the
  tracks' cascade runs. A test deleting a project row must go through `deleteProjectRow` too
  (`move.test.ts`); `entities/project/delete-order.test.ts` forces the unfavourable order by re-creating
  `tracks`' key to `projects` inside a rolled-back transaction, and runs serially.
- **Moves.** `ensureRelationType(exec, projectId, name)` looks a project's type up by name, appending one
  after the last if it has none yet — what `move.ts` repoints a kept relation's type through when the target
  project lacks the source's type by name.

### Comments & activity (`schema/comments.ts`, `activity.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `comments` | base, `targetType` `comment_target_type`, `targetId` int, `projectId` → projects cascade NOT NULL, `userId` → users cascade (nullable), `content`, `parentId` (self-FK via `foreignKey()` in the extra-config callback — declared without `.references()` to dodge circular TS inference), `positionMs`, `resolvedAt` timestamp (null is open), `resolvedBy` → users set-null (both omitted from `newCommentSchema`/`editCommentSchema`; only the resolve routes write them) | index `(targetType, targetId)`, `projectId`, `parentId`, `userId`; gin trgm on `content`. `projectId` is denormalised (filled server-side from the authorized project, never client-set) so search can filter on it without joining every possible target type. |
| `activity` | `id`, `createdAt` (no `updatedAt` — append-only, immutable), `projectId` → projects cascade (nullable), `entityType` `activity_target_type`, `entityId` (**no FK** — a row must outlive the entity it describes so a `deleted` action stays readable), `userId` → users set-null, `action` `activity_action`, `changes` jsonb `{field: {from,to}}` (populated for `updated` only), `commentId` → comments cascade | index `(entityType, entityId)`, `(projectId, createdAt)`, `commentId`. Kept forever unless the instance policy sets `activityRetentionDays`; then `sweepRetention` (`db/queries/retention.ts`) deletes rows whose `createdAt` is older, in batches of 1000 walking `id` upward, daily and at once when the retention changes. |

### Assets, images, attachments (`schema/assets.ts`, `images.ts`, `attachments.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `assets` | base, `name`, `type`, `size` int, `assetPath` (unique — one file, one asset), `createdByUser` → users set-null (an asset outlives its uploader's account and stays in its project), `projectId` → projects cascade NOT NULL, `localFilepath`/`localFileCreatedAt`/`localFileUpdatedAt`/`localFileMachineName`/`fingerprint` | gin trgm on `name`; btree `(projectId, fingerprint)`; unique index `assets_path`; index `createdByUser`. |
| `images` | base, `name`, `type`, `size`, `assetPath` (`image_path`, unique, `images/<uuid>.<ext>`), `createdByUser` → users set-null, `projectId` → projects cascade (nullable), `scope` `image_scope` default `project`, `accentHue`/`accentChroma`/`accentHex` (palette extracted at upload), `variantsReady` bool NOT NULL default false, `variantBytes` int NOT NULL default 0 | index `createdByUser`, `projectId`; **check constraint `images_scope_owner`**: `scope='project' → projectId NOT NULL` OR `scope='user' → createdByUser NOT NULL` OR `scope='instance' → projectId NULL` — the one table where a null project is legitimate (an avatar belongs to its uploader, an instance image — the branding's logo and icon, uploaded by an admin through `POST /images/instance` and readable by anyone at `/static/*` — to the instance), and the check ensures every row still names *an* owner consistent with its scope. The instance clause compares `scope::text`, because the migrator applies pending migrations in one transaction and Postgres refuses an enum value used as a literal in the transaction that added it. An instance image counts towards its uploader's storage, as an avatar does, and survives the uploader's deletion (`createdByUser` set null). `variantsReady` is set by the `image_variants` job once every width in `VARIANT_WIDTHS` is on disk, and is what `findOutstandingImageVariants` reads — a boot no longer stats four files per image. `variantBytes` is the total those resizes take, so a project's storage counter can be re-derived from rows alone; `ensureVariant` adds to it whenever it writes one on demand. |
| `sessionAttachments` | base, `sessionId` → sessions cascade, `assetId` → assets cascade | unique `session_asset`; index on `assetId`. |
| `trackAttachments` | `baseTimestamps` only (no `id`), `trackId` → tracks cascade, `assetId` → assets cascade | composite PK `(trackId, assetId)`. |
| `collectionAttachments` | base, `collectionId` → collections cascade, `assetId` → assets cascade | unique `collection_asset`; index on both columns. |
| `projectAttachments` | base, `projectId` → projects cascade, `assetId` → assets cascade | unique `project_asset`; index on both columns. |

### Jobs (`schema/jobs.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `jobs` | base, `projectId` → projects cascade (nullable), `kind` `job_kind`, `status` `job_status` default `queued`, `subjectId` int (meaning depends on `kind`: an asset for `convert`, a track audio for `audio_analysis`, a project for `audio_backfill`, an image for `image_variants`), `percent` real NOT NULL default 0 (overall 0..100, derived by `overallPercent`), `steps` jsonb `JobStep[]` NOT NULL default `[]` (the kind's ladder `{key, label, weight}`, copied on claim), `stepIndex` int (null until claimed), `stepPercent` real (0..100 within the step, null until claimed), `queuePosition` int (1-based place in the process-wide queue, null unless waiting in it), `cancelRequested` bool NOT NULL default false, `result` jsonb, `error`, `attempts` int default 0, `createdBy` → users set-null, `startedAt`, `finishedAt` | index `(projectId, status)`; index `jobs_finished_at` `(projectId, finishedAt)` for the recently-finished read. Rows outlive the request that queued them so a client can follow them, and a restart can resume interrupted work. `result` holds both the parameters queued with and whatever the job produced, so a finished job can be matched against a repeat request. The kind's display name and the subject's name are not columns: `describeJobs` derives `label` and `subjectLabel` on every read. `projectId` is null on an instance-wide job (`storage_audit`, `save_content_sweep`), which is deliberately unreachable through the project-scoped job routes and never published to a project's event stream. |

### Storage accounting (`schema/storage-usage.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `storageUsage` | `scopeKind` `storage_scope`, `scopeId` text, `bytes` bigint NOT NULL default 0, `updatedAt` | composite PK `(scopeKind, scopeId)`; no `id` and no foreign key — a project scope is keyed by its integer id as text, a user scope by Better Auth's string id, so one column cannot reference both. A cache of `sum(size)`, never the source of truth: `db/queries/storage-usage.ts` moves it in the same transaction as the row that owns the bytes, and the nightly `storage_audit` job re-derives every scope, logs the drift and prunes rows whose scope is gone. A project counts its assets, its images and their variants, its conversions, its spectrograms and the repo objects its repos hold (`sum(objects.size)` over the objects whose earliest `repo_objects` row sits in one of the project's repos); a user counts everything they uploaded, their avatars and the repo objects they pushed (the objects whose earliest `repo_objects` row has `pushed_by` = them). **First pusher pays, for every repo object:** the payer of an object is the scope of its earliest `repo_objects` row by `(pushed_at, repo_id)` (unique per hash, so exactly one row is earliest; the `repo_object_hash` index is `(object_hash, pushed_at, repo_id)` and the "no earlier row" probe reads it), so an object counts once on the instance, and a project or user who links it later pays nothing and never trips a cap for it. A file counted by both a project and a user is one file seen twice, which is what the two scopes are for. `objects.size` is the stored frame's length, the bytes on disk: only the push that creates the row writes the file, under the object's lock, and every link counts the committed row's size. Never negative — a subtraction clamps at zero. |

`sweepSaveContent` (`db/queries/save-retention.ts`) re-derives, through `recomputeUsage`, every project and user scope whose `repo_objects` link it removed, and (`holdersOf`) the projects and pushers that hold another link of those hashes, since one of them pays now.

**The charge moves, and the cap is not asked.** When the paying link goes (the paying project is deleted, or retention unlinks it) the object's charge moves to the project and pusher of the earliest remaining link; `releasingProjectUsage` reads those successors before its delete, `unlinkRepoObjects` after each batch. A move is not checked against the receiving cap: a project can end above its cap through no push of its own, and the next upload is what the cap refuses. The audit re-derives the same sums.

### Notes (`schema/notes.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `notes` | base, `authorId` → users cascade NOT NULL, `trackId` → tracks set-null, **`.unique()`** (one-to-one; Postgres allows many NULLs, so unlinked notes coexist), `lyricsMode` bool default true, `pinned` bool default false, `version` int default 1 (optimistic-concurrency counter — an `updatedAt` precondition doesn't work here since `now()` carries microsecond precision a JSON round trip can't preserve), `keyScope` text `.$type<KeyScope>()` (the only `src/db` → `src/lib` type dependency in the schema folder, from `src/lib/notes-crypto.ts`), `keyVersion` smallint default 1, `wrappedKey`/`body`/`summary` `bytea` (sealed AES-GCM; `body` is the block array, `summary` is `{title, preview}` so a list never opens a body) | index `(authorId, updatedAt)`. `noteSchema` (wire-facing) omits `wrappedKey`, `body`, `summary`, `keyScope`, `keyVersion` — no ciphertext or key metadata ever leaves the server through it. |

**Master key rotation:** `unwrap`/`rewrap` (`src/lib/notes-crypto.ts`) take a `MasterKeys = { current, previous, version }`
instead of a single key, and `newEnvelope(keys, scope)` does too; `version` is `NOTES_KEY_VERSION` (default 1,
parsed in `env.ts`, which is why `notes-crypto.ts` stays free of `process.env`). A row's own `keyVersion` picks which
key derives its scope key, and a version other than `keys.version` with no `NOTES_MASTER_KEY_PREVIOUS` configured
throws naming that variable. Content (`body`/`summary`) is never re-encrypted by a rotation — only `wrappedKey`.
`src/db/queries/notes-key-rotation.ts` owns the mechanics: `rotateNotesKeyBatch(limit, keys)` re-wraps up to `limit`
rows still below `keys.version` in one transaction with `FOR UPDATE SKIP LOCKED`, so an interrupted run leaves
nothing partially committed and a re-run never re-selects an already-rotated row — that is what makes it resumable
and safe to run concurrently. `scripts/rotate-notes-key.ts` (bundled into the image at `dist/scripts/`) loops it at
the default batch size (500) until it returns 0, then logs the remaining count from
`countNotesOnPreviousKeyVersion`. `assertNotesKeyOpensCurrentVersion` runs in `server.ts` before `Bun.serve`: it
throws when any note sits on a version above `keys.version` (`NOTES_KEY_VERSION` went backwards, usually dropped from
`.env`); throws when `keys.previous` is null and `countNotesOnPreviousKeyVersion` is above 0 (a rotation abandoned
halfway, or `NOTES_MASTER_KEY_PREVIOUS` removed too early), naming the count and the fix (put the old key back, finish
with the rotate script) — with a previous key set those notes are a rotation in progress and the boot proceeds; and
otherwise unwraps one note already on `keys.version` and throws, saying what to do, when
`NOTES_MASTER_KEY` cannot open it, so a changed key stops the boot instead of failing note by note; with no note on
the current version it passes. `server.ts` catches the rejection and exits 1 itself, since its `uncaughtException`
listener would otherwise swallow it and leave the process idling to a 0 exit. To
rotate: set `NOTES_MASTER_KEY` to the new key, `NOTES_MASTER_KEY_PREVIOUS` to the old one, raise `NOTES_KEY_VERSION`
by one, restart, run the script (`docker compose exec api bun dist/scripts/rotate-notes-key.js`), then unset
`NOTES_MASTER_KEY_PREVIOUS` once it reports 0 remaining; `NOTES_KEY_VERSION` stays at its new value.

### Saves (`schema/saves.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `saves` | base, `sessionId` → sessions cascade NOT NULL, `projectId` → projects cascade NOT NULL (denormalised for the project heatmap; a session move rewrites this alongside the session), `fileUpdatedAt` timestamp NOT NULL (the file's own mtime, or the timestamp in a backup's name — the one value monotonic with the edit), `fingerprint`, `machineName`, `machineId` → machines set-null (the machine that pushed a dit save, when the save's `machineName` is that machine's name; null for a scanner save and for a row that names another machine), `source` `save_source` (`dit` is only ever written by the hub's routes; the scanner's write body takes `scan` or `backup`), `hash` text (the save's dit object id, hex), `xmlHash` text (the hash of its XML), `tree` and `side` text (the object ids it rebuilds from); all four null on a save the scanner recorded, `viewOnly` boolean NOT NULL default false, `unreadable` boolean NOT NULL default false, `contentState` `content_state` NOT NULL default `none` (`none`: metadata only; `stored`: content held; `pruned`: content dropped by retention, row kept), `branchId` → branches set-null (the dit branch the save was committed on; null for a scanner save), `meta` jsonb `SaveMeta` (a `Pick<Session, "tempo" \| "timeSignature" \| "rootNote" \| "scale" \| "tracksCount" \| "scenesCount" \| "dawVersion" \| "structure">` plus `samplePaths: string[] \| null`, restated in the type and in `saveMetaSchema`; a save built from a session takes `samplePaths` from that session's `session_samples` rows, in position order, not from the column) | unique index `save_session_time` on `(sessionId, fileUpdatedAt)`; index `save_project_time` on `(projectId, fileUpdatedAt)`; index `save_branch`, `save_machine` on `branchId`; unique partial index `save_session_hash` on `(sessionId, hash)` where `hash` is not null. Its primary key and foreign keys are named `session_revisions_*` (drizzle-kit's table rename does not rename them, and the snapshot records them so); the identity sequence is `saves_id_seq` (custom migration `saves-sequence`). A save is never deleted by retention; `sweepSaveContent` (`db/queries/save-retention.ts`) drops its content instead, in three steps. **Prune:** a `stored` save whose `fileUpdatedAt` is older than `saveContentRetentionDays` and that no `commits` row names as its `saveId` (only a commit's own save keeps its content for good) loses its `save_objects` rows and becomes `pruned`; a later commit that carries it stores it again. **Unlink:** per repo, a `repo_objects` row older than a one-day grace (`PUSH_GRACE_MS`, so a pack whose commit has not landed is not reaped mid-push) that no save in a session of that repo references is deleted, so each repo pays only for what its own saves use; the repo's project and the row's `pushedBy` are collected as scopes, and `recomputeUsage` re-derives them before the reap, so a failed reap leaves no counter overstated. **Reap:** an `objects` row with no `repo_objects` and no `save_objects` row is deleted under `select … for update` with the check repeated, and its file removed after the commit. Every step runs in bounded batches walking its key upward; the unlink and the reap read theirs as one primary-key range per statement, so each statement reads each row once at most when the statistics are stale (`save-retention.ts` below). |

A save dit could not read carries `raw`, the hash of the file's bytes: its only object, listed among its commit's `objects` and linked in `save_objects` like a tree or side. Such a save has `xmlHash`, `tree` and `side` all null. `raw` is set on the upsert while the save is not yet `stored` and kept once it is. A set download of the save, and the archive's set entry, serve those bytes unchanged (gzipped like any set), since they are the file itself. The `raw` column is migration `20261021040604_cultured_yellow_claw`.

A `backup` save the scanner recorded is named by the moment Live replaced its `Backup/` copy, not by the copy's own file time, so dit's save of that copy never lands on its millisecond to claim it. `recordSaves` deletes such a row (null `hash`, source `backup`) when the row just before it in the session is a save that arrived in the same push with content; one with another row between stays, and a push that brings nothing new deletes nothing. The sessions' DAW columns (`tempo`, `timeSignature`, `rootNote`, `scale`, `tracksCount`, `scenesCount`, `dawVersion`, `structure`) are written from the newest save's `meta` by the same function, which makes `sessions.structure` (and so the plugin inventory) follow the file once the scanner is gone; migration `20261022003438_session_facts_from_saves` applied it once to every session whose newest save has a `meta`. Both rules are in `server-api.md`, "Saves write".

The wire schemas `saveSchema`, `saveMetaSchema` and `newSessionRevisionSchema` live in `schema/save-schemas.ts`, not
beside the table: they read `sessionSchema` while the module loads, and `saves` sits in an import cycle with
`sessions` and `repos` that only lazy column references (`(): AnyPgColumn => …`) survive. A schema module in that
cycle reads nothing from another at load time.

### Repos and objects (`schema/repos.ts`, `schema/objects.ts`)

A dit repo is the history of one Live project folder, held by a project. A set in it is a session, and a session's
branches are its lineage.

| Table | Key columns | Notes |
| --- | --- | --- |
| `repos` | base, `projectId` → projects cascade NOT NULL, `name` text NOT NULL, `createdBy` → users set-null, `lastPushAt` timestamp, `lastPushMachineId` → machines set-null (the machine of the last push, set when the pushed `machineName` is that machine's name, else null), `pushSamples` boolean NOT NULL default false (whether dit pushes the repo's sample objects; `instance-limits.pushSamplesEverywhere` forces it on in the read without rewriting the column) | unique `repo_project_name` on `(projectId, name)`. |
| `branches` | base, `sessionId` → sessions cascade NOT NULL, `name` text NOT NULL, `headCommitId` → commits set-null | unique `branch_session_name` on `(sessionId, name)`. |
| `commits` | base, `repoId` → repos cascade NOT NULL, `sessionId` → sessions cascade NOT NULL, `branchId` → branches cascade NOT NULL, `hash` text NOT NULL, `saveId` → saves **no action** NOT NULL, `parentId` → commits set-null (history is linear), `message` text NOT NULL, `authorId` → users set-null, `machineName` text, `machineId` → machines set-null (as on `saves`), `kind` `commit_kind` NOT NULL, `committedAt` timestamp NOT NULL | unique `commit_repo_hash` on `(repoId, hash)`; indexes `commit_session_time` on `(sessionId, committedAt)`, `commit_branch`, `commit_save`, `commit_parent`, `commit_machine`. |
| `objects` | `hash` text PK, `kind` smallint NOT NULL, `size` bigint (`mode: "number"`) NOT NULL — the bytes of the stored file | none. |
| `saveObjects` | `saveId` → saves cascade, `objectHash` → objects **restrict** | composite PK `(saveId, objectHash)`; index `save_object_hash` on `objectHash`. |
| `saveSampleObjects` | `saveId` → saves cascade, `objectHash` → objects **restrict** | composite PK `(saveId, objectHash)`; index `save_sample_object_hash` on `objectHash`. The sample objects a **commit's own save** references and the repo holds (a Chunked sample's chunks too). Kept apart from `saveObjects`, which `saveFile` reads whole: a 100 MB sample must never join a set rebuild. Only the commit's own save is linked, which bounds the rows. |
| `timeSegments` (`time_segments`) | base, `sessionId` → sessions cascade NOT NULL, `branchId` → branches cascade NOT NULL, `machineName` text NOT NULL, `machineId` → machines set-null (as on `saves`), `startedAt` and `endedAt` timestamp NOT NULL, `source` `segment_source` NOT NULL | unique `time_segment_key` on `(sessionId, branchId, machineName, machineId, startedAt)` NULLS NOT DISTINCT (an unattributed span is one row per name and start); index `time_segment_branch` on `(branchId, startedAt)`; check `time_segment_order` (`endedAt >= startedAt`). The spans of time a set was open on a machine, pushed by `POST /repos/:id/segments`. The upsert on the key keeps the later `endedAt`, so a re-push extends a span and never shrinks it. `db/queries/segments.ts` holds the writer and the totals (`timeInSetCoveredBy` for a commit's window, `sessionTimeInSet` for a session). |
| `repoObjects` | `repoId` → repos cascade, `objectHash` → objects **restrict**, `pushedBy` → users set-null, `pushedAt` timestamp NOT NULL default now | composite PK `(repoId, objectHash)`; index `repo_object_hash` on `(objectHash, pushedAt, repoId)`. |

`db/queries/repos.ts` holds the repo queries (ids in, rows out): `projectIdForRepo`, `createOrGetRepo`, `listRepos`,
`listReposForTrack`/`listReposForCollection` (repos with a set on the track, or on a track of the collection), `getRepo` (each repo carries its `sets`: per set the `(ditSetId, sessionId)` pair, the session's name and its branches with their head commit, read for every repo of the page in one sessions → branches → commits left join) and
`setPushSamples` (the repo's own push-samples switch) and `adoptSet`, which links or creates the session for a set; the routes and adoption rules are in `server-api.md`,
**Repos (dit hub)**. `repoSchema` (`createSelectSchema(repos)`) sits beside the table.

Objects are referenced, never owned: nothing cascades into `objects`, and the three link tables restrict their delete,
so an object nothing references is one with no `save_objects`, `save_sample_objects` or `repo_objects` row, which is what the retention sweep
and accounting look for, and one still referenced cannot be deleted (SQLSTATE `23001`).

A commit's save is `NO ACTION`, not `RESTRICT`: a save a commit names is history and cannot be deleted directly, but
deleting a session or project cascades to its saves and commits in one statement, and `NO ACTION` is checked at the
statement's end, so that cascade succeeds whatever order it visits them in. Deleting a repo removes its commits and
`repo_objects` rows and clears the `repoId` of its sessions, leaving their saves and `ditSetId`. A session delete
takes its branches, commits, `save_objects` and `save_sample_objects` with it.

`branches.headCommitId` and `commits.branchId`, `sessions.currentBranchId` and `branches.sessionId`, and
`sessions.repoId` and `repos` reference each other across `schema/sessions.ts`, `repos.ts` and `saves.ts`; the
reference that closes each cycle is lazy.

### Session samples (`schema/session-samples.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `sessionSamples` | base, `sessionId` → sessions cascade NOT NULL, `projectId` → projects cascade NOT NULL (denormalised for the project-wide "which sets share this path" query; a session move rewrites this alongside the session), `path` text NOT NULL, `kind` `sample_kind`, `status` `sample_status`, `position` integer NOT NULL (the file's order) | unique index `session_sample_path` on `(sessionId, path)`; index `session_sample_project_path` on `(projectId, path)`. |

The value lists `SAMPLE_KINDS` (`project`, `outside`, `library`) and `SAMPLE_STATUSES` (`present`, `missing`,
`unknown`) live in `schema/samples.ts`, which the table file builds its `pgEnum`s from, and are mirrored into
`packages/api/src/enums.ts` by `generate-api.ts`. `samples.ts` also holds `sessionSampleSchema`, the wire shape
`{ path, kind, status }` (`SessionSample`), and `MAX_SAMPLES`; it is a leaf so `schema/sessions.ts` can import the
shape without a cycle through the table file, which imports `sessions`.

**Sample references from dit.** `saves.meta.samples` (jsonb, `SampleRef[]`: `{path, kind, relative?, object, size}`;
`sampleRefSchema` in `schema/samples.ts`, `object` and `size` null until dit has read the file) holds what a save
references, deduplicated by path. It is written with the save by `recordSaves` (`withSamples`; a save from a dit that
omits `samples` keeps the references already stored; a row the scanner recorded keeps its own meta and takes the
references), and survives a prune like the chips. A reference is never a foreign key to `objects`: "not pushed" is an
object the hub lacks. `recordSaves` also makes `session_samples` the newest save's references (`mirrorSamples`: only
when the newest save of the session is among those just pushed with references, so an older save pushed late puts
nothing back; an `object` is `present`, none is `unknown`), which is what the Samples section and the project's sample
pages read for dit sets. The session detail's `samples[]` adds `held`, true when the newest save's reference names an
object the session's repo has a `repo_objects` row for (`heldSampleObjects`).

`recordCommits` takes `sampleObjects` (the leaf ids of the commit's own save) and links, in `save_sample_objects`, those that the save's own `meta.samples` names and
the repo holds, with the chunks of every Chunked one (`withChunks`, read from the stored file); the commit is whole
without them, so one not held yet is left unlinked and a **replay** of the same commit (a commit the repo already has,
pushed again by dit's sample phase) links whatever has landed since. The commit row's `samplesReferenced` is every
reference its own save carries, whatever its kind, and `samplesHeld` those of them whose object is linked.

`repoStorage(repoId)` splits what a repo holds: `sampleBytes` is the objects `save_sample_objects` lists for saves of its
sessions, `setBytes` every other object it holds, `sharedBytes` the part of `sampleBytes` whose earliest link by
`(pushed_at, repo_id)` is another repo's. `sharedRepoStorage` (the admin "Samples stored once" line) counts only
objects some `save_sample_objects` row lists.

### Sharelinks (`schema/sharelinks.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `sharelinks` | base, `token` unique, `expiresAt` timestamp default `'9999-12-31 23:59:59+00'` (node-postgres round-trips Postgres' `infinity` sentinel as a nonsense finite date, so "no expiry" is a concrete far-future timestamp instead), `entityType` `sharelink_entity`, `entityId`, `description`, `isCommentsPrivate`/`isDownloadsEnabled` bool default false, `shareType` `sharelink_type` (`snapshot` \| `connected`), `snapshotTitle`, `revokedAt` nullable timestamp (null is live) | index `sharelinks_token`. A `snapshot` link freezes track titles/covers/order at creation (via `sharelinkSnapshotTrackAudios`); a `connected` link always resolves the entity's current tracks live. A revoke is an update, never a delete: `revokeSharelink` stamps `revokedAt` where it is null and nothing clears it, so there is no undo and a second revoke leaves the first timestamp; the row and the comments written through it stay. `sharelinkSchema` omits `revokedAt` and `buildSharelinkResponse` strips it, so it appears in no response. `getSharelinkRow` (the guest gate) reads the unfiltered row and throws 410 `revoked` before 410 `expired`; `findSharelinkRow` (management) and `listSharelinks` treat a revoked row as absent. |
| `sharelinkSnapshotTrackAudios` | base, `trackAudioId` → track_audios cascade NOT NULL, `sharelinkId` → sharelinks cascade NOT NULL, `title`, `image`, `position` | composite PK `(sharelinkId, trackAudioId)`; unique `dedupe_sharelink_track_numbers` on `(sharelinkId, position)`; index on `trackAudioId`. |

### Machines (`schema/machines.ts`, `db/queries/machines.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `machines` | `id` text PK (the client's generated id, `deviceIdSchema` in `schema/machines.ts`: 16-64 of `A-Za-z0-9_-`), `userId` → users cascade NOT NULL, `name` varchar(64) NOT NULL, `platform`, `appVersion`, `lastSeenAt` NOT NULL, `openSessionId` → sessions set-null (nullable), `repoIds` integer[] NOT NULL, `removedAt` timestamp (set by a removal), `authSessionId` → auth_sessions set-null (the sign-in of the machine's last beat, which a removal deletes), `baseTimestamps` | unique partial index `machines_user_name` on `(userId, name)` where `removedAt is null`, so a removed machine's name is free; indexes `machines_user`, `machines_open_session`. `online` is `lastSeenAt` within `MACHINE_OFFLINE_AFTER_MS` (90 s), applied on read only. `openSessionId` is kept only while the owner is a member of the session's project; a machine that goes offline keeps its row and its open session, which reads as none. |
| `renderRejections` (`render_rejections`, `schema/machine-rejections.ts`) | `id` identity, `userId` → users cascade NOT NULL, `kind` `render_rejection_kind` (`not-a-bounce` \| `never-here`) NOT NULL, `fingerprint` text, `fileName` text, `machineId` → machines cascade, `folder` text, `createdAt` | check `render_rejections_fields_by_kind` (a `not-a-bounce` row has a fingerprint and no machine or folder; a `never-here` row has a machine and a folder and no fingerprint or file name); partial unique `render_rejections_bounce` on `(userId, fingerprint)` where kind is `not-a-bounce` (a bounce is the user's, shared by every machine) and `render_rejections_folder` on `(machineId, folder)` where kind is `never-here`; index `render_rejections_user`. What the user told dit's render finder to leave alone, kept on the hub so it follows them across machines. The fingerprint is the render fingerprint (size and a hash of the first and last 64 KiB) and is stored, never interpreted. `removeMachine` deletes the machine's `never-here` rows in its transaction; a removed machine's rows are not listed. |

**Machine identity.** A machine is a row dit registers (`PUT /machines/:id`); `saves.machineId`, `commits.machineId`, `time_segments.machineId` and `repos.lastPushMachineId` name it. A push carries the machine's id in `X-Machine-Id` (`lib/push-machine.ts`, `pushingMachine` in `db/queries/machines.ts`): the hub attributes a pushed row only when the row's `machineName` equals that machine's name (`attributedTo`), else the column is null, since a push carries rows made elsewhere; a scanner save has none. Reads keep `machineName`, now the machine's current name where the row has an id (`withCurrentMachineNames`), so a renamed machine keeps its history under its new name, and add `machineId`. A removal is soft: `removeMachine` sets `removedAt`, empties `openSessionId` and `repoIds`, deletes the `authSessionId` row (a bearer request is then refused at once, since dit sends no cookie cache) and deletes the machine's never-here rows, and keeps every row that names it; every read of machines filters `removedAt is null` (`live`). Migration `machine_attribution` attributed the rows pushed before: commits by `(authorId = machines.userId, machineName = machines.name)`; saves through the first commit of their branch whose own save is at or after them, when that commit names the same machine; time segments through the commits of their session naming the same machine when all are one author's and one machine's; a repo's last push through its newest commit. Everything ambiguous stays null.

`recordMachineBeat` upserts on `id` with `setWhere` on `userId` and a live row, so a beat of another account's id updates nothing and answers 403, and a beat of the caller's own removed id answers 401 (`assertMachineAvailable` runs first so neither spends the caller's `device-heartbeat` allowance). A name taken by another live id of the same owner is caught by `isUniqueViolation(error, "machines_user_name")` and answers 409 `machine_name_taken`. `openOnFor(sessionId)` and `sessionPresence` read the same online and membership rules as the session detail's `openOn` and `GET /sessions/:id/presence`. `listMachines` adds to each row `openSession` (the same rule: online and a member of its project), `pushedRepos` (the distinct repos of the machine's commits and of its saves' sessions, only those of projects the caller is a member of, by name) and `neverHere`; `listAdminMachines` pages every user's live machines with their owner.

### Custom fields (`schema/custom-fields.ts`, `db/queries/custom-fields.ts`, `db/queries/custom-field-types.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `customFields` | base, `projectId` → projects cascade NOT NULL, `kind` text (column `entity_kind`; `CUSTOM_FIELD_KINDS`: `track` \| `collection`), `name` varchar(255), `type` text (`CUSTOM_FIELD_TYPES`: `text` \| `number` \| `date` \| `checkbox` \| `select` \| `url`), `options` jsonb `SelectOption[]` default `[]` (`{id, label, colour?}`, a select's only), `rank` int | unique `custom_fields_project_kind_name` on `(projectId, kind, name)`. `kind` and `type` are text plus zod, no Postgres enum (the `sessions.daw` precedent). A field's type never changes after creation. An option id is `^[A-Za-z0-9_-]{1,32}$` (it rides in a comma list and a column id); labels are unique within a field. |
| `customFieldValues` | `id` identity PK, `fieldId` → custom_fields cascade NOT NULL, `trackId` → tracks cascade, `collectionId` → collections cascade, one typed column per type: `textValue` text, `numberValue` numeric (`mode: "number"`), `dateValue` date (`mode: "string"`), `boolValue` boolean, `optionValue` text (the option id), `urlValue` text | check `custom_field_values_one_entity` (`num_nonnulls(track_id, collection_id) = 1`) and `custom_field_values_one_value` (exactly one typed column set). Unique `(trackId, fieldId)` and `(collectionId, fieldId)`, led by the entity so they also serve reading an entity's bag and the FK cascades; index `(fieldId, <typed column>)` for each of the six, what a sort, filter or facet on one field reads. Unset is the absence of a row, never a null column, so a checkbox has three states (true, false, unset). Real FKs, so deleting a field, track or collection takes its values without the polymorphic clean-up `entity_labels` needs. A value row names only a field of its entity's project and kind (enforced in code: writes resolve keys against the project, moves remap or delete). |

`CUSTOM_FIELD_OWNERS` binds each kind to its entity table and its value FK; everything that reads or writes
values for a kind goes through it. The six types are units in `FIELD_TYPES` (`custom-field-types.ts`), one
interface: `column`, `parse` (a write's value, checked and coerced), `read` (stored → API value), `filter`
(an encoded `cf_<id>` query value → predicate over `ValueRows.having`/`lacking`), `order`, optional `group`
(`order`/`label` over the joined column), `facets`, and `carry` (the stored value onto a same-named field of
another project, null when it cannot). No consumer switches on a type.

Queries (`custom-fields.ts`): `getCustomFields(projectId, kind?, executor?)` (definitions, kind then rank
order), `listCustomFields` (+ `valueCount`, one grouped count), `createCustomField` (rank = the kind's max + 1
in the insert; name clash 409 via `onConflictDoNothing`), `updateCustomField` (name and a select's options;
unique violation 409), `reorderCustomFields` (a permutation of one kind's fields, rank = index, one
transaction), `deleteCustomField`; `valuesFor(kind, ids, executor?)` → `Map<id, FieldBag>` (chunked by the
bind-param limit), `fieldBagOf(kind, id)`; `resolveFieldWrites(kind, projectId, bag)` (400 `unknown_field` /
`invalid_field_value` naming the field); `setValues(kind, projectId, ids, bag)` (one transaction: resolve, read
the current bags, upsert on `(<entity>, fieldId)` into the type's column or delete for `null`; answers each
entity's before/after for the written keys); `fieldListing(kind, projectId, params)` (the per-request
`FieldListing`: `sortKeys`, `groupKeys`, `order(key)`, `where(except?)`, `group(key)`, `facets(builtInWhere)`)
and `fieldFilterWhere` (a selection's field filters, reading no fields when no `cf_` key is present). The
`cf_` query grammar, the `fields` bag and the move remap are in `server-api.md`, "Custom fields".

## Relations (`src/db/relations.ts`)

`defineRelations(tables, ...)` (drizzle-orm 1.0's relational API, not the legacy `relations()` helper). Notable
shapes: `tracks.sessions` (one-to-many via `trackId`), `tracks.audios`/`primaryAudio` (the latter filtered
`where: { isPrimary: true }`), `tracks.collections` / `collections.tracks` (many-to-many `.through()`
`collectionTracks`), `tracks.relationsFrom`/`relationsTo` (both directions of `trackRelations`), `tracks.priority`/
`collections.priority`/`sessions.priority` (one level each, `optional: false`, so the relational API types it
non-null), `tracks.note`
(one-to-one via `notes.trackId`), polymorphic `comments` relations filtered per entity by `where: { targetType }`
on `tracks`/`sessions`/`collections`/`projects`/`trackAudios`, `comments.parent`/`replies` (self-relation),
`notes.track`/`author`. A left join through any of these makes every selected column of the joined table
nullable — including `NOT NULL` ones — so consuming code needs an explicit narrowing helper (e.g. `notes.ts`'s
`linkedTrack`) rather than a cast; `tsconfig.typecheck.json` rejects a bare cast here.

## Authorization (`db/queries/authorization.ts`)

- `MemberRole` = `member_role` enum; ranked `viewer(0) < editor(1) < admin(2) < owner(3)`; `roleSatisfies(role, min)`.
- `ProjectResolution = number | null` — a resolver returns the project id, or `null` when the entity doesn't
  exist (→ 404). Every scoped row carries a project now (tracks/collections/sessions/assets/comments are all
  `project_id NOT NULL`), so there is no third "exists but unscoped" state for those. **Exception: notes** — a
  note may be author-owned with no linked track at all, so it is gated by `loadNoteAccess`
  (`db/queries/notes.ts`), not by a `ProjectResolution` resolver.
- `memberRole(userId, projectId)` / `isMemberAtLeast(userId, projectId, minRole)` — the shared membership check
  used by route middleware and the static-file handler.
- `assertScoped(table, idColumn, projectColumn, ids, projectId, what, status = 404)` — one `count()` over
  `inArray(idColumn, distinctIds) AND projectColumn = projectId`; a short count throws `status` (404 unless a caller
  whose contract says otherwise passes 400, as `assertLevelsInProject` does) `"<what> not found in this project"`.
  A foreign row and a missing row are indistinguishable by design. `assertInProject(table, ids, projectId, what,
  status?)` is the common case (table has its own `projectId` column). Accepts `null`/`undefined` ids (ignored).
- `assertStatusUsable(statusId, projectId)` — a status is usable when it's the project's own or a seeded global
  one (`projectId IS NULL`).
- `isInstanceAdmin(userId)` — **async**, reads `users.instance_role`. The one answer both instance-wide gates
  use: `authorizeProject`'s `{kind:"instance"}` branch for a write, and `middleware/instance-admin.ts` for the
  whole `/admin/*` mount. It deliberately does not read the role off the session user even though it is there:
  Better Auth's cookie cache carries that copy for up to `session.cookieCache.maxAge`, so a promotion or a
  demotion would take minutes to reach a gate reading it.
- `getProjectMembers(projectId)` — members left-joined to `publicUserColumns` (no email, no `instanceRole`, no
  `disabledAt`).
- `changeMembership(projectId, actorId, targetUserId, {kind: "role", role} | {kind: "remove"})` — one transaction,
  `FOR UPDATE` on the project's member rows; 403 if the target outranks the actor or the granted role exceeds the
  actor's (`assertMayGrant`), 404 unknown target, 409 when it would drop the last `owner`.
  `updateMemberRoleSchema.role` excludes `owner` (`AssignableRole`) — ownership moves only by `transferOwnership`.
- `transferOwnership(projectId, fromUserId, toUserId)` — caller must be the current owner and the target must
  already be a member; same `FOR UPDATE` lock so two concurrent transfers can't both read "owner" and promote.
- Each entity's own query file exports `projectIdFor<Entity>(id): Promise<ProjectResolution>` next to that entity
  (e.g. `projectIdForAsset`, `projectIdForTrackAudio`, `projectIdForStatus`, `projectIdForJob`,
  `projectIdForComment`/`projectIdForCommentTarget`, `projectIdForImage`, `projectIdForInvite`).
  The `src/entities` registry (`ENTITIES[kind].projectIdFor`) is how routes and cross-entity code (sharelinks,
  comments) reach these without switching on kind — see `docs/agents/server-api.md`.

## Query-layer index (`db/queries/*.ts`)

One line per file; only exported functions/behaviour worth knowing before touching it.

- **admin-audit.ts** — `recordAdminAction({ action, actorId, targetUserId, detail? }, database?)` writes one
  `admin_audit` row, snapshotting the actor's and target's current email/name onto it; the single write path
  every admin action call site goes through. See **Admin audit trail** above.
- **activity.ts** — `diffFields(before, after, ignoredFields?)` builds an activity `changes` blob; `recordActivity`
  / `recordActivityBatch` write rows (batch skips a diff that ends up empty); `getProjectActivity(projectId,
  options)` the project feed, users joined in.
- **artwork.ts** — `withArtwork(schema)` extends a zod schema with an `artwork` field; `resolveArtworkChains` /
  `artworkForProject`/`Collection`/`Track`/`Session`/`ProjectRows` walk the own → collection → project cover
  chain; `trackImagePathSql`/`collectionImagePathSql`/`sessionImagePathSql` are the SQL fragments other queries
  (search, sharelinks) inline directly rather than round-tripping through a second query.
- **assets.ts** — `createAsset`/`getAsset`/`deleteAsset`; `projectIdForAsset`; `deleteAsset` and
  `deleteAssetsInProject` (bulk delete and duplicate removal, through `deleteAssetsWithin`) lock the doomed asset
  rows, every track their cascade reaches and the versions it will remove (`lockDoomedVersions`, see Lock order),
  read those versions, and after the delete run
  `closeVersionGaps` in the same transaction, so each touched track is renumbered and its gap diffs stored; `getAssetsInProjectWithContext(projectId,
  {page, pageSize, q, sort})` pages a project's files (`projectAssetsPageSchema`: `{rows, rowCount, page, pageSize}`),
  filtering on name with an escaped `ilike` and sorting on the `id`/`name`/`size`/`createdAt` whitelist
  (`parseSort`); the id page and the `count` both read the bare `assets` table so the uploader join never has to be
  counted around, and only the page's ids are hydrated with the uploader and every attachment they're on (across all
  four join tables) via `hydratePage`; `findAssetsByFingerprint` (scanner dedup); `findDuplicateAudio(projectId,
  executor?)` / `removeDuplicateAudio(projectId, ids)` (the duplicate-format audit behind `/assets/project/:projectId/
  duplicates`; the removal runs `deleteAssetsInProject`'s delete inside its own transaction); `getStaticFileByKey` (resolves a
  stored path to its row + `projectId`, gating `/static/*`); `enqueueAssetConversion` (an MP3 with no `kbps` takes
  the project policy's `audio.mp3Kbps`, recorded on the job; queues a `convert` job). The duplicate audit's
  same-bounce window and keep rule (`largest` or `lossless`, each an order of `@workspace/media`'s
  `preferredFirst`) are the project policy's `audio.sameBounceWindowMinutes` and `audio.duplicateKeep`; the
  grouping is `@workspace/media`'s `groupBounces`.
- **auth-sessions.ts** — `revokeUserSessions(userId, executor?)` deletes every `auth_sessions` row of one
  account, signing it out everywhere the cookie cache is not in play. Called on a disable and on a demotion
  (`changeInstanceUser`), and by `resolveSession` when it meets a disabled account.
- **authorization.ts** — see the Authorization section above.
- **comments.ts** — `createComment` (verifies a `parentId` sits on the same `(targetType, targetId)`, else 404;
  inserts in a transaction holding the target's `lockForComment` share lock where the target sets one, 404 when the
  row is gone; see Lock order);
  `getCommentsForTarget`/`getComment`/`updateComment`/`deleteComment`; `commentWithUserSchema` still exposes
  `user.email` to any project viewer (known gap, not yet fixed). Every comment read joins the `resolver` user
  (`publicUserMask`) and carries `viewerCan: { amend, resolve }`, computed in one place (`withViewerCan`) from a
  `CommentActor` `{ userId, role }`: `amend` is authorship; `resolve` needs a role and is true for the author or an
  editor+ on a top-level comment, never on a reply, never for a share guest (role null). `createComment`/`updateComment`
  take a `CommentWriter` (an actor with a non-null `userId`); `getCommentTarget` reads only a comment's target for
  the share gate. `resolveComment`/`reopenComment` take a `CommentWriter`, refuse a reply (400) then a caller without
  `viewerCan.resolve` (403), move the row with one conditional `UPDATE … WHERE resolved_at IS [NOT] NULL`, and answer
  `{ comment, changed }`: `changed` is false when the comment was already in the wanted state (the original resolver
  and time stand, `updatedAt` does not move).
- **images.ts** — `createImage`/`getImage`/`deleteImage`/`projectIdForImage`; `setImageOnParent` /
  `removeImageFromParent` take an `EntityKind` and throw 404 (never return `null`/`false`); `enqueueImageVariants`
  queues an `image_variants` job; `getImagesInProject(projectId, page, pageSize)` pages a project's images
  ordered by id, answering `{rows, rowCount, page, pageSize}` (`projectImagesPageSchema`) the same shape
  `getAssetsInProjectWithContext` answers for files, minus the `q`/`sort` params the assets listing needs for its
  table.
- **invites.ts** — `getInvitePreview` (no `email` selected); `createInvite` (refuses a caller below the project
  policy's `whoMayInvite` with 403 `forbidden`, fills an omitted role and the lifetime from the policy, and
  rank-checks the inviter via `assertMayGrant`); `acceptInvite(token, userId)` — existence/expiry/accepted checks run inside a transaction with
  `FOR UPDATE` on the invite row, so a double-accept race 409s instead of double-joining; `deleteInvite`/`listInvites`;
  `hasOpenInviteFor(email, executor?)` — whether an unexpired, unaccepted invite names that address
  (case-insensitive), which is what admits an invitee on a closed instance.
- **instance-users.ts** — the admin account surface, see **Instance accounts** above. `listInstanceUsers`,
  `changeInstanceUser`, `instanceUserSchema`/`instanceUsersSchema`/`instanceUserPatchSchema`. Exports
  `lockAdminsAndTarget(tx, userId)`, the `FOR UPDATE` admin-count the last-admin refusal is built on, so
  `account-deletion.ts`'s own last-admin check reuses it rather than recounting.
- **account-deletion.ts** — `deletionPlan(userId, database?)` and `deleteAccount(userId, database?)`, the
  `user.deleteUser` `beforeDelete` hook body; see **Account deletion** in `server-api.md` for the sequence.
  `deletionPlanSchema`/`DeletionPlan` are the `{blocking, deleted}` shape both `GET /me/deletion-plan` and a
  refusal's 409 body carry.
- **jobs.ts** — `registerJobHandler(kind, handler, {label, maxAttempts, steps, subjectLabels, outstanding})` registers a
  kind beside its implementation (retry policy default 1 attempt; no `steps` means the one-step ladder `run` named by
  `label`; a ladder with no weight throws); `enqueueJob`/`enqueueInstanceJob(kind)` (a project-less job, skipped while one of the kind is queued or running)/`lastInstanceJob(kind, statuses?)`/`startInstanceJobs(enqueue, failure, timer)` (queue now and on a policy timer, shared by the storage audit and the save content sweep)/`enqueueJobsOnce` (the last dedupes by `subjectId` against any
  already `queued`/`running` job of that kind — a burst of identical requests collapses onto one job);
  `findJob`/`getJob`/`getProjectJobs(projectId, {statuses, recentMs})`/`projectIdForJob`; `describeJobs` (adds `label`
  and `subjectLabel`, one `subjectLabels` call per kind; `labelsBySubject` builds a resolver from a subject-name
  lookup); `overallPercent`; `runJob`/`cancelJob`/`retryJob`/`resumeInterruptedJobs`/`pruneFinishedJobs`/
  `startJobRunner` drive the queued→running→done/failed/cancelled lifecycle; every row update publishes to
  `lib/job-events.ts`; finished rows are kept for the instance policy's `jobRetentionDays` (7 by default), pruned at
  boot and by `startJobPruning`'s daily timer.
- **labels.ts** — `getLabelsInProject`/`createLabel`/`deleteLabel`; `getEntityLabels`/`getEntityLabelsBatch`/
  `setEntityLabels`/`clearEntityLabels(exec, kind, id | id[])` (accepts a list — one `inArray` delete, empty list
  is a no-op); `linkLabelsInProject(exec, projectId, kind, id, labelIds)` (links a new entity to the ids still
  labels of the project, skipping the rest — the project policy's default labels at create).
- **move.ts** — cross-project move for tracks/collections/sessions. `closeMoveSet` (a moved collection brings the
  tracks no other source-project collection holds; a moved track brings its sessions) → `assertNoRepoSessions`
  (409 `Session "<name>" is a dit set in repo "<repo>"; a session in a repo can't move to another project.`
  for the first session by id in the closed set whose `repoId` is set, before anything is written, so a
  single, bulk, track or collection move is refused whole; `previewMove` refuses the same way) →
  `exclusiveAssets` (a raw
  CTE: an asset referenced only from the moved set follows, anything the source project still references stays
  behind) → drop shared join rows / cross-project `trackRelations` / split `collectionTracks` → `remapStatuses`
  (by name into the target; global statuses stay; else null) → `remapPriorities` (every moved track, collection and
  session by level name into the target, else the target's default; answers the fallen-back names as
  `priorityFallbacks: {from, to, count}[]`) → `remapLabels` (by name, created with the source colour when
  missing) → `remapCustomFieldValues` (onto the target's field of the same kind, name and type, else deleted;
  answers `droppedFields`; `server-api.md`, **Custom fields**, Moves) → `rehomeComments` (follows, since `comments.projectId` is the authz/search scope) →
  `unlinkStrandedSessions` (a session's `trackId` clears unless the track moves too) → `UPDATE project_id` on
  assets, sessions, tracks, collections in that FK-safe order — one transaction, one `activity` "updated" row on
  each side with `{projectId: {from, to}}`. `moveTrackToProject`/`moveCollectionToProject`/`moveSessionToProject`
  are the entry points. The move's report, `moveReportSchema` (`droppedFields` and `priorityFallbacks`), is what
  `moveEntities` returns beside the ids and the three entry points merge onto the moved row (`movedRowSchema`);
  `previewMove` runs the same guards and field plan without writing and answers the `droppedFields` alone. Known gap: `images` rows stay in the source project (a moved entity's own cover 403s for
  target members once `/static` gating applies); a moved session colliding with the target's `dedupe_filepaths`
  surfaces as a 500, not 409.

  **Locks.** Nothing in the schema ties `sessions.project_id` to its track's project, so the move and every write
  of `sessions.track_id` meet on the track row, always track before session. `closeMoveSet` locks the closed set's
  tracks `FOR NO KEY UPDATE` in id order, then reads and locks every session of the set (the tracks' sessions and
  the seeded ones) `FOR UPDATE` in id order; `assertNoRepoSessions` reads those rows without a lock of its own, and
  `previewMove` takes the same locks in its short read transaction. `FOR NO KEY UPDATE` blocks the writers' `FOR
  SHARE` below and nothing weaker: `FOR UPDATE` would also hold up the `FOR KEY SHARE` of every child row's
  foreign-key check for the whole move, and a custom-field write that upserts a value row the move later carries,
  then inserts another, would deadlock with it (40P01). Both locks take only the tracks and seeded sessions still
  in the source project and answer 404 `Track`/`Session not found in this project` when one is missing, so a move
  that queued behind another move of the same rows is refused whole instead of moving them on from a project
  `assertMovable` never checked. Every
  writer of `track_id` in `entities/session/queries.ts` (`createSession`, so the dit adopt path too,
  `updateSession`, `bulkUpdateSessions`, `bulkMoveSessions`) first locks the tracks it
  links to `FOR SHARE` in id order (`lockTracks`/`lockTracksIn`) and re-checks their project inside the writing
  transaction, answering the same 404 `Track not found in this project` a foreign track gets at the route;
  `bulkMoveSessions` then locks its sessions `FOR UPDATE` in id order filtered to the project (404 `Session not
  found in this project`), `bulkUpdateSessions` reads its selection's rows `FOR UPDATE` after the track lock (the
  `before` of its activity diff, so another write that landed during the wait is not recorded as the caller's),
  and `updateSession` compares the track's project with the updated row's. So a write
  that committed before the move's track lock is read by the move and moves with the track; one that queues
  behind the move finds the track (or the session) gone from its project and is refused, never left behind.
  The two-connection cases in `move.test.ts` ("a move racing a session written onto its track") pin each
  writer; `test/held-transaction.ts`'s `blocking(depth)` waits for a chain of waiters, not a sleep.
- **notes.ts** — `loadNoteAccess(noteId, userId)` (an unreadable note always 404s, never 403 — a private note's id
  must not confirm the note exists); `noteRights(loaded)` (author keeps write+delete even after leaving the
  project; a project editor+ gets `write`/`unlink` but never `delete`; viewer gets all-false); `listNotes` (opens
  only the `summary` blob per row, never `body`) deliberately does **not** repair a drifted `keyScope` — unwrapping
  always uses the row's stored scope, so drift never breaks decryption and repairing N rows on every list would be
  a write storm; `getNote`/`createNote`/`saveNote` (optimistic concurrency via `version`)/`linkNote` (author-only,
  409 if already linked)/`unlinkNote` (needs `can.unlink`)/`deleteNote` (author-only). An unlinked note
  belongs to its author alone, so `unlinkNote` answers `note: null` to a project member who unlinked someone
  else's note, and the note itself only to its author. `trackRefSchema`/
  `noteAuthorSchema`/`noteSummarySchema`/`noteDetailSchema`/`linkBodySchema` live here so `routes/notes.ts` and
  the MCP notebook tools (`mcp/tools/notes.ts`) share one declaration each. `isUniqueViolation` walks a
  `DrizzleQueryError`'s `cause` chain (bounded depth 4) to find the underlying Postgres `23505` — drizzle-orm rc
  wraps driver errors, so `err.code` is never the SQLSTATE directly; this is the only path that can hit a unique
  violation on an `UPDATE` (`onConflictDoNothing` only covers inserts).
- **objects.ts** — dit's object negotiation and pack intake (`routes/repo-objects.ts`). `missingObjects(repoId,
  hashes, userId)` answers `{missing, claimed}`: hashes with no `repo_objects` row for that repo and none in a repo of a
  project `userId` is a member of are `missing`; those another such repo holds are linked in (`claimGroup`, no file, no
  charge) and answered as `claimed`. A project the caller is not in never links or reveals anything.
  `acceptObjects(repoId, pushedBy, records)` takes a pack's verified records (`lib/object-pack.ts` `packRecords`, or
  any iterable) 100 to a transaction: per record, already in the repo or repeated earlier in the group → nothing;
  held by another repo → linked with no file; new → cap checked, `objects` and `repo_objects` rows written; then
  the group's new frames are stored together (`storeObjects`) and its usage added, one `addUsage` per scope,
  projects before users, just before it commits. Each cap check adds what the group has already linked to the
  scope (`assertStorageAllows`' `pending`), since no counter shows it yet. A cap refusal ends the group: the records
  before it commit, then the 413 is thrown; a failure of the records themselves (a bad or cut-short record) comes
  after the group read before it commits. Answers `{ stored, known }`. `objectHashSchema` is the wire schema for an
  object id, shared with `commits.ts`.
  **An object's row and its file never part.** `lockObjects(tx, hashes)` takes a transaction-scoped advisory lock
  per object (`pg_advisory_xact_lock(0x4f42, <hash's first 32 bits>)`, a shared key only queues), all in one
  statement in ascending key order, and every holder takes all of a transaction's locks in that one statement, so
  no two holders can wait on each other.
  A push group takes them first, then reads its `objects` rows `for key share` (`groupRows`), so the reap cannot
  delete a row between that read and the link; a reap that deleted one first leaves no row, and the object is stored
  again. The read is ordered by hash, so LockRows sits above a Sort or an ordered index scan and locks in the reap's
  order: a 15–100-key group plans as a Bitmap Heap Scan, which in heap order would deadlock with the reap. A
  new object's file is written only when the group created its row, and is made durable (`storeObjects`: each frame
  to a temp file and fsynced, every temp file renamed onto its key, each touched shard directory fsynced once; a
  file already under the key is an orphan and is replaced) before the transaction that inserted the row commits,
  and the row's committed `size` is what the link counts. Every removal of an object file goes through
  `removeUnnamedObjectFiles(hashes)`, which takes the objects' locks, re-checks that no row names each file, removes
  the rest and answers the hashes whose file is gone (a failed unlink, logged, is left out), 100 objects to a
  transaction, so a reap of a deleted project's thousands of
  objects costs tens of round trips rather than thousands. So a row always has its whole file, and a crash
  anywhere leaves at most a file no row names, which the storage audit reaps.
- **pagination.ts** — `paginationQuerySchema`/`parseSort`/`offsetOf` (`DEFAULT_PAGE_SIZE = 50`, `MAX_PAGE_SIZE =
  200`); `savesQuerySchema` (`limit`, default 100, at most 500: the save list's bounds, which the commit lists
  and the MCP `list_commits` take too); `hydratePage`/`facetCounts`/`groupSummaries`/`groupedIdRows`/`expandedGroupedIdRows`/
  `expandedGroupSummaries` (`GROUP_PREVIEW_SIZE = 10`) back every entity's table view (grouping, faceting, virtual
  scroll pages), with `sortTerm` (a sort key's order term, nulls last both ways) and `withJoins` (a listing's
  joins, each table once); two response envelopes, `paginatedResponseSchema(row)` for the entity tables
  (`rows`/`rowCount`/`page`/`pageSize` plus `facets`/`groups`) and `pageResponseSchema(row)` for the plain
  listings that have no filter menus (assets, images, admin users) — the plain one's numbers are
  `z.number().int()` and the richer one's are not, so they generate different OpenAPI and are not
  interchangeable; `escapeLikeTerm` escapes `%`, `_` and `\` in a user-typed search term, and every `ilike`
  over user text goes through it (an `ilike` over an API-controlled value, an enum or a kind, does not);
  `statusFilterSql`/`selectionNumber`/`selectionString`/`selectionScope`/`selectionFilters`;
  `membershipFilterSql(column, ids)` and `selectionIds` (an `all: true` selection's comma-separated id list, parsed
  with `entities/filters.ts`'s `idListParamSchema`, blank = no filter), the priority filter's pieces;
  `deleteSelected` (bulk delete over a `BulkSelection` — explicit ids or "all matching this filter");
  `archivedScopeSchema`/`ArchivedScope`, the `archived` list param of an archivable entity (absent = live rows
  only, `only`, `include`), the same string an `all: true` selection's filters carry.
- **priority-levels.ts** — a project's priority scale, see **Priority levels** above: `seedPriorityLevels`,
  `defaultLevelId`/`withDefaultLevel`, `assertLevelsInProject`, `levelByName`, `getPriorityLevels`, and the scale
  writes `createPriorityLevel`/`updatePriorityLevel`/`reorderPriorityLevels`/`deletePriorityLevel` with their body
  schemas.
- **project-policy.ts** — `ProjectPolicy`, `DEFAULT_PROJECT_POLICY` and `projectPolicy(projectId)`, the one reader
  of a project's insert defaults, sharing and invite rules, home-page windows and audio pipeline settings, plus
  the `withProjectPolicyForTest` seam; see `server-api.md`, **Project policy**, for every consumer.
- **retention.ts** — the activity sweeper. `sweepRetention(batchSize = 1000)` deletes `activity` rows (by
  `createdAt`) older than the instance policy's
  `activityRetentionDays`, or returns null while none is set; each batch is one `DELETE … WHERE id IN (SELECT id …
  WHERE id > last AND age < cutoff ORDER BY id LIMIT n)`, so a first sweep over years of history is many short
  statements over one pass of the primary key. `startRetentionSweeper` runs it at boot, daily, and at once when the
  retention changes (`server.ts`).
- **save-retention.ts** — the save content sweeper (steps in **Saves** above). `sweepSaveContent(batchSize = 1000)`
  returns `{ pruned, unlinked, reaped, bytesFreed }` (the bytes of the objects the reap deleted) under `jobs.saveContentRetentionDays` (never null). The unlink and the reap
  each walk their table's primary key through `keyWalk`, the `walk` term of a `WITH` statement: one range read
  (`… > after ORDER BY key LIMIT WALK_SPAN`, 10,000 keys) tests each row alone in a lateral select list, and a
  running count of the rows taken before each one (`count(*) filter (where take) over (… rows between unbounded
  preceding and 1 preceding) < batchSize`) cuts the walk at the row that brings them to `batchSize`. That count only
  grows, so Postgres (15 and up) makes it the WindowAgg's Run Condition and stops at the first row past the limit:
  `take` is tested for about `batchSize` rows, not the whole range, when most rows are taken. A statement
  returns the rows it took and the last key it walked, where the next statement starts, and the walk ends on a
  statement that walks nothing. On fresh statistics the range is an index scan of its own rows; on stale ones it is
  one pass over the rest of the table (a scan and top-N sort, or a bitmap of every key past `after` and a sort), some
  0.4 s per statement at a million rows against 50 ms fresh. The
  unlink step is one such statement per batch, deleting the links it took by `ctid` (a TID scan) and returning them,
  so a link another transaction removed first is skipped and the sweep walks on. Its `take` finds the saves that
  rebuild from a link's object by `save_object_hash`, and those that list it as a sample by `save_sample_object_hash`
  (the same nested lookups; a link either finds is kept), then each save's repo through nested scalar primary-key lookups
  of `saves` and `sessions`: written as a join, some statistics plan it through the repo's sessions (every save of
  the session per link) or as a merge join or join-filtered nested loop that walks `saves`' or `sessions`' key from
  its start per link. The reap walks `objects` for rows no
  link (`repo_objects`, `save_objects` or `save_sample_objects`) names, then in one transaction locks them with a primary-key probe each (`FOR UPDATE` in a lateral), re-checks
  the links per row and deletes by `ctid`, commits, and removes the batch's files through
  `removeUnnamedObjectFiles`, which keeps a file a push has recorded again since; dying between the two leaves only
  orphan files. `sweepStatements` exposes the four statements so `save-retention.test.ts` can read their plans under
  stale statistics. `startSaveContentSweeper` runs it at boot, daily, and at once when the setting changes
  (`server.ts`). One race is accepted: a commit that checks `repo_objects` while the unlink deletes the same old link
  still commits (`save_objects` has no foreign key to `repo_objects`), so its save holds an object the repo no longer
  pays for until a later push lists it again and `missing` reports it.
- **saved-views.ts** — `getSavedViews(projectId, actor, kind?)`/`createSavedView(projectId, actor, data)`/
  `updateSavedView(projectId, viewId, actor, data)`/`deleteSavedView(projectId, viewId, actor)`, where `actor` is
  `{ id, role }` (the caller and their project role). The list is `ownerId = actor.id OR shared`, joined to `users`
  for `owner: {id, name}`; a create upserts on the owner-scoped unique index with `ownerId = actor.id`. Both writes
  scope by `(projectId, id)` and add `ownerId = actor.id` to the same `where` unless `roleSatisfies(role, "admin")`,
  so a non-owner's write can never land; zero rows is a 404. An update whose body carries `shared` keeps the owner
  condition for an admin too, and answers 403 instead of 404 when the view exists (only an admin reaches that
  lookup, and an admin may already change the view).
- **search.ts** — `searchTracks`/`searchCollections`/`searchSessions`/`searchAssets`/`searchComments`/
  `searchProject` (fan-out over all five); `SEARCH_FLOOR = 0.15` similarity cutoff (pg_trgm).
- **session-samples.ts** — `replaceSessionSamples(tx, sessionId, projectId, samples)` (deletes the session's rows,
  inserts the list with `position` from the index, in batches under the bind limit; a repeated path keeps the last entry);
  `samplesForSessions(sessionIds, executor = db)` → `Map<sessionId, SessionSample[]>` in position order, no query
  for `[]`; pass the transaction as `executor` to read rows it has not committed;
  `heldSampleObjects(sessionId, repoId)` → path → object id for the newest-save references whose object the repo holds (the detail's `held` and `object`);
  `getProjectSamples(projectId)` → `SampleUsage[]` (`sampleUsageSchema`: one row per path, `sessions` =
  distinct sessions, `sessionIds` ascending, `missing` = any row `missing`, `kind` from the most recently saved
  session; most sessions first, then path); `getSessionsBySample(projectId, path)` → `SampleSession[]`
  (`sampleSessionSchema`: the `getSessionsByDevice` shape with the row's `status` instead of `onTracks`, most
  recently saved first, `[]` for a path no session carries). Both filter `session_samples.project_id`.
- **saves.ts** — `recordRevisions(rows, executor = db)`/`saveFromSession(session, source,
  samplePaths)`/`sourceOfPatch` (classifies a session write as `scan`/`backup`/`app` from what the patch touches,
  `samples` included); `getSessionSaves(sessionId,
  limit)`; `getSaveHeatmap(scope, range)` (overloaded: a `ProjectHeatmapScope` returns `HeatmapDay[]`, a
  `UserHeatmapScope` returns `UserHeatmapDay[]` with an extra `projects` count) — day-bucketed via `to_char((col
  AT TIME ZONE 'UTC') AT TIME ZONE $tz, 'YYYY-MM-DD')` aliased `.as("day")` and grouped/ordered by that alias name,
  not by repeating the `sql` fragment (Drizzle rebinds an interpolated value to a fresh placeholder at each
  occurrence, so Postgres sees three different expressions and refuses the query); `getProjectSaves(projectId,
  options)` — newest-first, each carrying its session and the previous save's `meta` via a correlated subquery on
  `save_session_time`.
- **settings.ts** — the settings rows at every scope and the first-user bootstrap, see **Settings** above.
  Targets `userTarget`/`projectTarget`/`instanceTarget` (`INSTANCE_TARGET_ID`); reads `effectiveFor`,
  `hubRowsFor`, `publicSettings`, `instanceSetting`, `instanceRows`/`forgetInstanceRows`,
  `cachedRegistrationMode`; writes `writeSettings`, `setLocks`, `setRegistration(mode, updatedBy)`;
  `exportUserSettings`, `importUserSettings`, `listAudit`; `hasAccounts(executor?)` (asks
  `is_anonymous is not true`), `admitSignUp(email, database?)`; and the response schemas the routes and their
  tests share (`effectiveSettingsSchema`, `hubRowsSchema`, `changedHubRowsSchema`, `settingsExportSchema`,
  `importReportSchema`, `settingsAuditPageSchema`, `publicSettingsSchema`). **settings-env.ts** — `envLayer()`.
- **sharelinks.ts** — `getSharelink(token)` (guest read, drops the uploaded filename — the live on-disk name the
  frozen `snapshot` titles exist to replace); `listSharelinks`/`getSharelinkTracks`/`resolveSharelinkTrackAudio`
  (confirms a track-audio id is one the token actually grants, so the stream/comment routes can't be pointed at an
  id outside the shared entity); `getShareOptions`/`createSharelink`/`updateSharelink`/`updateSharelinkTracks`/
  `convertSharelink` (snapshot ↔ connected)/`deleteSharelink`; `createShareComment`/`updateShareComment`/
  `deleteShareComment`/`getShareComments` (guest commenting on a shared entity, gated by the token not a session).
- **signin-attempts.ts** — the `signin_attempts` brute-force counter, see **Sign-in lockout** above. `lockAfter`,
  `emailHashOf`, `checkLockout`, `recordFailure`, `clearLockout`.
- **statuses.ts** — `getStatus`/`getStatusesInProject`/`createStatus`/`updateStatus`/`deleteStatus`;
  `projectIdForStatus`; `calculateStatus(statusHavers)` (rolls up a collection's completion percentage from its
  tracks' statuses).
- **save-retention.ts, the job.** The sweep runs as the `save_content_sweep` job kind (instance-wide: `projectId` null,
  like `storage_audit`): `startSaveContentSweeper(enqueue)` queues one at boot, daily and at once when
  `jobs.saveContentRetentionDays` changes, `enqueueSaveContentSweep` skips while one is queued or running, and the
  handler's `result` is the sweep's counts with `bytesFreed`. `lastSaveContentSweep()` is the latest finished row
  (`done` or `failed`, with its `finishedAt` and `bytesFreed`, 0 when it failed), which `GET /admin/storage` reads
  as `lastSweep` and the retention setting's last-run line shows; null before the first run.
- **storage-audit.ts** — the `storage_audit` job kind: `auditStorage` walks `static/**`, deletes any file older
  than `ORPHAN_AGE_MS` (24 h) whose key no table names (or, while the instance policy's `orphanMode` is `report`,
  counts it as `reported` and keeps it), recomputes every scope's counter, fills `images.variantsReady`
  for images whose resizes are all present, prunes counters of scopes that are gone, and writes the counts and bytes
  onto the job row. `enqueueStorageAudit` is a no-op while one is queued or running; `startStorageAudits` runs one at
  boot and every `auditIntervalHours` after, re-armed when the policy changes it. `lastStorageAudit` is the newest
  finished row, for `GET /admin/storage`.
  A file outside `assets/`, `images/`, `analysis/` and `objects/` is counted as foreign and left alone; an
  `objects/` file no `objects` row names is an orphan like any other, but is removed only through
  `removeUnnamedObjectFiles` (the object's lock, then a re-check of its row), so one a push records while the audit
  decides is kept. The walk lists keys (`listStoredKeys`) and stats only the files no row references
  (`storedFileStat`).
- **storage-usage.ts** — the `storage_usage` counters. `projectScope`/`userScope`/`scopesOf` name the scopes a file
  belongs to; `addUsage`/`subtractUsage(tx, scopes, bytes)` move them in one upsert and must be called with the
  transaction that writes the owning row; `addVariantUsage(key, bytes)` does the same for a resize while also adding
  to `images.variantBytes`. `limitFor(scope)` is a scope's cap — the instance's for its kind, lowered for a project
  by the project policy's `storageCapGb`. `assertStorageAllows(scopes, bytes)` is the cap gate — it throws `ApiError` 413
  `storage_limit` carrying `{scopeKind, usedBytes, limitBytes}`; `remainingAllowance(scopes)` is what a conversion
  measures its growing output against. `recomputeUsage`/`recomputeAllUsage` re-derive from `sum(size)` and return the
  drift, which is how a cascade delete (a project, a track, a bulk delete, a cross-project move) settles up instead of
  subtracting row by row — `releasingProjectUsage(projectId, fn)` wraps `deleteProject` for that, and re-derives the
  pushers of the project's repo objects and the successors that start paying for them, as well as its uploaders.
  `repoBytes(projectId)` is the project's repo-object term alone (the same SQL fragment `ACTUAL_USAGE` uses);
  `repoStorages(repoIds)` is each repo's `{setBytes, sampleBytes, sharedBytes}` for the repo shape's `storage`
  (`sampleBytes` is the objects commits list as samples, `sharedBytes` the part another repo paid first); `repositoryBytesByProject()` and
  `sharedRepoStorage()` (`{projects, savedBytes}`) feed `GET /admin/storage`; `GET /projects/:id/storage` returns it as `repositoryBytes`
  beside the `reportFor` fields (`projectStorageReportSchema`). `newRepoObjectScopes(tx, repoId, hash, pushedBy)` is
  the scopes a link of `hash` into `repoId` adds bytes to — the project and the pusher (when non-null) when no repo
  anywhere holds the hash, nobody otherwise; call it before the `repo_objects` insert, then
  `assertStorageAllows(scopes, size)`, then `addUsage(tx, scopes, size)` in the transaction that inserts the rows. Two
  racing first pushes of one hash can both count it; the audit corrects the counter. `reportFor`,
  `allUsageReports` and `instanceUsedBytes` are the two storage routes' reads.
- **track-audios.ts** — `getTrackAudios`/`linkTrackAudios` (returns `{ audios, analysisJobIds }`, the linked rows
  plus the ids of the `audio_analysis` jobs it queued for them — none where the project policy's `autoAnalyse` is
  off)/`unlinkTrackAudio` (removes the deleted row's own
  spectrogram PNG after the row commits, and, inside the same locked transaction as the delete, repairs the diff
  chain across the gap the deleted version leaves between its old neighbours)/`setPrimaryTrackAudio`/
  `getCandidateAudios`; `audioOwnersForTracks`; `spectrogramKeysForAsset`/`spectrogramKeysForTracksMatching` (the
  spectrogram keys named by an asset's, or a `tracks`-scoped `where`'s, track-audio rows — read by the asset route
  and by `deleteTrack`/`bulkDeleteTracks`/`deleteProject` before their own cascading delete removes the rows that
  name them, so the caller can remove the files once its delete has committed); `outstandingAnalysis` (SQL:
  `analysisVersion IS NULL OR < ANALYSIS_VERSION`, the one definition of "not yet analysed") and
  `isOutstandingAnalysis` (the same rule for a version already read into memory); `withTrackAnalysisLock` (runs a
  callback inside a transaction holding `pg_advisory_xact_lock`'s two-key overload, keyed `(TRACK_ANALYSIS_LOCK_CLASS,
  trackId)` — every read-then-write across a track's other versions goes through this, released automatically at
  the transaction's end); `lockTracksForAnalysis(tx, trackIds)` (the same lock for several tracks inside a
  transaction already open, taken in ascending id order so overlapping callers queue rather than deadlock);
  `closeVersionGaps(tx, removed)` (after `{trackId, version}` rows are deleted, under their tracks' locks:
  `resequenceVersions` each track, and `storeDiffIfMissing` for every pair of current versions that now meet across
  a removed version — shared by `unlinkTrackAudio` and the asset deletes); `analyseTrackAudio` (decodes a track audio once through `decodeInto` into one
  `@workspace/dsp` `AnalysisSession` opened with every flag — peaks, loudness, spectrum and the whole offline set —
  and writes every measured/detected column plus `analysisVersion` together; a no-op when the row is already
  current). After storing: writes the spectrogram PNG (`lib/spectrogram.ts`) when the tile has any columns, then —
  inside one `withTrackAnalysisLock`ed transaction together with the row's own update — upserts the version's
  quantised features into `trackAudioFeatures`; looks up `currentSiblingVersions` (every other current version on
  the track, joined to its features row) to `storeDiff` the pair against the previous current version (always) and,
  via the shared `storeDiffIfMissing`, the pair against the next current version too if it would otherwise stay
  missing — both via `@workspace/dsp/offline`'s `alignFeatures`/`diffFeatures`, offset falling back to 0 when
  alignment does not clear the confidence floor; and runs `findDuplicate` (every other current version aligned and
  diffed for `fingerprintSimilarity`, winner is the lowest-numbered version above 0.98 similarity within 1 s of
  duration) to set `duplicateOfId` in the same update. `enqueueAudioAnalysis`/`enqueueAudioBackfill` (queue
  `audio_analysis`/`audio_backfill` jobs; `audio_backfill` also registers an outstanding-work finder, so a project
  with outstanding analysis gets a boot-time pass without anyone requesting one, unless its policy's `autoAnalyse`
  is off); `getTrackAudioMeasure` (the one
  reader behind every entry in `entities/track-audio/measures.ts`'s registry: reads the named column, queues
  analysis when outstanding, same healing every lazy reader does); `getTrackAudioDiff(fromId, toId)`; `getTrackAudioDurations`;
  `getCollectionRuntimeMs`/`getCollectionAudioSummary` (`loudness`: PROJ-13 aggregates of `lufs` across a
  collection's primary audios; `spectrum`: the `spectrumEnvelope` of their `ltas` curves; `tempo`: the same
  min/max/median/measured shape over `bpm`; `keys`: `{key, count}[]` over `musicalKey`, most common first; all four
  plus measured/total);
  `projectIdForTrackAudio`; `auditProjectAudio(projectId, trackIds?)` (three statements — versions ⋈ assets ⋈ tracks,
  their session attachments, and fingerprint groups shared across more than one track — plus tracks with no version
  and, per track that has a session, `getCandidateAudios`'s unlinked candidates; never selects `audioPeaks`/`ltas`);
  `audioFindings(audit, thresholds)` (pure, turns the read into a flat `Finding[]` against the project policy's
  `AuditThresholds`: `auditTooShortSeconds` 15, `auditNearSilentLufs` −40, `auditHotPeakDbtp` −1,
  `auditLeadSilenceSeconds` 2, `auditTailSilenceSeconds` 3, `auditNameMismatch` 0.3 by default; `auditWithFindings`
  in `mcp/tools/audio.ts` reads them) and `nameSimilarity(assetName, title)` (token overlap, used to flag a file
  named more like another track's title than its own).
- **track-relation-types.ts** — `seedRelationTypes`; `getRelationTypes` (rank order, each with `inUse`);
  `createRelationType`/`renameRelationType`/`reorderRelationTypes`/`deleteRelationType` (409
  `relation_type_in_use`, `details.inUse`); `ensureRelationType` (a move's re-point);
  `assertRelationTypesInProject`; `relationTypeByName`.
- **track-relations.ts** — `getTrackRelationEdges`/`getTrackRelationEdgesBatch`/`addTrackRelation`/
  `deleteTrackRelation`.
- **user.ts** — `getProjectsForUser`.

## Lock order

Every path that takes more than one of these locks takes them in this order, each set in ascending id, so a holder
of a later lock never waits on an earlier one and two such paths queue rather than deadlock:

1. `assets` rows, `FOR UPDATE`;
2. the track analysis locks (`pg_advisory_xact_lock(TRACK_ANALYSIS_LOCK_CLASS, trackId)`, through
   `withTrackAnalysisLock` or `lockTracksForAnalysis`);
3. `track_audios` rows, `FOR UPDATE` or written.

The analysis fixes the order: it reads a track's other versions under the track's lock and only then writes its own
row, so it cannot take its rows first, and a delete that held a version and then waited on the track would deadlock
against it.

- `lockDoomedVersions` (`track-audios.ts`) takes all three for a cascading asset delete: `deleteAsset`,
  `deleteAssetsInProject`, and `removeDuplicateAudio`, which takes them for every requested id before its audit and
  again, already held, in `deleteAssetsWithin`. `handOverPrimaries` and `closeVersionGaps` write versions after it.
- `deleteTrack` and `bulkDeleteTracks` take the tracks' analysis locks and then their versions (`lockTrackVersions`,
  `track-audios.ts`) before the delete cascades to them; the bulk delete reads its selection in the same transaction
  and deletes exactly the ids it locked. A track delete removes no asset, so the first set does not apply.
- `deleteProjectRow` (`entities/project/queries.ts`, reached from `deleteProject`) takes `lockDoomedVersions` for the
  project's assets before its first delete. A track's versions name assets of its own project (linking checks it, a
  move takes the assets along or drops the versions), so that reaches every version the cascade removes. Holding
  them before the project row goes is also what keeps a comment on one of them from deadlocking with the delete: the
  comment share-locks the version and then key-share-locks the project row through its foreign key.
- `unlinkTrackAudio` and an analysis's write take the track's lock, then write its versions.
- `linkTrackAudios` key-share-locks the assets it links (ascending id), then takes the track's lock, and only then
  inserts its rows and lets `resequenceVersions` and `setPrimaryWithin` rewrite the track's versions;
  `setPrimaryTrackAudio` takes the lock before `setPrimaryWithin`, then re-reads the version and stops if a delete
  removed it while it waited. Both rewrite every row of the track, so without the lock they would hold one version and
  wait on another that a delete holds while it waits on the first.
- The `tracks` row sits after the track's lock. A track delete deletes it while holding that lock, and a version
  insert key-share-locks it through `track_audios.track_id`, so every path that inserts a version takes the track's
  lock before the insert: a link that held the row and then waited on the lock would deadlock against the delete.
- Comment creation takes one lock from the set: `createComment` runs in a transaction, and a target that sets
  `CommentTarget.lockForComment` (the track audio) share-locks its row (`FOR SHARE`) before the insert. A comment
  names its target with no foreign key, so this is what keeps the duplicate removal's `commented` check true until
  its delete: a comment racing a removal waits for it and answers 404 once the row is gone, or commits first and the
  audit skips the copy as `commented`.
- A snapshot pin (`writeSnapshot`) and an attachment take theirs through a foreign key: the insert key-share-locks
  the version or the asset, waits out a removal holding it, and then fails on the deleted row (23503,
  `isForeignKeyViolation`). The pin's transaction is run again once (`inSnapshotTransaction`), reads the committed
  state and answers what it would have had the removal gone first (a 400 for an override naming the removed
  version, the copy left out of a live snapshot); a second removal beating the rerun answers 409. The attach
  answers the asset's 404. A snapshot write is one transaction (`createSharelink`'s link insert with its snapshot,
  `updateSharelinkTracks`, `convertSharelink`'s snapshot or delete with its `shareType` update), inserting its pins in
  `trackAudioId` order so two pins of several versions of one removal never lock in opposite orders.

## Raw-SQL gotchas

- **`timestamp` columns hold UTC as `timestamp without time zone`, and only drizzle's own decoding reads them as
  UTC.** A raw `sql` expression in a `db.select({...})` (a `max(...)` subquery) hands back the bare string, and
  `new Date("2026-03-01 01:02:03")` parses it in the process's zone. Give the expression `.mapWith(<column>)`
  (`.mapWith(activity.createdAt)`) so it decodes the way that column does. `db.execute(sql\`…\`)` /
  `tx.execute(sql\`…\`)` have no decoder at all: select the timestamp as
  `to_char(col, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` and `new Date(...)` that, which is the same instant in any zone.
  `timestamp-zone.test.ts` runs each such read under `TZ=Australia/Sydney`. Also: `tx.execute(...)` rows must be read
  as `(result.rows ?? result)` — the shape differs between call sites (`move.ts`, `projects.ts` both do this).
- **A `sql` fragment carrying an interpolated value cannot be repeated across `SELECT`/`GROUP BY`/`ORDER BY`.**
  Drizzle rebinds the value as a fresh placeholder at each occurrence, so Postgres sees distinct expressions and
  throws `column must appear in the GROUP BY clause` even though the source text is identical. Alias it once with
  `.as("name")` in the select list, then `groupBy(sql\`name\`)`/`orderBy(sql\`name\`)` by that output name —
  `getSaveHeatmap` (`db/queries/saves.ts`) is the worked example.
- **A single-table `select` renders its columns unqualified, which breaks an interpolated correlated
  subquery.** With one table in the `FROM`, drizzle emits `"id"` rather than `"users"."id"`, so
  `sql`(select … from ${authSessions} where ${authSessions.userId} = ${users.id})`` comes out as
  `where "user_id" = "id"` and both names resolve against `auth_sessions` — a `text = integer` error if the
  types differ, and silently the wrong answer if they do not. A query with a join qualifies everything, which
  is why `getProjectsForUser` (`user.ts`) gets away with the same shape. Spell the subquery's own table and
  alias out by hand (`from auth_sessions as s where s.user_id = users.id`), as `instance-users.ts` does.
- **`jsonb_array_elements(...) WITH ORDINALITY` needs an explicit column alias list**, e.g. `t(value, ordinality)`.
  Referencing the bare alias afterwards (`t ->> 'name'`) fails with `operator does not exist: record ->> unknown`
  — Postgres treats an unaliased multi-column SRF's bare alias as a whole-row composite. The single-column case
  without `WITH ORDINALITY` (`getProjectPlugins` in `entities/session/queries.ts`) doesn't hit this.
- **`jsonb_exists(col, $1)`** is the function form of the `?` "array contains this text" operator — use it in raw
  SQL to avoid a client library pre-parsing `?` as its own placeholder syntax.
- **`.for("update")` on a Drizzle `select` inside `db.transaction` works against the pool** — both the
  authorization concurrency tests and `move.ts`/`notes.ts` exercise real row locks this way, via `Promise.all` of
  concurrent calls.
- **Timezone bucketing needs a double `AT TIME ZONE`.** Every `timestamp` column here is *without* time zone, so a
  local-day grouping reads `to_char((col AT TIME ZONE 'UTC') AT TIME ZONE $tz, 'YYYY-MM-DD')` — the first
  reinterprets the naive value as UTC, the second converts it into the caller's zone. Validate the zone (against
  `Intl.supportedValuesOf("timeZone")`, special-casing `"UTC"` since that function doesn't list it) before it
  reaches SQL — an unknown zone makes Postgres throw, which otherwise surfaces as a 500 where the caller deserves
  a 400.
- **A batch walk over a large table needs a plan that holds on stale statistics.** After a bulk load or delete that
  autovacuum has not analysed yet, the statistics can put a table at a fraction of its size, and then
  `… WHERE NOT EXISTS (…) ORDER BY key LIMIT n` is planned as a scan and sort of the whole table with the anti-join
  run against a scan of every link, once per batch; a lookup by `= ANY(array[…])` or a join against `unnest(…)`
  goes the same way. A range read with `ORDER BY key LIMIT n` never holds an index scan whatever the statistics:
  once they put the table at a handful of rows (a vacuum of a table all but emptied records `reltuples` near 0
  across the pages it keeps, and a refill of those pages leaves it there until the next analyse), it is planned as
  a bitmap of every key past the start and a sort, and at a few hundred as a scan and sort of the whole table, so
  a walk that probes each next key with `LIMIT 1` reads the rest of the table once per key. A never-analysed table
  (`reltuples` -1, as after `TRUNCATE`) plans fine: the planner sizes it from its pages. The shapes that hold: read
  a batch's keys as one range per statement (`keyWalk` in `save-retention.ts`), whose worst case is one pass over
  the rest of the table; test a row's links in a select list or a scalar subquery, since a bare `NOT EXISTS` in
  `WHERE` becomes an anti-join; lock rows with a lateral `… WHERE key = h.key FOR UPDATE` per key; delete rows
  already found by `ctid = ANY(ARRAY(subquery))`, a TID scan. `save-retention.test.ts` reads the plans, and with
  `EXPLAIN ANALYZE` the rows each walk reads, with `pg_class.reltuples` and `relpages` changed inside a transaction
  it rolls back.

## Other gotchas

- **A left join makes every selected column of the joined table nullable, `NOT NULL` ones included.** A
  joined-entity type needs an explicit narrowing helper rather than a cast — `tsconfig.typecheck.json` rejects a
  bare cast here. `notes.ts`'s `linkedTrack` is the pattern.
- **Drizzle 1.0-rc wraps driver errors.** A unique-constraint violation from `db.update(...)` arrives as a
  `DrizzleQueryError`; `err.code` is not the SQLSTATE — it's one or more `cause` links down. See `isUniqueViolation`
  in `notes.ts`.
- **Query-layer test shape:** seed users/projects/members/tracks directly against `db`, drop projects then users
  in `afterAll` — no HTTP, no Better Auth sign-up rate limits (`move.test.ts`, `notes.test.ts` are the templates).
  Assert thrown `HTTPException`s with `.rejects.toMatchObject({ status: 403 })`. Route-level tests instead go
  through `setupSuite` fixtures (see `docs/agents/server-api.md`).
- **`Pool.prototype.query` spies see nothing inside `db.transaction`.** Spy `Client.prototype.query` instead if a
  test needs to observe statements issued inside a transaction.
- **A fresh worktree's `apps/server/.env`** already points at the live local Postgres
  (`postgres://postgres:password@localhost:5432/projammr`, copied by `worktree-setup.sh`), so `bun run generate` and
  `bun run migrate` work there with no extra setup.
