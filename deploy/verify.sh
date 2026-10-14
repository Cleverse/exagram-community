#!/usr/bin/env bash
set -euo pipefail

# Post-deploy smoke test against a running stack: Compose checks here, the HTTP checks in smoke.sh next
# to it. Run from anywhere; settings come from the .env next to this script, read as data (never sourced).
#
# With Caddy's own TLS it requests https://APP_HOST and https://UC_HOST. With compose.tls-external.yml
# it requests both hosts as plain HTTP at HTTP_BIND (0.0.0.0 and [::] read as loopback), with the
# Host header set, so it proves the stack whether or not the proxy in front is up yet; set
# VERIFY_PUBLIC=1 to make the same requests to https://APP_HOST and https://UC_HOST through the proxy.
#
#   VERIFY_ENV_FILE     another env file instead of .env (passed to compose as --env-file)
#   VERIFY_PROJECT      compose project name (COMPOSE_PROJECT_NAME also works)
#   VERIFY_CURL_OPTS    extra curl arguments for every request, split on whitespace
#                       (e.g. "--connect-to app.test:443:127.0.0.1:8443 --cacert /path/root.crt")
#   VERIFY_PUBLIC       1: in external TLS mode, check through the proxy instead of at HTTP_BIND
#   VERIFY_OBJECT_KEY   external store only: the storage key of an object the app uploaded, used to
#                       prove the bucket refuses anonymous reads and allows the browser upload

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${VERIFY_ENV_FILE:-$script_dir/.env}"

for bin in curl jq docker; do
	if ! command -v "$bin" >/dev/null 2>&1; then
		echo "FAIL: $bin not found on PATH" >&2
		exit 1
	fi
done

if [[ ! -f "$env_file" ]]; then
	echo "FAIL: $env_file not found" >&2
	exit 1
fi

# KEY=VALUE per line; one layer of matching single or double quotes is stripped. Values land in
# ENV_<KEY> variables, read back with env_get.
while IFS= read -r raw || [[ -n "$raw" ]]; do
	raw=${raw%$'\r'}
	[[ "$raw" =~ ^[[:space:]]*(#|$) ]] && continue
	[[ "$raw" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
	key=${BASH_REMATCH[2]}
	value=${BASH_REMATCH[3]}
	if [[ ${#value} -ge 2 && ("$value" == \'*\' || "$value" == \"*\") ]]; then
		value=${value:1:${#value}-2}
	fi
	printf -v "ENV_$key" '%s' "$value"
done <"$env_file"

env_get() {
	local name="ENV_$1"
	echo "${!name:-}"
}

APP_HOST=$(env_get APP_HOST)
UC_HOST=$(env_get UC_HOST)
storage_driver=$(env_get STORAGE_DRIVER)
storage_driver=${storage_driver:-filesystem}
# The environment beats .env for COMPOSE_FILE, as it does for compose itself.
compose_file=${COMPOSE_FILE:-$(env_get COMPOSE_FILE)}
compose_file=${compose_file:-compose.yml}

if [[ -z "$APP_HOST" || -z "$UC_HOST" ]]; then
	echo "FAIL: APP_HOST and UC_HOST must be set in $env_file" >&2
	exit 1
fi

curl_opts=()
if [[ -n "${VERIFY_CURL_OPTS:-}" ]]; then
	read -r -a curl_opts <<<"$VERIFY_CURL_OPTS"
fi
vcurl() {
	curl ${curl_opts[@]+"${curl_opts[@]}"} "$@"
}

external_tls=false
if [[ ":$compose_file:" == *":compose.tls-external.yml:"* ]]; then
	external_tls=true
fi
app_url="https://${APP_HOST}"
uc_url="https://${UC_HOST}"
if [[ "$external_tls" == true && "${VERIFY_PUBLIC:-}" != 1 ]]; then
	http_bind=$(env_get HTTP_BIND)
	http_bind=${http_bind:-127.0.0.1:8080}
	bind_host=${http_bind%:*}
	bind_port=${http_bind##*:}
	case "$bind_host" in
	0.0.0.0) bind_host=127.0.0.1 ;;
	"[::]") bind_host="[::1]" ;;
	esac
	app_url="http://${APP_HOST}"
	uc_url="http://${UC_HOST}"
	curl_opts+=(--connect-to "$APP_HOST:80:$bind_host:$bind_port" --connect-to "$UC_HOST:80:$bind_host:$bind_port")
fi

# COMPOSE_FILE paths are relative to deploy/, so compose runs from there.
compose_args=()
if [[ -n "${VERIFY_ENV_FILE:-}" ]]; then
	compose_args+=(--env-file "$env_file")
fi
if [[ -n "${VERIFY_PROJECT:-}" ]]; then
	compose_args+=(-p "$VERIFY_PROJECT")
fi
dc() {
	(cd "$script_dir" && COMPOSE_FILE="$compose_file" docker compose ${compose_args[@]+"${compose_args[@]}"} "$@")
}

failures=0
skipped=()

check() {
	local name=$1
	if "${@:2}"; then
		echo "PASS: $name"
	else
		echo "FAIL: $name"
		failures=$((failures + 1))
	fi
}

check_caddy_config() {
	dc exec -T caddy caddy validate --config /etc/caddy/Caddyfile
}

# --- Services ---------------------------------------------------------------------------------

ps_json() {
	# `ps --format json` prints one object per line on current compose, an array on older ones.
	dc ps --all --format json | jq -s 'flatten'
}

check_long_running_services() {
	local want got
	want="api caddy usercontent worker"
	if [[ ":$compose_file:" == *":compose.postgres.yml:"* ]]; then
		want="api caddy postgres usercontent worker"
	fi
	got=$(ps_json | jq -r '[.[] | select(.State == "running") | .Service] | sort | join(" ")') || return 1
	if [[ "$got" != "$want" ]]; then
		echo "  running: $got; expected: $want" >&2
		return 1
	fi
}

check_one_shot_exited_zero() {
	local service=$1 state
	state=$(ps_json | jq -r --arg s "$service" '[.[] | select(.Service == $s)][0] | "\(.State) \(.ExitCode)"') ||
		return 1
	if [[ "$state" != "exited 0" ]]; then
		echo "  $service: $state" >&2
		return 1
	fi
}

check_migrate_version() {
	local want output
	# The highest migration baked into this install's migrate image, not a source checkout's.
	output=$(dc run --rm --no-deps -T --entrypoint ls migrate /migrations 2>&1) ||
		{
			echo "  listing the migrate image's /migrations failed: $output" >&2
			return 1
		}
	want=$(sed -n 's/^\([0-9][0-9]*\)_.*\.up\.sql$/\1/p' <<<"$output" | sort -n | tail -1)
	if [[ -z "$want" ]]; then
		echo "  no migrations in the migrate image: $output" >&2
		return 1
	fi
	want=$((10#$want))
	# golang-migrate prints the version on stderr; `run` replaces the command, so the whole script is
	# restated, and --no-deps keeps it from re-running preflight. The URL comes from the service's
	# environment, not verify's own command line.
	output=$(dc run --rm --no-deps -T migrate 'exec migrate -path=/migrations -database="$MIGRATE_DATABASE_URL" version' 2>&1) ||
		{
			echo "  migrate version failed: $output" >&2
			return 1
		}
	output=$(tail -1 <<<"$output")
	if [[ "$output" != "$want" ]]; then
		echo "  migrate version: '$output'; expected $want, not dirty" >&2
		return 1
	fi
}

check_objects_writable() {
	dc exec -T api sh -c 'f=/var/lib/exagram/objects/.verify-$$ && : >"$f" && rm -f "$f"'
}

# --- External object store ---------------------------------------------------------------------

object_key=${VERIFY_OBJECT_KEY:-}
bucket_url=""
object_url=""

# The bucket's public address, addressed the way the app's signer does.
external_store_urls() {
	local bucket endpoint region path_style scheme host
	if [[ "$storage_driver" == gcs ]]; then
		bucket=$(env_get GCS_BUCKET)
		bucket_url="https://storage.googleapis.com/$bucket"
	else
		bucket=$(env_get S3_BUCKET)
		region=$(env_get S3_REGION)
		endpoint=$(env_get S3_PUBLIC_ENDPOINT)
		endpoint=${endpoint:-$(env_get S3_ENDPOINT)}
		path_style=$(env_get S3_FORCE_PATH_STYLE)
		if [[ -z "$path_style" ]]; then
			path_style=false
			[[ -n "$endpoint" ]] && path_style=true
		fi
		endpoint=${endpoint:-https://s3.${region}.amazonaws.com}
		endpoint=${endpoint%/}
		if [[ "$path_style" == true ]]; then
			bucket_url="$endpoint/$bucket"
		else
			scheme=${endpoint%%://*}
			host=${endpoint#*://}
			bucket_url="$scheme://$bucket.$host"
		fi
	fi
	object_url="$bucket_url/$object_key"
}

# 401 or 403 proves a denial; 404 or a transport error proves nothing.
denied() {
	local status
	status=$(vcurl -s -o /dev/null -w '%{http_code}' "$1") || status="transport error"
	if [[ "$status" != 401 && "$status" != 403 ]]; then
		echo "  GET $1: $status; expected 401 or 403" >&2
		return 1
	fi
}

check_object_private() {
	denied "$object_url"
}

check_bucket_listing_private() {
	if [[ "$storage_driver" == gcs ]]; then
		denied "$bucket_url"
	else
		denied "$bucket_url/?list-type=2"
	fi
}

check_store_cors() {
	local headers origin="https://${APP_HOST}" request_headers="content-type" allow_origin allow_methods allow_headers h
	[[ "$storage_driver" == gcs ]] && request_headers="content-type,x-goog-content-length-range,x-goog-if-generation-match"
	[[ "$storage_driver" == s3 ]] && request_headers="content-type,if-none-match"
	headers=$(vcurl -s -o /dev/null -D - -X OPTIONS "$object_url" \
		-H "Origin: $origin" \
		-H "Access-Control-Request-Method: PUT" \
		-H "Access-Control-Request-Headers: $request_headers" | tr -d '\r' | tr '[:upper:]' '[:lower:]') || return 1
	allow_origin=$(sed -n 's/^access-control-allow-origin: *//p' <<<"$headers")
	allow_methods=$(sed -n 's/^access-control-allow-methods: *//p' <<<"$headers")
	allow_headers=$(sed -n 's/^access-control-allow-headers: *//p' <<<"$headers")
	if [[ "$allow_origin" != "$(tr '[:upper:]' '[:lower:]' <<<"$origin")" && "$allow_origin" != "*" ]]; then
		echo "  CORS: origin $origin not allowed (allow-origin: '$allow_origin')" >&2
		return 1
	fi
	if [[ ",${allow_methods// /}," != *",put,"* ]]; then
		echo "  CORS: PUT not allowed (allow-methods: '$allow_methods')" >&2
		return 1
	fi
	for h in ${request_headers//,/ }; do
		if [[ ",${allow_headers// /}," != *",$h,"* && "$allow_headers" != "*" ]]; then
			echo "  CORS: header $h not allowed (allow-headers: '$allow_headers')" >&2
			return 1
		fi
	done
}

# The HTTP checks live in smoke.sh, which also runs without Docker; its PASS/FAIL lines are ours.
run_smoke() {
	local out rc=0 n
	out=$(SMOKE_CURL_OPTS="${curl_opts[*]-}" SMOKE_NO_SUMMARY=1 \
		SMOKE_SKIP_HTTP_REDIRECT="$([[ "$external_tls" == true ]] && echo 1 || echo 0)" \
		bash "$script_dir/smoke.sh" "$app_url" "$uc_url") || rc=$?
	[[ -z "$out" ]] || echo "$out"
	n=$(grep -c '^FAIL: ' <<<"$out" || true)
	if [[ "$rc" -ne 0 && "$n" -eq 0 ]]; then
		n=1
	fi
	failures=$((failures + n))
}

run_smoke
check "caddy validate --config" check_caddy_config
check "running services match COMPOSE_FILE ($compose_file)" check_long_running_services
check "preflight exited 0" check_one_shot_exited_zero preflight
check "migrate exited 0" check_one_shot_exited_zero migrate
check "migration version is the latest, not dirty" check_migrate_version

case "$storage_driver" in
filesystem)
	check "objects volume writable by api" check_objects_writable
	;;
s3 | gcs)
	if [[ -z "$object_key" ]]; then
		for skipped_check in "$storage_driver object privacy" "$storage_driver bucket listing privacy" "$storage_driver bucket CORS"; do
			echo "WARN: skipped: $skipped_check (needs VERIFY_OBJECT_KEY, the storage key of an uploaded object)"
			skipped+=("$skipped_check")
		done
	else
		external_store_urls
		check "anonymous GET of the object is refused ($object_url)" check_object_private
		check "anonymous bucket listing is refused" check_bucket_listing_private
		check "bucket CORS allows the browser upload from https://$APP_HOST" check_store_cors
	fi
	;;
*)
	echo "FAIL: unknown STORAGE_DRIVER: $storage_driver"
	failures=$((failures + 1))
	;;
esac

if [[ "$failures" -gt 0 ]]; then
	echo "$failures check(s) failed" >&2
	exit 1
fi
if [[ ${#skipped[@]} -gt 0 ]]; then
	skipped_names=$(printf '%s; ' "${skipped[@]}")
	echo "passed with ${#skipped[@]} checks skipped: ${skipped_names%; } - rerun with VERIFY_OBJECT_KEY=<a stored key> after the first upload"
	exit 0
fi
echo "all checks passed"
