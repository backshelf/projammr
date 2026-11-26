# syntax=docker/dockerfile:1

# Two images from one build graph: `api` (the Hono API on Bun, with ffmpeg,
# migrating before it listens) and `web` (the Next.js standalone server on
# Bun). Both grow from the same dependency stage and take @workspace/dsp's
# WebAssembly module from `build-dsp`; `api` alone also takes @workspace/dit's
# from `build-dit`;
# docker-compose.build.yml picks the target per service when building from
# source (docker-compose.yml alone runs the published images).

FROM oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS base
WORKDIR /app
ENV BUN_INSTALL_CACHE_DIR=/bun-cache

# The base image carries labels describing Bun itself; every one that would
# otherwise be inherited is set here so the images describe this project. A
# CI build fills in the revision and date.
ARG SOURCE_REVISION=""
ARG BUILD_DATE=""
LABEL org.opencontainers.image.source="https://github.com/backshelf/projammr" \
      org.opencontainers.image.url="https://github.com/backshelf/projammr" \
      org.opencontainers.image.revision="$SOURCE_REVISION" \
      org.opencontainers.image.created="$BUILD_DATE" \
      org.opencontainers.image.version="" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

# ---- Rust → WebAssembly base ------------------------------------------------
# Shared toolchain stage for the WebAssembly crates (`build-dsp` and
# `build-dit`), so binaryen and Bun are installed once and neither the Bun
# stages nor the runtime images carry a Rust toolchain.
FROM rust:1.97.1-slim-trixie@sha256:8e8cf8f7fd54a2d23d5a743b3a03f56e26b6c774276c33fa0595111704ebb15c AS rust-wasm
# binaryen publishes version_116 for x86_64 Linux only, so an arm64 build takes
# trixie's binaryen package instead: a later wasm-opt that accepts the same
# flags.
ARG BINARYEN_VERSION=version_116
ARG TARGETARCH
RUN apt-get update \
  && case "$TARGETARCH" in \
    amd64) \
      apt-get install -y --no-install-recommends curl \
      && curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/binaryen-${BINARYEN_VERSION}-x86_64-linux.tar.gz" \
        | tar -xz -C /opt \
      && ln -s "/opt/binaryen-${BINARYEN_VERSION}/bin/wasm-opt" /usr/local/bin/wasm-opt ;; \
    *) apt-get install -y --no-install-recommends binaryen ;; \
  esac \
  && rm -rf /var/lib/apt/lists/*
COPY --from=base /usr/local/bin/bun /usr/local/bin/bun

# ---- DSP (Rust → WebAssembly) ------------------------------------------------
# The crate builds once here and later stages copy pkg/. The base image's
# toolchain matches packages/dsp/rust/rust-toolchain.toml, which leaves rustup
# only the wasm32 target and two components to add.
FROM rust-wasm AS build-dsp
WORKDIR /app/packages/dsp
COPY packages/dsp/rust/rust-toolchain.toml rust/
RUN cd rust && rustup toolchain install --no-self-update
COPY packages/dsp/package.json ./
COPY packages/dsp/scripts ./scripts
COPY packages/dsp/rust ./rust
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/packages/dsp/rust/target \
    bun scripts/build.ts && cp -r pkg /pkg

# ---- dit (Rust → WebAssembly) ------------------------------------------------
# packages/dit is a Cargo workspace, so every member's manifest is copied (the
# whole crates tree) for the workspace to resolve, even though only dit-wasm is
# built.
FROM rust-wasm AS build-dit
WORKDIR /app/packages/dit
COPY packages/dit/rust-toolchain.toml ./
RUN rustup toolchain install --no-self-update
COPY packages/dit/package.json packages/dit/Cargo.toml packages/dit/Cargo.lock ./
COPY packages/dit/scripts ./scripts
COPY packages/dit/crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/packages/dit/target \
    bun scripts/build-wasm.ts && cp -r pkg /pkg

# ---- Dependencies -----------------------------------------------------------
# Manifests alone, so this layer is reused whenever source changes but the
# dependency set does not. Lifecycle scripts are skipped altogether —
# nothing either build needs is produced by one.
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/api/package.json packages/api/
COPY packages/dit/package.json packages/dit/
COPY packages/dsp/package.json packages/dsp/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/media/package.json packages/media/
COPY packages/security-headers/package.json packages/security-headers/
COPY packages/session-diff/package.json packages/session-diff/
COPY packages/settings/package.json packages/settings/
COPY packages/test/package.json packages/test/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,target=/bun-cache \
    bun install --frozen-lockfile --ignore-scripts

# ---- API build --------------------------------------------------------------
# One bundle per entry point (the server and the migrator), dependencies left
# external so the runtime tree below resolves them.
FROM deps AS build-api
COPY apps/server apps/server
RUN cd apps/server && bun run build

# ---- API types --------------------------------------------------------------
# The client compiles against packages/api/src/v1.d.ts, which is generated from
# the server's OpenAPI document and never committed. Generation imports the
# server, whose env module refuses to load without a session secret and a
# 32-byte notes key; typegen signs and encrypts nothing, so throwaway random
# values do, generated in this one command and gone with it. A random secret
# passes Better Auth's strength check, which a fixed short one would warn about
# in every build. MCP stays off: the OAuth provider reads its tables when
# the auth instance is built, and there is no database.
FROM deps AS typegen
COPY apps/server apps/server
COPY packages/api packages/api
COPY packages/dsp packages/dsp
COPY --from=build-dsp /pkg packages/dsp/pkg
COPY packages/dit/src packages/dit/src
COPY packages/media packages/media
COPY packages/security-headers packages/security-headers
COPY packages/session-diff packages/session-diff
COPY packages/settings packages/settings
RUN cd apps/server && \
    BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
    NOTES_MASTER_KEY="$(openssl rand -base64 32)" \
    MCP_DISABLED=1 \
    bun scripts/generate-api.ts

# ---- Web build --------------------------------------------------------------
FROM deps AS build-web

# No build args: nothing about where the image is served is known here. The
# browser only ever calls its own origin, the API's address is the container's
# INTERNAL_API_URL, read at start-up, and the public origin and scheme come
# from each request, so one image serves any hostname.
ENV NEXT_TELEMETRY_DISABLED=1

COPY packages/api packages/api
COPY --from=typegen /app/packages/api/src/v1.d.ts packages/api/src/v1.d.ts
COPY packages/dsp packages/dsp
COPY --from=build-dsp /pkg packages/dsp/pkg
COPY packages/security-headers packages/security-headers
COPY packages/session-diff packages/session-diff
COPY packages/settings packages/settings
COPY packages/typescript-config packages/typescript-config
COPY packages/ui packages/ui
COPY apps/client apps/client
RUN cd apps/client && bun run build

# ---- Runtime dependencies ---------------------------------------------------
# The server's production tree on its own: its manifest plus the manifest of
# every workspace it declares. `@workspace/dsp`, `@workspace/media`,
# `@workspace/security-headers`, `@workspace/session-diff` and `@workspace/settings` are runtime
# dependencies; the rest are dev-only, but Bun refuses a pruned checkout that
# lacks one.
# Omitting devDependencies drops drizzle-kit and TypeScript; omitting peers
# drops `next` and `drizzle-kit` again, which better-auth's adapters name as
# optional peers and the lockfile would otherwise resolve. The server's
# postinstall builds wordpos's WordNet index here, so the data arrives ready.
FROM base AS prod-deps
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/server/scripts/ensure-wordnet-index.mjs apps/server/scripts/
COPY packages/dit/package.json packages/dit/
COPY packages/dsp/package.json packages/dsp/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/media/package.json packages/media/
COPY packages/security-headers/package.json packages/security-headers/
COPY packages/session-diff/package.json packages/session-diff/
COPY packages/settings/package.json packages/settings/
COPY packages/test/package.json packages/test/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN --mount=type=cache,target=/bun-cache \
    bun install --frozen-lockfile --omit=dev --omit=peer

# ---- API image --------------------------------------------------------------
FROM mwader/static-ffmpeg:8.1@sha256:6fb848850b647688910ccf88112a96afe5ee46bcd54ee41daf875cac98b02bff AS static-ffmpeg

FROM base AS api
LABEL org.opencontainers.image.title="Projammr API" \
      org.opencontainers.image.description="Hono REST API on Bun, with a static ffmpeg build"

# postgresql-client-17 gives the migrator `pg_dump` for its pre-migrate
# backup; trixie's own repos carry the version matching the `db` service's
# postgres:17 image, so no extra apt source is needed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*

# The server only runs `ffmpeg`, so that one self-contained binary is all that
# is copied from the static build; Debian's package would pull in a desktop's
# worth of shared libraries.
COPY --from=static-ffmpeg /ffmpeg /usr/local/bin/ffmpeg

# ffmpeg resolves on PATH.
ENV NODE_ENV=production \
    FFMPEG_PATH=ffmpeg

# The server reads ./static and ./src/db/migrations relative to its working
# directory. The dependency store and the server's links into it keep their
# relative layout, and the tree carries data as well as code:
# cmu-pronouncing-dictionary is the whole pronouncing dictionary and wordnet-db
# the WordNet database that wordpos reads by path. Nothing in it may be pruned
# as "unused" — no import names those files.
WORKDIR /app/apps/server
COPY --from=prod-deps --chown=bun:bun /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=bun:bun /app/apps/server/node_modules ./node_modules
# The bundle leaves workspace packages external, and each ships as TypeScript
# source, so the server's links into them need that source at runtime.
# `@workspace/dsp` needs pkg/dsp.wasm beside it too; its Bun host finds the
# module relative to its own source file. A package with dependencies of its
# own needs its node_modules as well: the install is isolated, so its links
# into the store (zod, for `@workspace/settings`) live only there.
COPY --chown=bun:bun packages/dsp /app/packages/dsp
COPY --from=build-dsp --chown=bun:bun /pkg /app/packages/dsp/pkg
# `@workspace/dit` is the same: its source, and pkg/dit.wasm from `build-dit`.
# Its Rust workspace and scripts stay out of the image.
COPY --chown=bun:bun packages/dit/package.json /app/packages/dit/package.json
COPY --chown=bun:bun packages/dit/src /app/packages/dit/src
COPY --from=build-dit --chown=bun:bun /pkg /app/packages/dit/pkg
COPY --chown=bun:bun packages/media /app/packages/media
COPY --chown=bun:bun packages/security-headers /app/packages/security-headers
COPY --chown=bun:bun packages/session-diff /app/packages/session-diff
COPY --chown=bun:bun packages/settings /app/packages/settings
COPY --from=prod-deps --chown=bun:bun /app/packages/settings/node_modules /app/packages/settings/node_modules
COPY --from=build-api --chown=bun:bun /app/apps/server/package.json ./
COPY --from=build-api --chown=bun:bun /app/apps/server/dist ./dist
COPY --from=build-api --chown=bun:bun /app/apps/server/src/db/migrations ./src/db/migrations
COPY --chown=bun:bun --chmod=755 apps/server/docker-entrypoint.sh ./
# Uploads live under ./static and pre-migrate dumps under ./backups, both
# compose volumes. The directories exist and belong to the runtime user so a
# fresh volume inherits them.
RUN install -d -o bun -g bun static static/assets static/images static/analysis backups

# The version `/api/instance` and `/api/health` report. A release build passes
# it; empty falls back to the version in the server's package.json above. Last,
# so a new version rebuilds no layer before it.
ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION

USER bun
EXPOSE 8080
# The health route answers 503 while the database is unreachable, which keeps
# `web` waiting on `service_healthy` until the API can actually serve.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]

# ---- Web image --------------------------------------------------------------
FROM base AS web
LABEL org.opencontainers.image.title="Projammr web" \
      org.opencontainers.image.description="Next.js client on Bun"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# The traced standalone bundle omits the static assets and the public files by
# design; both go where the standalone server expects them.
COPY --from=build-web --chown=bun:bun /app/apps/client/.next/standalone ./
COPY --from=build-web --chown=bun:bun /app/apps/client/.next/static ./apps/client/.next/static
COPY --from=build-web --chown=bun:bun /app/apps/client/public ./apps/client/public

USER bun
EXPOSE 3000
WORKDIR /app/apps/client
# Probed through the /api rewrite, so "healthy" means the client is up and
# can reach the API.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.js"]
