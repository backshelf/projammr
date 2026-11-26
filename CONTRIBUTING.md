# Contributing to Projammr

Thanks for taking the time. This page covers how to set up a development checkout, what a pull request should
contain, and where to find things. Please also read the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security
problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

Projammr is a heavily AI-assisted project; the [README](README.md#how-ai-is-used) explains how. Pull requests from
outside contributors are welcome. For anything larger than a small fix, open an issue first so the approach can be
agreed before you spend time on it.

## Prerequisites

- **[Bun](https://bun.sh) 1.4.3**, the version the root `package.json` pins in `packageManager`. Bun is the package
  manager, the runtime of the API and the test runner.
- **Docker**, for a PostgreSQL 17 database. Any PostgreSQL 17 server works if you already have one.
- **ffmpeg** on your `PATH`. The API runs it to decode audio, and some server tests run it on real audio.
- **Rust 1.97.1 through [rustup](https://rustup.rs)** and **`wasm-opt` 116 or later**. `packages/dsp` compiles Rust
  to WebAssembly, and both the API and the web app load that module, so `bun run dev` and `bun run build` need the
  toolchain even if you never touch the audio code. `packages/dsp/rust/rust-toolchain.toml` pins the version and
  rustup installs it on first use; [`packages/dsp/README.md`](packages/dsp/README.md) has the details.

## Set up a development checkout

Fork the repository on GitHub, then:

```bash
git clone https://github.com/<you>/projammr.git
cd projammr
bun install
```

Start a database and create the two env files (`apps/server/.env` and `apps/client/.env`) as described in the
[development setup guide](apps/web/src/content/docs/docs/contributing/development-setup.mdx), which lists every
value. Then:

```bash
bun run dev
```

That starts the API on `:8080`, the web app on `:3000`, the docs site on `:4321`. Check what is
already listening on those ports first.

## Checks

Run these before you open a pull request. CI runs the build and the tests on a pull request, and the rest of these for a release:

```bash
bun run lint       # ESLint across the workspaces; CI fails on any warning
bun run typecheck  # regenerates the API types, then bun check per workspace; the real gate
bun run build      # builds every workspace
bun run test       # every suite except the server's
cd apps/server && bun run test   # the server suite; needs live Postgres (see below)
```

`bun run format` runs Prettier over the repository. If you change an API route or an enum, run `bun run typegen`
and commit what it changes (`packages/api/src/enums.ts`, `apps/web/openapi/`). The gates are described in full under
"Gates" in [`AGENTS.md`](AGENTS.md).

### Running the server tests

The server suite talks to a real PostgreSQL database and never opens a port. Some of its tests create and drop
databases of their own, so the database role needs permission to create databases; the default `postgres`
superuser of the Docker image has it.

```bash
docker run -d --name projammr-test-db \
  -e POSTGRES_PASSWORD=projammr -e POSTGRES_DB=projammr \
  -p 5432:5432 postgres:17

bun install
bun run --filter @workspace/dsp build     # builds the WebAssembly the suite loads

cd apps/server
cat > .env <<EOF
DATABASE_URL=postgres://postgres:projammr@localhost:5432/projammr
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
NOTES_MASTER_KEY=$(openssl rand -base64 32)
FFMPEG_PATH=ffmpeg
EOF
mkdir -p static/assets static/images static/analysis
MIGRATE_BACKUP=0 bun run migrate
bun run test
```

`bun test src/routes/notes.test.ts` runs one file and `bun test -t "returns 403"` runs the tests whose name matches.
If you already created `apps/server/.env` for `bun run dev`, reuse it. Remove the container with
`docker rm -f projammr-test-db` when you are done.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`.
- The scope is the app or package the change touches (`server`, `client`, `dit`, `web`, `ui`, `api`, `demo`,
  `dsp`), or a narrower area.
- The summary is imperative and lowercase, for example `fix(server): reject empty track names`.
- No issue key is needed.

## Pull requests

1. Fork the repository and create a branch from `master`, named for the change (`fix/empty-track-names`).
2. Make the change, with tests, and run the checks above.
3. Open a pull request against `master`.

A good pull request:

- does one thing, and says in its description what changed and why;
- carries tests for the behaviour it adds or fixes, including the error case, and does not delete coverage;
- passes the checks above, with no lint warnings;
- includes before and after screenshots when it changes what a screen looks like;
- updates the matching reference in `docs/agents/` when it changes the structure of an area (a route, a table, a
  component, an IPC channel);
- follows the surrounding code's style, and adds no compatibility shims or dead code.

## Where things are

- [`AGENTS.md`](AGENTS.md) holds the architecture and the engineering principles (DRY, modularity, ownership,
  server authority, testing). Read the "Architecture" section before a substantial change.
- [`docs/agents/`](docs/agents/) has a reference per area: the server API, the database, the client, the shared
  packages, dit, the docs site and the monorepo. They are useful to any contributor, whatever tools you use.
- [`DESIGN.md`](DESIGN.md) is the design language. Read it before any UI change. [`PRODUCT.md`](PRODUCT.md) is the
  product definition.
- The `.claude/` directory is the maintainer's Claude Code setup. None of it is required to contribute; see
  [`.claude/README.md`](.claude/README.md).

## Adding a DAW

dit reads projects through one module per DAW. The steps, the interface to implement and the tests to add are in
the "Adding a DAW" section of [`docs/agents/dit.md`](docs/agents/dit.md).

## Licence

Projammr is licensed under the [GNU Affero General Public License v3.0](LICENSE). By submitting a contribution you
agree that it is released under the same licence.
