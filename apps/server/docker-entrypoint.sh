#!/bin/sh
# Applies pending migrations, then hands the process over to the API so it is
# the one that receives the container's signals.
set -eu

echo "[api] applying migrations"
bun dist/db/migrate.js

echo "[api] starting on :8080"
exec bun dist/server.js
