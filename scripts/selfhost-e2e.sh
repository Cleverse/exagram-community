#!/usr/bin/env bash
set -euo pipefail

# End-to-end run of deploy/ as a Self-hosted operator would, one compose project per case:
#
#   A    bundled Postgres + filesystem store
#   B    external Postgres 18 over TLS (private CA, verify-full, non-superuser owner) + filesystem
#   C    bundled Postgres + external S3-compatible store
#   G    B's database + C's store
#   E    external TLS (compose.tls-external.yml): both hosts as plain HTTP on one loopback port, as a
#        tunnel or TLS-terminating proxy sees them; routing by Host, unbuffered SSE, and the client
#        address taken from Cf-Connecting-Ip
#   C0   Community: A's flow without a Workspace name, then edition, null detector and 404 checks
#   NEG  gen-secrets refuses plaintext/require URLs; preflight stops a hand-edited .env before migrate
#
# Usage: scripts/selfhost-e2e.sh [A] [B] [C] [G] [E] [NEG] [C0]   (default: all but C0)
#
# Needs Docker with host.docker.internal (Docker Desktop, OrbStack), host ports (E2E_HTTP_PORT, E2E_HTTPS_PORT),
# E2E_PG_PORT (55432) and E2E_S3_PORT (59000) free, and node, jq, openssl, curl on PATH. The images
# are built once from the working tree (deploy/compose.build.yml). Cases A to G sign up, upload a PDF
# through the public origin like the browser, wait for parse and redact, read it back through
# usercontent, then run deploy/verify.sh. Their Caddy uses `local_certs` from a temp copy of the
# Caddyfile mounted over the image's; the shipped one is untouched.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_dir="$root_dir/deploy"
e2e_dir="$root_dir/scripts/selfhost-e2e"

app_host=app.e2e.test
uc_host=uc.e2e.test
origin="https://$app_host"
pg_port=${E2E_PG_PORT:-55432}
s3_port=${E2E_S3_PORT:-59000}
# Where the external Postgres and store publish their ports on the host. Loopback by default; set
# 0.0.0.0 if your Docker's host.docker.internal can't reach host loopback.
publish_addr=${E2E_PUBLISH_ADDR:-127.0.0.1}
http_port="${E2E_HTTP_PORT:-8080}"
https_port="${E2E_HTTPS_PORT:-8443}"
minio_image=${E2E_MINIO_IMAGE:-cgr.dev/chainguard/minio@sha256:4692462f35d97d7e82c30371d82f057703c5d9489bcae726010594c812f2d285}
pg_container=exagram-e2e-pg
minio_container=exagram-e2e-minio

cases=("$@")
if [[ ${#cases[@]} -eq 0 ]]; then
	cases=(A B C G E NEG)
fi
for c in "${cases[@]}"; do
	case "$c" in
	A | B | C | G | E | NEG | C0) ;;
	*)
		echo "unknown case: $c (expected A B C G E NEG C0)" >&2
		exit 2
		;;
	esac
done

for bin in docker node jq openssl curl cmp; do
	command -v "$bin" >/dev/null 2>&1 || {
		echo "FAIL: $bin not found on PATH" >&2
		exit 1
	}
done

check_ports() {
	if ! command -v lsof >/dev/null 2>&1; then
		return 0
	fi
	for port in "$http_port" "$https_port"; do
		if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
			echo "FAIL: host port $port is in use; set E2E_HTTP_PORT/E2E_HTTPS_PORT" >&2
			exit 1
		fi
	done
}

check_ports

work=$(mktemp -d "${TMPDIR:-/tmp}/selfhost-e2e.XXXXXX")
failures=0
failed_cases=()

# The project the trap tears down; set while a case's stack exists.
current_project=""
current_env=""
export COMPOSE_FILE=""

pass() { echo "PASS: $*"; }
fail() {
	echo "FAIL: $*" >&2
	failures=$((failures + 1))
}

# step NAME CMD...: PASS/FAIL line; returns the command's status.
step() {
	local name=$1
	shift
	if "$@"; then
		pass "$name"
	else
		fail "$name"
		return 1
	fi
}

dc() {
	(cd "$deploy_dir" && docker compose -p "$current_project" --env-file "$current_env" "$@")
}

teardown() {
	if [[ -n "$current_project" ]]; then
		dc down -v --remove-orphans >/dev/null 2>&1 || true
		current_project=""
	fi
}

remove_externals() {
	docker rm -fv "$pg_container" "$minio_container" >/dev/null 2>&1 || true
}

cleanup() {
	# bash 3.2 runs this trap with $? = 0 after a `set -u` abort, so a run that never reached the end fails here.
	local status=$?
	[[ "$status" -ne 0 || "$completed" == true ]] || status=1
	teardown
	remove_externals
	if [[ "$failures" -eq 0 && "$status" -eq 0 ]]; then
		rm -rf "$work"
	else
		echo "work dir kept: $work" >&2
	fi
	exit "$status"
}
completed=false
trap cleanup EXIT

dump_logs() {
	local file="$work/$1-logs.txt"
	dc logs --no-color >"$file" 2>&1 || true
	dc ps --all >>"$file" 2>&1 || true
	echo "logs: $file" >&2
}

# env_value FILE KEY: the single-quoted value gen-secrets.sh wrote.
env_value() {
	sed -n "s/^$2='\\(.*\\)'\$/\\1/p" "$1"
}

sha256_of() {
	openssl dgst -sha256 -r "$1" | cut -d' ' -f1
}

# --- External Postgres (B, G) ------------------------------------------------------------------

pg_password=""

make_pg_certs() {
	local dir="$work/pg-certs"
	mkdir -p "$dir"
	openssl req -x509 -new -nodes -newkey rsa:2048 -days 2 -subj "/CN=exagram-e2e-ca" \
		-addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
		-keyout "$dir/ca.key" -out "$dir/ca.pem" 2>/dev/null &&
		openssl req -new -nodes -newkey rsa:2048 -subj "/CN=host.docker.internal" \
			-keyout "$dir/server.key" -out "$dir/server.csr" 2>/dev/null &&
		printf '%s\n' "subjectAltName=DNS:host.docker.internal" "basicConstraints=CA:FALSE" \
			"keyUsage=critical,digitalSignature,keyEncipherment" "extendedKeyUsage=serverAuth" >"$dir/server.ext" &&
		openssl x509 -req -in "$dir/server.csr" -CA "$dir/ca.pem" -CAkey "$dir/ca.key" -CAcreateserial -days 2 \
			-extfile "$dir/server.ext" -out "$dir/server.crt" 2>/dev/null &&
		chmod 644 "$dir/ca.pem" "$dir/server.crt" "$dir/server.key"
}

start_pg() {
	docker rm -fv "$pg_container" >/dev/null 2>&1 || true
	local superuser_password
	superuser_password=$(openssl rand -hex 16)
	pg_password=$(openssl rand -hex 16)
	make_pg_certs || return 1
	# Postgres refuses a key it doesn't own with mode 0600, so the certs are copied out of the
	# read-only mount and fixed up before the stock entrypoint runs.
	docker run -d --name "$pg_container" \
		-e POSTGRES_PASSWORD="$superuser_password" \
		-p "$publish_addr:$pg_port:5432" \
		-v "$work/pg-certs:/certs-src:ro" \
		--entrypoint sh postgres:18 -c '
			set -e
			mkdir -p /etc/postgresql-tls
			cp /certs-src/server.crt /certs-src/server.key /etc/postgresql-tls/
			chown -R postgres:postgres /etc/postgresql-tls
			chmod 600 /etc/postgresql-tls/server.key
			exec docker-entrypoint.sh postgres -c ssl=on \
				-c ssl_cert_file=/etc/postgresql-tls/server.crt -c ssl_key_file=/etc/postgresql-tls/server.key
		' >/dev/null || return 1
	# TCP only answers once the real server is up; the init-time server listens on the socket only.
	local try
	for ((try = 1; try <= 60; try++)); do
		if docker exec "$pg_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
			break
		fi
		if ((try == 60)); then
			docker logs "$pg_container" >"$work/pg-logs.txt" 2>&1 || true
			echo "postgres never became ready; logs: $work/pg-logs.txt" >&2
			return 1
		fi
		sleep 2
	done
	docker exec "$pg_container" psql -U postgres -v ON_ERROR_STOP=1 -q \
		-c "CREATE ROLE exagram_app LOGIN PASSWORD '$pg_password'" \
		-c "CREATE DATABASE exagram OWNER exagram_app" >/dev/null &&
		[[ "$(docker exec "$pg_container" psql -U postgres -tAc \
			"SELECT rolsuper FROM pg_roles WHERE rolname = 'exagram_app'")" == f ]]
}

pg_app_url() {
	echo "postgres://exagram_app:$pg_password@host.docker.internal:$pg_port/exagram?sslmode=$1&sslrootcert=/certs/db-ca.pem&search_path=exagram%2Cpublic"
}

pg_migrate_url() {
	echo "postgres://exagram_app:$pg_password@host.docker.internal:$pg_port/exagram?sslmode=$1&sslrootcert=/certs/db-ca.pem&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"
}

# --- External S3-compatible store (C, G) -------------------------------------------------------

s3_bucket=exagram-e2e
s3_access_key=""
s3_secret_key=""

start_minio() {
	docker rm -fv "$minio_container" >/dev/null 2>&1 || true
	s3_access_key="e2e$(openssl rand -hex 6)"
	s3_secret_key=$(openssl rand -hex 20)
	docker run -d --name "$minio_container" \
		-e MINIO_ROOT_USER="$s3_access_key" -e MINIO_ROOT_PASSWORD="$s3_secret_key" \
		-p "$publish_addr:$s3_port:9000" \
		"$minio_image" server /tmp/minio-data >/dev/null || return 1
	local try
	for ((try = 1; try <= 60; try++)); do
		if curl -fsS -o /dev/null "http://127.0.0.1:$s3_port/minio/health/live" 2>/dev/null; then
			break
		fi
		if ((try == 60)); then
			docker logs "$minio_container" >"$work/minio-logs.txt" 2>&1 || true
			echo "store never became ready; logs: $work/minio-logs.txt" >&2
			return 1
		fi
		sleep 1
	done
	E2E_S3_ACCESS_KEY_ID="$s3_access_key" E2E_S3_SECRET_ACCESS_KEY="$s3_secret_key" \
		node "$e2e_dir/create-bucket.mjs" "http://127.0.0.1:$s3_port" "$s3_bucket" >/dev/null
}

# --- Compose project ---------------------------------------------------------------------------

# gen_env CASE [VAR=value ...] -- [gen-secrets flags]: writes $work/CASE/.env. --acme-email is added
# unless the flags pick --tls external.
gen_env() {
	local name=$1
	shift
	local vars=()
	while [[ $# -gt 0 && "$1" != -- ]]; do
		vars+=("$1")
		shift
	done
	shift
	local acme=(--acme-email e2e@example.test)
	[[ " $* " != *" --tls external "* ]] || acme=()
	mkdir -p "$work/$name"
	env ${vars[@]+"${vars[@]}"} GEN_SECRETS_ENV_FILE="$work/$name/.env" "$deploy_dir/gen-secrets.sh" \
		--app-host "$app_host" --uc-host "$uc_host" ${acme[@]+"${acme[@]}"} "$@" >/dev/null
}

# write_override CASE [external]: compose.e2e.yml for the case. With Caddy's own TLS, the shipped
# Caddyfile with `local_certs` in the global options, mounted over the image's, and Caddy mapped to
# $http_port/$https_port; external TLS publishes HTTP_BIND itself. On Linux the app containers also
# get host.docker.internal, which Docker Desktop and OrbStack provide already.
write_override() {
	local dir="$work/$1" service services=""
	mkdir -p "$dir"
	if [[ "${2:-}" != external ]]; then
		awk '!done && $0 == "{" { print; print "\tlocal_certs"; print "\tskip_install_trust"; done = 1; next } { print }' \
			"$deploy_dir/Caddyfile" >"$dir/Caddyfile"
		services+="  caddy:
    ports: !override
      - \"$http_port:80\"
      - \"$https_port:443\"
    volumes:
      - $dir/Caddyfile:/etc/caddy/Caddyfile:ro
"
	fi
	if [[ "$(uname -s)" == Linux ]]; then
		for service in preflight migrate api worker usercontent; do
			services+="  $service:
    extra_hosts: [\"host.docker.internal:host-gateway\"]
"
		done
	fi
	# Compose rejects a bare `services:` (null); external TLS on macOS overrides nothing.
	if [[ -z "$services" ]]; then
		echo "services: {}" >"$dir/compose.e2e.yml"
	else
		printf 'services:\n%s' "$services" >"$dir/compose.e2e.yml"
	fi
}

# use_project CASE: point dc at the case's .env, layers (images built from this checkout) and project name.
use_project() {
	current_project="exagram-e2e-$(tr '[:upper:]' '[:lower:]' <<<"$1")"
	current_env="$work/$1/.env"
	COMPOSE_FILE="$(env_value "$current_env" COMPOSE_FILE):compose.build.yml:$work/$1/compose.e2e.yml"
	export COMPOSE_FILE
}

curl_opts=()
set_curl_opts() {
	curl_opts=(
		--connect-to "$app_host:443:127.0.0.1:$https_port" --connect-to "$app_host:80:127.0.0.1:$http_port"
		--connect-to "$uc_host:443:127.0.0.1:$https_port" --cacert "$work/$1/caddy-root.crt"
	)
}

ecurl() {
	curl ${curl_opts[@]+"${curl_opts[@]}"} "$@"
}

wait_ready() {
	local name=$1 try
	# Caddy creates its local CA at startup; the root appears once it has run.
	for ((try = 1; try <= 90; try++)); do
		if dc cp caddy:/data/caddy/pki/authorities/local/root.crt "$work/$name/caddy-root.crt" >/dev/null 2>&1; then
			break
		fi
		((try == 90)) && return 1
		sleep 2
	done
	set_curl_opts "$name"
	for ((try = 1; try <= 60; try++)); do
		if [[ "$(ecurl -fsS "$origin/readiness" 2>/dev/null)" == OK ]]; then
			return 0
		fi
		sleep 2
	done
	return 1
}

# --- Browser-shaped flow -----------------------------------------------------------------------

jar=""
artifact_id=""
revision_id=""
storage_key=""
ticket_json=""
fixture=""

api() {
	local method=$1 path=$2 body=${3:-}
	local out args=(-sS --fail-with-body -b "$jar" -c "$jar" -X "$method" -H "Origin: $origin" -H "Accept: application/json")
	if [[ -n "$body" ]]; then
		args+=(-H "Content-Type: application/json" --data "$body")
	fi
	if ! out=$(ecurl "${args[@]}" "$origin/v1$path"); then
		echo "  $method /v1$path failed: $out" >&2
		return 1
	fi
	printf '%s' "$out"
}

# The Workspace name sign_up sends; C0 clears it, as Community's sign-up page sends none.
signup_workspace="E2E"

sign_up() {
	local out
	out=$(api POST /auth/sign-up "$(jq -nc --arg e "e2e-$(openssl rand -hex 4)@example.test" --arg w "$signup_workspace" \
		'{email: $e, name: "E2E Operator", password: "correct horse battery staple"}
		+ (if $w == "" then {} else {workspaceName: $w} end)')") &&
		[[ "$(jq -r '.result.id' <<<"$out")" =~ ^[0-9a-f-]{36}$ ]]
}

create_artifact() {
	local out bytes
	bytes=$(wc -c <"$fixture" | tr -d ' ')
	out=$(api POST /artifacts "$(jq -nc --argjson b "$bytes" \
		'{kind: "pdf", title: "Self-hosted e2e", projectId: null, mime: "application/pdf", bytes: $b}')") || return 1
	artifact_id=$(jq -r '.result.artifact.id' <<<"$out")
	ticket_json=$(jq -c '.result.ticket' <<<"$out")
	storage_key=$(jq -r '.storageKey' <<<"$ticket_json")
	[[ -n "$artifact_id" && "$artifact_id" != null && -n "$storage_key" && "$storage_key" != null ]]
}

# put_upload [CONTENT_TYPE_OVERRIDE]: PUT the fixture to the ticket URL with exactly its
# requiredHeaders (or one content-type swapped); prints the HTTP status.
put_upload() {
	local url headers=() h
	url=$(jq -r '.url' <<<"$ticket_json")
	while IFS= read -r h; do
		[[ -z "$h" ]] && continue
		if [[ -n "${1:-}" && "$(tr '[:upper:]' '[:lower:]' <<<"${h%%:*}")" == content-type ]]; then
			h="Content-Type: $1"
		fi
		headers+=(-H "$h")
	done < <(jq -r '.requiredHeaders | to_entries[] | "\(.key): \(.value)"' <<<"$ticket_json")
	ecurl -sS -o /dev/null -w '%{http_code}' -X PUT -H "Origin: $origin" ${headers[@]+"${headers[@]}"} \
		--data-binary "@$fixture" "$url"
}

expect_status() {
	local want=$1 got
	shift
	got=$("$@") || true
	if [[ "$got" != "$want" ]]; then
		echo "  status $got, expected $want" >&2
		return 1
	fi
}

finalize() {
	local out
	out=$(api POST "/artifacts/$artifact_id/finalize" "$(jq -nc --arg k "$storage_key" --arg s "$(sha256_of "$fixture")" \
		--argjson b "$(wc -c <"$fixture" | tr -d ' ')" '{storageKey: $k, sha256: $s, bytes: $b, note: null}')") || return 1
	revision_id=$(jq -r '.result.id' <<<"$out")
	[[ "$revision_id" =~ ^[0-9a-f-]{36}$ ]]
}

wait_extraction() {
	local try status
	for ((try = 1; try <= 90; try++)); do
		status=$(api GET "/artifacts/$artifact_id/revisions" |
			jq -r --arg r "$revision_id" '.result.items[] | select(.id == $r) | .extractionStatus') || status=""
		case "$status" in
		done) return 0 ;;
		failed)
			echo "  extraction failed" >&2
			return 1
			;;
		esac
		sleep 2
	done
	echo "  extraction still '$status'" >&2
	return 1
}

wait_redaction() {
	local try status
	if [[ "$(api GET /auth/providers | jq -r '.result.capabilities.redaction')" == false ]]; then
		echo "  this install does not redact; C0 checks the Revision row instead"
		return 0
	fi
	for ((try = 1; try <= 90; try++)); do
		status=$(api GET "/revisions/$revision_id/redacted-text" | jq -r '.result.status') || status=""
		case "$status" in
		done) return 0 ;;
		failed | too_large)
			echo "  redaction $status" >&2
			return 1
			;;
		esac
		sleep 2
	done
	echo "  redaction still '$status'" >&2
	return 1
}

# The web asks the api for a body token, then loads the usercontent URL it names.
read_through_usercontent() {
	local out url name=$1
	out=$(api POST "/$artifact_id/body-token") || return 1
	url=$(jq -r '.result.url' <<<"$out")
	[[ "$url" == "https://$uc_host/"* ]] || {
		echo "  body URL not on $uc_host: $url" >&2
		return 1
	}
	ecurl -fsS -o "$work/$name/served.pdf" "$url" && cmp -s "$fixture" "$work/$name/served.pdf"
}

object_in_volume() {
	dc exec -T api test -s "/var/lib/exagram/objects/$storage_key"
}

run_verify() {
	local name=$1 object_key=${2:-}
	VERIFY_ENV_FILE="$current_env" VERIFY_PROJECT="$current_project" VERIFY_CURL_OPTS="${curl_opts[*]-}" \
		VERIFY_OBJECT_KEY="$object_key" "$deploy_dir/verify.sh" >"$work/$name/verify.txt" 2>&1
	local status=$?
	sed 's/^/  verify: /' "$work/$name/verify.txt"
	if grep -q '^WARN: skipped' "$work/$name/verify.txt"; then
		echo "  verify skipped a check it was given the input for" >&2
		return 1
	fi
	return "$status"
}

# positive_case CASE STORE: STORE is filesystem or s3.
positive_case() {
	local name=$1 store=$2
	write_override "$name"
	use_project "$name"
	jar="$work/$name/cookies.txt"
	: >"$jar"

	# `up` exits non-zero when a one-shot fails; the steps below report what went wrong.
	dc up -d >"$work/$name/up.txt" 2>&1 || cat "$work/$name/up.txt" >&2
	step "$name: stack ready behind Caddy" wait_ready "$name" || return 1
	step "$name: sign up" sign_up || return 1
	step "$name: create Artifact (upload ticket)" create_artifact || return 1
	step "$name: PUT to ticket URL with requiredHeaders" expect_status 200 put_upload || return 1
	if [[ "$store" == filesystem ]]; then
		[[ "$(jq -r '.url' <<<"$ticket_json")" == "$origin/v1/uploads/"* ]] ||
			fail "$name: filesystem ticket URL is $(jq -r '.url' <<<"$ticket_json")"
		step "$name: replayed PUT refused (409)" expect_status 409 put_upload || return 1
		step "$name: PUT with another content-type refused (400)" expect_status 400 put_upload text/plain || return 1
	else
		step "$name: replayed PUT refused (412)" expect_status 412 put_upload || return 1
	fi
	step "$name: finalize with sha256 and size" finalize || return 1
	step "$name: parse finished" wait_extraction || return 1
	step "$name: redaction finished" wait_redaction || return 1
	step "$name: body through usercontent matches the upload" read_through_usercontent "$name" || return 1
	if [[ "$store" == filesystem ]]; then
		step "$name: object in the objects volume" object_in_volume || return 1
		step "$name: deploy/verify.sh" run_verify "$name" || return 1
	else
		step "$name: deploy/verify.sh (with VERIFY_OBJECT_KEY)" run_verify "$name" "$storage_key" || return 1
	fi
}

s3_env() {
	echo "S3_BUCKET=$s3_bucket" "S3_REGION=us-east-1" "S3_ENDPOINT=http://host.docker.internal:$s3_port" \
		"S3_PUBLIC_ENDPOINT=http://localhost:$s3_port" "S3_FORCE_PATH_STYLE=true" \
		"S3_ACCESS_KEY_ID=$s3_access_key" "S3_SECRET_ACCESS_KEY=$s3_secret_key"
}

case_A() {
	step "A: gen-secrets (bundled, filesystem)" gen_env A -- || return 1
	positive_case A filesystem
}

# C0 runs only against a Community build: it asserts the install has no ee surface.
is_community() {
	local out
	out=$(api GET /auth/providers) &&
		[[ "$(jq -r '.result.edition' <<<"$out")" == community ]] &&
		[[ "$(jq '[.result.capabilities[]] | any' <<<"$out")" == false ]]
}

# The null detector stores "" at version 0 and marks the Revision done (P7).
wait_null_detector() {
	local try row=""
	for ((try = 1; try <= 90; try++)); do
		row=$(dc exec -T postgres psql -U exagram -d exagram -tAc \
			"SELECT redaction_status || ':' || coalesce(redaction_detector_version, -1) FROM exagram.revisions WHERE id = '$revision_id'") ||
			row=""
		[[ "$row" == done:0 ]] && return 0
		sleep 2
	done
	echo "  revision row is '$row', expected done:0" >&2
	return 1
}

api_status() {
	ecurl -sS -o /dev/null -w '%{http_code}' -b "$jar" -X "$1" -H "Origin: $origin" -H "Accept: application/json" \
		"$origin/v1$2"
}

case_C0() {
	local signup_workspace=""
	step "C0: gen-secrets (bundled, filesystem)" gen_env C0 -- || return 1
	positive_case C0 filesystem || return 1
	step "C0: auth.providers says community, every capability off" is_community || return 1
	step "C0: the null detector marked the Revision done at version 0" wait_null_detector || return 1
	step "C0: no Redacted Text endpoint (404)" \
		expect_status 404 api_status GET "/revisions/$revision_id/redacted-text" || return 1
}

case_B() {
	step "B: external Postgres 18, TLS, non-superuser owner" start_pg || return 1
	step "B: gen-secrets (external DB + CA, verify-full)" gen_env B \
		DATABASE_URL="$(pg_app_url verify-full)" MIGRATE_DATABASE_URL="$(pg_migrate_url verify-full)" -- \
		--external-db --db-ca-file "$work/pg-certs/ca.pem" || return 1
	positive_case B filesystem
}

case_C() {
	step "C: external S3-compatible store and bucket" start_minio || return 1
	# shellcheck disable=SC2046 # s3_env's words are VAR=value pairs without spaces
	step "C: gen-secrets (bundled DB, s3)" gen_env C $(s3_env) -- --storage s3 --allow-http-s3-endpoint || return 1
	positive_case C s3
}

case_G() {
	step "G: external Postgres 18, TLS, non-superuser owner" start_pg || return 1
	step "G: external S3-compatible store and bucket" start_minio || return 1
	# shellcheck disable=SC2046
	step "G: gen-secrets (external DB + CA, s3)" gen_env G \
		DATABASE_URL="$(pg_app_url verify-full)" MIGRATE_DATABASE_URL="$(pg_migrate_url verify-full)" $(s3_env) -- \
		--external-db --db-ca-file "$work/pg-certs/ca.pem" --storage s3 --allow-http-s3-endpoint || return 1
	positive_case G s3
}

refused() {
	! "$@" 2>/dev/null
}

# preflight_blocks NAME PATTERN: preflight exited non-zero with PATTERN in its log; migrate never ran.
preflight_blocks() {
	local name=$1 pattern=$2 ps preflight migrate try
	dc up -d >"$work/$name/up.txt" 2>&1 || true
	for ((try = 1; try <= 60; try++)); do
		ps=$(dc ps --all --format json | jq -s 'flatten')
		preflight=$(jq -r '[.[] | select(.Service == "preflight")][0] | "\(.State) \(.ExitCode)"' <<<"$ps")
		[[ "$preflight" == exited* ]] && break
		sleep 2
	done
	migrate=$(jq -r '[.[] | select(.Service == "migrate")][0].State // "absent"' <<<"$ps")
	if [[ "$preflight" != exited* || "$preflight" == "exited 0" ]]; then
		echo "  preflight: $preflight" >&2
		return 1
	fi
	if [[ "$migrate" != absent && "$migrate" != created ]]; then
		echo "  migrate ran: $migrate" >&2
		return 1
	fi
	if ! dc logs --no-color preflight 2>&1 | grep -q -- "$pattern"; then
		echo "  preflight log does not name '$pattern':" >&2
		dc logs --no-color preflight 2>&1 | tail -5 >&2
		return 1
	fi
}

# neg_preflight NAME SSLMODE PATTERN: a generated external-DB .env hand-edited to SSLMODE.
neg_preflight() {
	local name=$1 sslmode=$2 pattern=$3 host=db.e2e.test
	local app="postgres://exagram:pw@$host:5432/exagram?sslmode=verify-full&search_path=exagram%2Cpublic"
	local mig="postgres://exagram:pw@$host:5432/exagram?sslmode=verify-full&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"
	gen_env "$name" DATABASE_URL="$app" MIGRATE_DATABASE_URL="$mig" -- --external-db || return 1
	sed -i.bak "s/sslmode=verify-full/sslmode=$sslmode/g" "$work/$name/.env" && rm -f "$work/$name/.env.bak"
	write_override "$name"
	use_project "$name"
	preflight_blocks "$name" "$pattern"
}

case_NEG() {
	local base="postgres://exagram:pw@db.e2e.test:5432/exagram"
	local app_params="search_path=exagram%2Cpublic"
	local mig_params="x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"
	local mode ok=0
	for mode in disable require; do
		step "NEG: gen-secrets refuses sslmode=$mode (no --db-plaintext)" refused gen_env "NEG-gen-$mode" \
			DATABASE_URL="$base?sslmode=$mode&$app_params" MIGRATE_DATABASE_URL="$base?sslmode=$mode&$mig_params" -- \
			--external-db || ok=1
	done
	if ! step "NEG: hand-edited sslmode=disable stops at preflight, naming the host" \
		neg_preflight NEG-disable disable db.e2e.test; then
		ok=1
		dump_logs NEG-disable
	fi
	teardown
	if ! step "NEG: hand-edited sslmode=require stops at preflight" neg_preflight NEG-require require require; then
		ok=1
		dump_logs NEG-require
	fi
	teardown
	return "$ok"
}

# --- External TLS (E) ---------------------------------------------------------------------------

session_cookie=""

# pcurl: curl at Caddy's plain-HTTP port, with http://APP_HOST and http://UC_HOST resolving to it.
pcurl() {
	curl --connect-to "$app_host:80:127.0.0.1:$http_port" --connect-to "$uc_host:80:127.0.0.1:$http_port" "$@"
}

wait_ready_plain() {
	local try
	for ((try = 1; try <= 90; try++)); do
		if [[ "$(pcurl -fsS "http://$app_host/readiness" 2>/dev/null)" == OK ]]; then
			return 0
		fi
		sleep 2
	done
	return 1
}

plain_app_index() {
	local body want="<meta name=\"exagram-usercontent-origin\" content=\"https://$uc_host\" />"
	body=$(pcurl -fsS "http://$app_host/artifacts/00000000-0000-4000-8000-000000000000") || return 1
	grep -qF "$want" <<<"$body" || {
		echo "  index.html lacks $want" >&2
		return 1
	}
}

# usercontent answers its own 404 for an unknown body; the app host would serve the SPA instead.
plain_uc_route() {
	local status
	status=$(pcurl -s -o /dev/null -w '%{http_code}' "http://$uc_host/uc/x")
	[[ "$status" == 404 ]] || {
		echo "  GET http://$uc_host/uc/x: $status" >&2
		return 1
	}
}

plain_unknown_host() {
	local body
	body=$(curl -s -H "Host: other.e2e.test" "http://127.0.0.1:$http_port/readiness") || true
	[[ "$body" != OK ]] || {
		echo "  Host other.e2e.test reached the api" >&2
		return 1
	}
}

# Signs up over plain HTTP. The session cookie is Secure, so curl's jar would never send it back
# over http://; it is lifted from Set-Cookie and sent by hand, as the proxy's browser would.
plain_sign_up() {
	local headers
	headers=$(pcurl -sS --fail-with-body -D - -o "$work/E/sign-up.json" -X POST -H "Origin: $origin" \
		-H "Accept: application/json" -H "Content-Type: application/json" \
		--data "$(jq -nc --arg e "e2e-$(openssl rand -hex 4)@example.test" \
			'{email: $e, name: "E2E Operator", password: "correct horse battery staple", workspaceName: "E2E"}')" \
		"http://$app_host/v1/auth/sign-up") || {
		echo "  sign-up failed: $(cat "$work/E/sign-up.json" 2>/dev/null)" >&2
		return 1
	}
	session_cookie=$(tr -d '\r' <<<"$headers" | sed -n 's/^[Ss][Ee][Tt]-[Cc][Oo][Oo][Kk][Ii][Ee]: *\([^;]*\).*/\1/p' | paste -sd ';' -)
	[[ -n "$session_cookie" ]] || {
		echo "  sign-up set no cookie" >&2
		return 1
	}
}

# The opening `resync` must arrive while the stream is still open, uncompressed even when asked for gzip.
plain_sse() {
	local out="$work/E/events" status=0
	pcurl -sS -N --max-time 5 -D "$out.headers" -o "$out.body" -H "Cookie: $session_cookie" \
		-H "Accept: text/event-stream" -H "Accept-Encoding: gzip, zstd" "http://$app_host/v1/events" || status=$?
	# 28: --max-time ended the stream, which is the point.
	if [[ "$status" != 28 ]]; then
		echo "  stream ended on its own (curl exit $status): $(head -c 300 "$out.body" 2>/dev/null)" >&2
		return 1
	fi
	if ! grep -qi '^content-type: text/event-stream' "$out.headers"; then
		echo "  not an event stream: $(tr -d '\r' <"$out.headers" | grep -i '^content-type' || true)" >&2
		return 1
	fi
	if grep -qi '^content-encoding:' "$out.headers"; then
		echo "  stream is compressed: $(tr -d '\r' <"$out.headers" | grep -i '^content-encoding')" >&2
		return 1
	fi
	grep -q resync "$out.body" || {
		echo "  no resync event within 5 s: $(head -c 300 "$out.body")" >&2
		return 1
	}
}

# api_client_ip PROBE: the clientIp the api logged for GET /readiness?probe=PROBE.
api_client_ip() {
	dc logs --no-color api 2>/dev/null | sed -n 's/^[^{]*\({.*}\)$/\1/p' |
		jq -R -r --arg u "/readiness?probe=$1" 'fromjson? | select(.req.url? == $u) | .req.clientIp' | head -1
}

# Caddy trusts Cf-Connecting-Ip from the Docker bridge (a private address) and sends the api
# X-Real-IP, replacing whatever the caller sent under that name.
plain_client_ip() {
	local probe got spoofed try
	probe=$(openssl rand -hex 6)
	pcurl -fsS -o /dev/null -H "Cf-Connecting-Ip: 203.0.113.7" -H "X-Real-IP: 198.51.100.9" \
		-H "X-Forwarded-For: 198.51.100.10" "http://$app_host/readiness?probe=$probe" || return 1
	pcurl -fsS -o /dev/null -H "X-Real-IP: 198.51.100.9" "http://$app_host/readiness?probe=$probe-spoof" || return 1
	for ((try = 1; try <= 10; try++)); do
		got=$(api_client_ip "$probe")
		spoofed=$(api_client_ip "$probe-spoof")
		[[ -n "$got" && -n "$spoofed" ]] && break
		sleep 1
	done
	if [[ "$got" != 203.0.113.7 ]]; then
		echo "  clientIp with Cf-Connecting-Ip: '$got', expected 203.0.113.7" >&2
		return 1
	fi
	if [[ -z "$spoofed" || "$spoofed" == 198.51.100.9 ]]; then
		echo "  clientIp with only a caller's X-Real-IP: '$spoofed', expected the TCP peer" >&2
		return 1
	fi
}

case_E() {
	step "E: gen-secrets (external TLS, Cf-Connecting-Ip, 127.0.0.1:$http_port)" gen_env E -- \
		--tls external --client-ip-header Cf-Connecting-Ip --http-bind "127.0.0.1:$http_port" || return 1
	write_override E external
	use_project E
	curl_opts=()
	dc up -d >"$work/E/up.txt" 2>&1 || cat "$work/E/up.txt" >&2
	step "E: stack ready at http://127.0.0.1:$http_port" wait_ready_plain || return 1
	step "E: APP_HOST serves the SPA, naming https://UC_HOST" plain_app_index || return 1
	step "E: UC_HOST reaches usercontent" plain_uc_route || return 1
	step "E: another Host reaches nothing" plain_unknown_host || return 1
	step "E: sign up" plain_sign_up || return 1
	step "E: /v1/events streams unbuffered and uncompressed" plain_sse || return 1
	step "E: api logs the client address from Cf-Connecting-Ip, never a caller's X-Real-IP" plain_client_ip || return 1
	step "E: deploy/verify.sh (external TLS, at HTTP_BIND)" run_verify E || return 1
}

# --- Main --------------------------------------------------------------------------------------

fixture="$work/fixture.pdf"
node "$e2e_dir/make-pdf.mjs" "Exagram self-hosted e2e $(date +%s)" >"$fixture"

# One build for every project: compose.build.yml tags each image exagram-selfhost/<name>:local.
mkdir -p "$work/build"
if ! GEN_SECRETS_ENV_FILE="$work/build/.env" "$deploy_dir/gen-secrets.sh" \
	--app-host "$app_host" --uc-host "$uc_host" --acme-email e2e@example.test >/dev/null; then
	echo "FAIL: gen-secrets for the build" >&2
	exit 1
fi
write_override build
use_project build
if ! dc build; then
	echo "FAIL: docker compose build" >&2
	exit 1
fi
current_project=""

for c in "${cases[@]}"; do
	echo "=== case $c"
	before=$failures
	if ! "case_$c" || [[ "$failures" -gt "$before" ]]; then
		[[ "$failures" -gt "$before" ]] || failures=$((failures + 1))
		failed_cases+=("$c")
		if [[ -n "$current_project" ]]; then
			dump_logs "$c"
		fi
	fi
	teardown
	remove_externals
done

if [[ "$failures" -gt 0 ]]; then
	echo "FAILED: ${failed_cases[*]} ($failures failing step(s))" >&2
	exit 1
fi
echo "all cases passed: ${cases[*]}"
completed=true
