#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

network="exagram-image-smoke-$$"
postgres_container="exagram-image-smoke-postgres-$$"
api_container="exagram-image-smoke-api-$$"
worker_container="exagram-image-smoke-worker-$$"
usercontent_container="exagram-image-smoke-usercontent-$$"
web_container="exagram-image-smoke-web-$$"
containers=("$postgres_container" "$api_container" "$worker_container" "$usercontent_container" "$web_container")
api_image="exagram-api:smoke-$$"
worker_image="exagram-worker:smoke-$$"
usercontent_image="exagram-usercontent:smoke-$$"
web_image="exagram-web:smoke-$$"
migrate_image="exagram-migrate:smoke-$$"
deploy_image="exagram-deploy:smoke-$$"
deploy_pinned_image="exagram-deploy:smoke-pinned-$$"
smoke_images=("$api_image" "$worker_image" "$usercontent_image" "$web_image" "$migrate_image" "$deploy_image"
	"$deploy_pinned_image")
# One objects volume for all three apps, as in Self-hosted; a fresh volume also proves the image's
# /var/lib/exagram/objects starts owned by the app user.
objects_volume="exagram-image-smoke-objects-$$"
smoke_dir="$(mktemp -d)"

cleanup() {
	for container in "${containers[@]}"; do
		docker rm -f "$container" >/dev/null 2>&1 || true
	done
	docker network rm "$network" >/dev/null 2>&1 || true
	docker volume rm "$objects_volume" >/dev/null 2>&1 || true
	rm -rf "$smoke_dir"
	for image in "${smoke_images[@]}"; do
		docker image rm "$image" >/dev/null 2>&1 || true
	done
}
trap cleanup EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

if ! docker network create "$network" >/dev/null; then
	fail "could not create network $network"
fi
if ! docker volume create "$objects_volume" >/dev/null; then
	fail "could not create volume $objects_volume"
fi

postgres_password="$(openssl rand -hex 32)"
usercontent_token_secret="$(openssl rand -hex 32)"
upload_token_secret="$(openssl rand -hex 32)"
oidc_cookie_keys="$(openssl rand -hex 32)"

if ! docker run -d \
	--name "$postgres_container" \
	--network "$network" \
	-e POSTGRES_USER=exagram \
	-e "POSTGRES_PASSWORD=$postgres_password" \
	-e POSTGRES_DB=exagram \
	postgres:18 >/dev/null; then
	fail "could not start PostgreSQL"
fi

for ((try = 1; try <= 60; try++)); do
	if docker exec "$postgres_container" pg_isready -U exagram -d exagram >/dev/null 2>&1; then
		echo "PASS postgres readiness"
		break
	fi
	if ((try == 60)); then
		fail "PostgreSQL did not become ready after 60 attempts"
	fi
	sleep 1
done

database_url="postgres://exagram:${postgres_password}@${postgres_container}:5432/exagram?sslmode=disable&search_path=exagram%2Cpublic"
migrate_database_url="postgres://exagram:${postgres_password}@${postgres_container}:5432/exagram?sslmode=disable&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"

if ! oidc_jwks="$(docker run --rm node:24.16-alpine node -e '
const { generateKeyPairSync, randomUUID } = require("node:crypto")
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const jwk = privateKey.export({ format: "jwk" })
process.stdout.write(JSON.stringify({ keys: [{ ...jwk, kid: randomUUID(), use: "sig", alg: "RS256" }] }))
')"; then
	fail "JWKS generation failed"
fi

api_env=(
	-e NODE_ENV=production
	-e LOG_LEVEL=info
	-e HTTP_PORT=3000
	-e SHUTDOWN_TIMEOUT_SEC=30
	-e API_ORIGIN=https://app.example.test
	-e WEB_ORIGIN=https://app.example.test
	-e USERCONTENT_ORIGIN=https://usercontent.example.test
	-e CLIENT_IP_HEADER=none
	-e "DATABASE_URL=$database_url"
	-e "DATABASE_PLAINTEXT_HOSTS=$postgres_container"
	-e SESSION_COOKIE_SECURE=true
	-e "USERCONTENT_TOKEN_SECRET=$usercontent_token_secret"
	-e STORAGE_DRIVER=filesystem
	-e STORAGE_DIR=/var/lib/exagram/objects
	-e "UPLOAD_TOKEN_SECRET=$upload_token_secret"
	-e "OIDC_COOKIE_KEYS=$oidc_cookie_keys"
	-e "OIDC_JWKS=$oidc_jwks"
	-e MCP_RATE_LIMIT_PER_MINUTE=60
)

worker_env=(
	-e NODE_ENV=production
	-e LOG_LEVEL=info
	-e WEB_ORIGIN=https://app.example.test
	-e LINK_ORIGIN=https://api.example.test
	-e "DATABASE_URL=$database_url"
	-e "DATABASE_PLAINTEXT_HOSTS=$postgres_container"
	-e STORAGE_DRIVER=filesystem
	-e STORAGE_DIR=/var/lib/exagram/objects
)

usercontent_env=(
	-e NODE_ENV=production
	-e LOG_LEVEL=info
	-e HTTP_PORT=3002
	-e "DATABASE_URL=$database_url"
	-e "DATABASE_PLAINTEXT_HOSTS=$postgres_container"
	-e "USERCONTENT_TOKEN_SECRET=$usercontent_token_secret"
	-e USERCONTENT_FRAME_ANCESTORS=https://app.example.test
	-e STORAGE_DRIVER=filesystem
	-e STORAGE_DIR=/var/lib/exagram/objects
)

build_image() {
	local app=$1
	local image=$2
	local smoke_build_args=${SMOKE_BUILD_ARGS:-}

	echo "Building $app image"
	if [[ -n "$smoke_build_args" ]]; then
		read -r -a build_args <<<"$smoke_build_args"
		if ! docker buildx build --load "${build_args[@]}" --target "$app" -t "$image" .; then
			fail "$app image build failed"
		fi
	else
		if ! docker build --target "$app" -t "$image" .; then
			fail "$app image build failed"
		fi
	fi
	echo "PASS $app image build"
}

assert_runtime() {
	local container=$1
	local image=$2
	local configured_user
	local command
	local running
	local bin_listing
	local source_listing

	if ! configured_user="$(docker image inspect --format '{{.Config.User}}' "$image")"; then
		fail "$image could not be inspected for Config.User"
	fi
	if [[ "$configured_user" != "1000" ]]; then
		fail "$image Config.User is $configured_user, expected 1000"
	fi
	if ! command="$(docker image inspect --format '{{index .Config.Cmd 0}}' "$image")"; then
		fail "$image could not be inspected for Config.Cmd[0]"
	fi
	if [[ "$command" != "node" ]]; then
		fail "$image Config.Cmd[0] is $command, expected node"
	fi
	if ! running="$(docker inspect --format '{{.State.Running}}' "$container")"; then
		fail "$container could not be inspected for running state"
	fi
	if [[ "$running" != "true" ]]; then
		docker logs "$container" >&2 || true
		fail "$container is not running"
	fi
	if ! bin_listing="$(docker exec "$container" sh -c 'if [ -d /app/node_modules/.bin ]; then ls /app/node_modules/.bin; fi')"; then
		fail "$container could not list production dependency binaries"
	fi
	for tool in tsup vitest typescript; do
		if grep -Fxq "$tool" <<<"$bin_listing"; then
			fail "$container includes development binary $tool"
		fi
	done
	if docker exec "$container" sh -c 'test -e /app/src'; then
		fail "$container includes /app/src"
	fi
	# Public images ship bundled JS only: no source maps of ours, and no @exagram/* package source.
	if ! source_listing="$(docker exec "$container" sh -c "ls /app/dist/*.map 2>/dev/null; grep -l sourceMappingURL /app/dist/*.js 2>/dev/null; find /app -iname '*exagram*'")"; then
		fail "$container could not be checked for shipped source"
	fi
	if [[ -n "$source_listing" ]]; then
		fail "$container ships source: $(head -3 <<<"$source_listing")"
	fi
	echo "PASS $container runtime user/cmd/prod-deps"
}

poll_readiness() {
	local container=$1
	local port=$2

	for ((try = 1; try <= 60; try++)); do
		if docker exec "$container" node -e "fetch('http://127.0.0.1:${port}/readiness').then(async (response) => { const body = await response.text(); if (response.status !== 200 || body !== 'OK') process.exit(1) }).catch(() => process.exit(1))" >/dev/null 2>&1; then
			echo "PASS $container readiness"
			return
		fi
		if ((try < 60)); then sleep 1; fi
	done
	docker logs "$container" >&2 || true
	fail "$container readiness did not return 200 OK after 60 attempts"
}

# The migrate image carries its migrations; no source checkout is mounted.
build_image migrate "$migrate_image"
if ! docker run --rm \
	--network "$network" \
	"$migrate_image" \
	-path=/migrations \
	-database "$migrate_database_url" \
	-verbose up; then
	fail "database migrations failed"
fi
echo "PASS migrations from the migrate image"

build_image api "$api_image"
if ! docker run -d \
	--name "$api_container" \
	--network "$network" \
	--network-alias api \
	--read-only \
	--user 1000 \
	-v "$objects_volume:/var/lib/exagram/objects" \
	"${api_env[@]}" \
	"$api_image" >/dev/null; then
	fail "could not start api container"
fi
assert_runtime "$api_container" "$api_image"
poll_readiness "$api_container" 3000
if ! docker exec "$api_container" sh -c 'probe=/var/lib/exagram/objects/.smoke-write && touch "$probe" && rm "$probe"'; then
	fail "$api_container cannot write its objects volume as the app user"
fi
echo "PASS $api_container objects volume writable"

build_image usercontent "$usercontent_image"
if ! docker run -d \
	--name "$usercontent_container" \
	--network "$network" \
	--network-alias usercontent \
	--read-only \
	--user 1000 \
	-v "$objects_volume:/var/lib/exagram/objects" \
	"${usercontent_env[@]}" \
	"$usercontent_image" >/dev/null; then
	fail "could not start usercontent container"
fi
assert_runtime "$usercontent_container" "$usercontent_image"
poll_readiness "$usercontent_container" 3002

build_image worker "$worker_image"
if ! docker run -d \
	--name "$worker_container" \
	--network "$network" \
	--read-only \
	--user 1000 \
	-v "$objects_volume:/var/lib/exagram/objects" \
	"${worker_env[@]}" \
	"$worker_image" >/dev/null; then
	fail "could not start worker container"
fi
assert_runtime "$worker_container" "$worker_image"
sleep 10
if ! worker_running="$(docker inspect --format '{{.State.Running}}' "$worker_container")"; then
	fail "worker container could not be inspected after 10 seconds"
fi
if [[ "$worker_running" != "true" ]]; then
	docker logs "$worker_container" >&2 || true
	fail "worker container stopped before the 10-second check"
fi
if ! docker logs "$worker_container" 2>&1 | grep -Fq 'worker:start'; then
	docker logs "$worker_container" >&2 || true
	fail "worker logs did not contain worker:start"
fi
echo "PASS $worker_container running after 10s with worker:start"

# The web image: Caddy with the SPA. Both TLS modes must load; the external one is run, as plain HTTP
# answering by Host, in front of the api and usercontent containers above.
build_image web "$web_image"
web_env=(-e APP_HOST=app.example.test -e UC_HOST=usercontent.example.test)
external_env=(-e EXAGRAM_TLS=external -e EXAGRAM_SITE_SCHEME=http:// -e EXAGRAM_CLIENT_IP_HEADER=X-Forwarded-For)
if ! docker run --rm "${web_env[@]}" -e ACME_EMAIL=smoke@example.test "$web_image" \
	caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
	fail "web image Caddyfile does not validate with ACME TLS"
fi
echo "PASS web Caddyfile validates (acme)"
if ! docker run --rm "${web_env[@]}" "${external_env[@]}" "$web_image" \
	caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
	fail "web image Caddyfile does not validate with external TLS"
fi
echo "PASS web Caddyfile validates (external)"
if ! docker run -d --name "$web_container" --network "$network" "${web_env[@]}" "${external_env[@]}" \
	"$web_image" >/dev/null; then
	fail "could not start web container"
fi
web_get() {
	docker exec "$web_container" wget -q -S -O - --header "Host: $1" "http://127.0.0.1$2" 2>&1
}
for ((try = 1; try <= 30; try++)); do
	if [[ "$(docker exec "$web_container" wget -q -O - --header 'Host: app.example.test' \
		http://127.0.0.1/readiness 2>/dev/null)" == OK ]]; then
		echo "PASS web proxies /readiness to the api"
		break
	fi
	if ((try == 30)); then
		docker logs "$web_container" >&2 || true
		fail "web did not proxy /readiness to the api"
	fi
	sleep 1
done
meta='<meta name="exagram-usercontent-origin" content="https://usercontent.example.test" />'
for path in / /artifacts/00000000-0000-4000-8000-000000000000; do
	if ! response="$(web_get app.example.test "$path")"; then
		fail "web GET $path failed: $response"
	fi
	if ! grep -Fq "$meta" <<<"$response"; then
		fail "web GET $path does not name the usercontent origin"
	fi
	if ! grep -iq 'Cache-Control: no-store' <<<"$response"; then
		fail "web GET $path is cacheable"
	fi
done
echo "PASS web renders the usercontent origin into index.html, uncached"

# The install bundle: what `docker run --rm <image> | tar x` writes.
build_image deploy "$deploy_image"
if ! docker run --rm "$deploy_image" >"$smoke_dir/bundle.tar"; then
	fail "deploy image did not write a tar"
fi
bundle_listing="$(tar -tf "$smoke_dir/bundle.tar" | sort)"
for file in exagram/compose.yml exagram/compose.postgres.yml exagram/compose.db-ca.yml \
	exagram/compose.tls-external.yml exagram/.env.example exagram/gen-secrets.sh exagram/verify.sh exagram/smoke.sh exagram/VERSION; do
	if ! grep -Fxq "$file" <<<"$bundle_listing"; then
		fail "bundle lacks $file"
	fi
done
if grep -Eq '(^|/)\.env$' <<<"$bundle_listing"; then
	fail "bundle contains a .env"
fi
mkdir -p "$smoke_dir/local"
tar -xf "$smoke_dir/bundle.tar" -C "$smoke_dir/local"
if [[ "$(cat "$smoke_dir/local/exagram/VERSION")" != local ]]; then
	fail "unpinned bundle VERSION is $(cat "$smoke_dir/local/exagram/VERSION")"
fi
if [[ ! -x "$smoke_dir/local/exagram/gen-secrets.sh" || ! -x "$smoke_dir/local/exagram/verify.sh" ||
	! -x "$smoke_dir/local/exagram/smoke.sh" ]]; then
	fail "bundle scripts are not executable"
fi
echo "PASS deploy bundle contents"

# A release build pins every image to version@digest (release-selfhost.yml passes the real digests).
fake_digest() {
	printf '%s' "$1" | openssl dgst -sha256 -r | cut -d' ' -f1
}
fake_digests=""
for name in api worker usercontent web migrate; do
	fake_digests+="$name=sha256:$(fake_digest "$name") "
done
if ! docker build --target deploy --build-arg EXAGRAM_VERSION=v0.0.0-smoke \
	--build-arg "IMAGE_DIGESTS=$fake_digests" -t "$deploy_pinned_image" .; then
	fail "pinned deploy image build failed"
fi
if docker build --target deploy --build-arg EXAGRAM_VERSION=v0.0.0-smoke --build-arg "IMAGE_DIGESTS=api=sha256:00" \
	. >/dev/null 2>&1; then
	fail "deploy image built with a missing digest"
fi
mkdir -p "$smoke_dir/pinned"
docker run --rm "$deploy_pinned_image" | tar -xf - -C "$smoke_dir/pinned"
if ! pinned_images="$(cd "$smoke_dir/pinned/exagram" &&
	docker compose --env-file .env.example -f compose.yml -f compose.postgres.yml -f compose.tls-external.yml \
		config --images)"; then
	fail "pinned bundle's compose.yml does not render"
fi
for name in api worker usercontent web migrate; do
	want="ghcr.io/cleverse/exagram-$name:v0.0.0-smoke@sha256:$(fake_digest "$name")"
	if ! grep -Fxq "$want" <<<"$pinned_images"; then
		fail "pinned bundle lacks $want: $pinned_images"
	fi
done
if grep -q 'ghcr.io/cleverse/' <<<"$(grep -v '@sha256:' <<<"$pinned_images")"; then
	fail "pinned bundle has an unpinned image: $pinned_images"
fi
if [[ "$(cat "$smoke_dir/pinned/exagram/VERSION")" != v0.0.0-smoke ]]; then
	fail "pinned bundle VERSION is $(cat "$smoke_dir/pinned/exagram/VERSION")"
fi
echo "PASS deploy bundle pins every image to version@digest"

echo "PASS image smoke"
