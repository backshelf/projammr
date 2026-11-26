# Release baselines

The upgrade job (`.github/workflows/upgrade.yml`) proves that a database written by the last release still migrates
to the tip of a pull request. This directory holds what it upgrades from: **one full database dump of the newest
release**, named for the version (`1.0.0.dump`).

## What the job does with it

It runs on pull requests that touch `apps/server/src/db/**` and on manual dispatch. Its first step looks for the
newest `*.dump` here (names sort as versions). With none it says so and passes, and that is the state until the
first dump is committed at the 1.0 tag; nothing in the workflow changes when that happens. With one it:

1. restores the dump into the `postgres:17` service, with the container's own `pg_restore` (the runner's is 16 and
   refuses a dump written by 17);
2. runs `bun run migrate` (`applyMigrations`), which reads the journal the dump carries in
   `drizzle.__drizzle_migrations` and applies only the migrations written since the release;
3. runs `bun run test:smoke`, the server test files that sign up, read and write the core entities over HTTP, on
   the upgraded database. None of them decrypts an existing note, so the demo notes key the snapshot records is not
   needed.

The dump is a full dump, not `--schema-only`: a schema-only dump omits the rows of the journal table, so the
migrator would find nothing applied and try every migration from the first. The rows are the point too: a migration
that cannot upgrade real data fails the job.

`packages/demo`'s `restore` also restores a snapshot and migrates it forward, for a developer's own worktree. This
job does the same in CI, from a snapshot committed at a release instead of one kept on a developer's disk.

## Producing a baseline

At the release tag, from a **linked worktree** of it (`packages/demo` refuses the main checkout):

1. Give the worktree its own database on a **Postgres 17** server, the major the compose stack ships and the job
   restores into. The development server a worktree normally uses may be newer, and a dump made there cannot be
   restored by the job's 17 client. A throwaway container does it:
   `docker run -d --name baseline-pg -e POSTGRES_PASSWORD=<pw> -p 127.0.0.1:5433:5432 postgres:17`; point the
   worktree's `apps/server/.env` `DATABASE_URL` at it and run `bun run migrate` in `apps/server`.
2. `bun run --cwd packages/demo demo-env` to give the workspace a demo-only notes key, then start the API.
3. `bun run --cwd packages/demo seed -- --api <the worktree's API URL> --inputs ~/projammr-demo-audio` seeds the
   demo catalogue through the API at the tag: accounts, projects, tracks with audio, a session with its saves,
   comments, notes, saved views, invites and a share link.
4. `bun run --cwd packages/demo snapshot -- --pg-container baseline-pg`. The snapshot dumps with the server's own
   major, so the dump is 17's; remove the container once the dump is copied.
5. Copy `~/projammr-demo-audio/snapshots/latest/db.dump` here as `<version>.dump`, and delete the previous
   baseline in the same commit. History keeps the old one, so the repository grows by one dump per release rather
   than accumulating them.

Committing the dump is what activates (or moves forward) the job.
