#!/usr/bin/env bash
# Proves the chain applies to an empty database and reverses, twice, against a throwaway container.
set -euo pipefail

MIGRATE_IMAGE="${MIGRATE_IMAGE:-migrate/migrate:latest}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/database/postgres/migrations"
COUNT="$(find "$MIGRATIONS_DIR" -name '*.up.sql' | wc -l | tr -d ' ')"
CONTAINER="exagram-roundtrip-$$"
PORT="${ROUNDTRIP_PORT:-55432}"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$CONTAINER" -p "$PORT:5432" \
	-e POSTGRES_USER=exagram -e POSTGRES_PASSWORD=exagram -e POSTGRES_DB=exagram \
	postgres:18 >/dev/null

until docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U exagram -d exagram >/dev/null 2>&1; do sleep 1; done

# golang-migrate needs search_path to name a schema that already exists at connection open time,
# but `exagram` doesn't exist until 000001 runs; the migrations are fully-qualified so the CLI
# never needs it.
URL="postgres://exagram:exagram@host.docker.internal:$PORT/exagram?sslmode=disable&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"

run() {
	docker run --rm --add-host=host.docker.internal:host-gateway \
		-v "$MIGRATIONS_DIR:/migrations" "$MIGRATE_IMAGE" \
		-path=/migrations -database "$URL" "$@"
}

for _ in 1 2; do
	run up
	run down -all
done
run up

echo "roundtrip x2 ok ($COUNT migrations)"
