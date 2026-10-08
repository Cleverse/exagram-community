#!/usr/bin/env bash
set -euo pipefail

# Accept/reject table for gen-secrets.sh. Needs no Docker daemon: a stub `docker` on PATH answers
# the JWKS step. When a real docker CLI is present, a generated .env is also rendered with
# `docker compose config` (no daemon needed) to prove compose parses it.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gen="$script_dir/gen-secrets.sh"
real_docker=$(command -v docker || true)

work=$(mktemp -d "${TMPDIR:-/tmp}/gen-secrets-test.XXXXXX")
trap 'rm -rf "$work"' EXIT

mkdir "$work/bin"
cat >"$work/bin/docker" <<'EOF'
#!/bin/sh
printf '%s' '{"keys":[{"kty":"RSA","kid":"stub","use":"sig","alg":"RS256"}]}'
EOF
chmod +x "$work/bin/docker"

ca_file="$work/db-ca.pem"
printf 'stub CA\n' >"$ca_file"

failures=0
n=0

pass() { echo "PASS: $1"; }
fail() {
	echo "FAIL: $1" >&2
	failures=$((failures + 1))
}

# run NAME [VAR=value ...] -- [gen-secrets args ...]: fresh env file, clean environment. The hosts
# are given unless the args name their own; --acme-email too, unless the args name a --tls.
run() {
	local name=$1
	shift
	local vars=()
	while [[ $# -gt 0 && "$1" != -- ]]; do
		vars+=("$1")
		shift
	done
	shift
	local base=(--app-host app.example.test --uc-host uc.example.test) arg
	for arg in "$@"; do
		[[ "$arg" == --app-host || "$arg" == --uc-host ]] && base=()
	done
	[[ " $* " == *" --tls "* ]] || base+=(--acme-email ops@example.test)
	n=$((n + 1))
	out_file="$work/env.$n"
	out_err="$work/err.$n"
	out_std="$work/out.$n"
	(cd "$work" && env -i PATH="$work/bin:/usr/bin:/bin:/usr/sbin:/sbin:$(dirname "$(command -v openssl)")" \
		HOME="$work" GEN_SECRETS_ENV_FILE="$out_file" \
		${vars[@]+"${vars[@]}"} bash "$gen" ${base[@]+"${base[@]}"} "$@") >"$out_std" 2>"$out_err"
}

expect_ok() {
	local name=$1
	if run "$@"; then
		pass "$name"
	else
		fail "$name (exit non-zero: $(cat "$out_err"))"
	fi
}

# expect_reject NAME PATTERN [VAR=value ...] -- [args]: must fail, write nothing, and name PATTERN.
expect_reject() {
	local name=$1 pattern=$2
	shift 2
	if run "$name" "$@"; then
		fail "$name (accepted)"
	elif [[ -e "$out_file" ]]; then
		fail "$name (wrote $out_file anyway)"
	elif ! grep -q -- "$pattern" "$out_err"; then
		fail "$name (error does not mention '$pattern': $(cat "$out_err"))"
	else
		pass "$name"
	fi
}

# value KEY: the single-quoted value in the last generated file.
value() {
	sed -n "s/^$1='\\(.*\\)'\$/\\1/p" "$out_file"
}

has_key() {
	grep -q "^$1=" "$out_file"
}

expect_value() {
	local name=$1 key=$2 want=$3 got
	got=$(value "$key")
	if [[ "$got" == "$want" ]]; then
		pass "$name: $key"
	else
		fail "$name: $key is '$got', want '$want'"
	fi
}

expect_absent() {
	if has_key "$2"; then
		fail "$1: $2 should not be written"
	else
		pass "$1: no $2"
	fi
}

ext_app="postgres://exagram:pw@db.example.test:5432/exagram?sslmode=verify-full&search_path=exagram%2Cpublic"
ext_mig="postgres://exagram:pw@db.example.test:5432/exagram?sslmode=verify-full&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"

# app_url / mig_url SSL_PARAMS: the external URLs with their sslmode/sslrootcert part swapped.
app_url() { echo "postgres://exagram:pw@db.example.test:5432/exagram?$1&search_path=exagram%2Cpublic"; }
mig_url() { echo "postgres://exagram:pw@db.example.test:5432/exagram?$1&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"; }

# --- bundled database, filesystem store ---
expect_ok "bundled defaults" --
expect_value "bundled defaults" COMPOSE_FILE "compose.yml:compose.postgres.yml"
expect_value "bundled defaults" STORAGE_DRIVER filesystem
expect_value "bundled defaults" ACME_EMAIL ops@example.test
expect_absent "bundled defaults" HTTP_BIND
expect_absent "bundled defaults" PROXY_CLIENT_IP_HEADER
# The version lives in the bundle (VERSION, and compose.yml's pinned images), so extracting a newer
# bundle upgrades without touching .env.
expect_absent "bundled defaults" EXAGRAM_VERSION
expect_absent "bundled defaults" DATABASE_PLAINTEXT_HOSTS
expect_absent "bundled defaults" S3_BUCKET
[[ "$(value UPLOAD_TOKEN_SECRET)" =~ ^[0-9a-f]{64}$ ]] && pass "bundled defaults: UPLOAD_TOKEN_SECRET" ||
	fail "bundled defaults: UPLOAD_TOKEN_SECRET"
[[ "$(value USERCONTENT_TOKEN_SECRET)" =~ ^[0-9a-f]{64}$ ]] && pass "bundled defaults: USERCONTENT_TOKEN_SECRET" ||
	fail "bundled defaults: USERCONTENT_TOKEN_SECRET"
[[ "$(value POSTGRES_PASSWORD)" =~ ^[0-9a-f]{48}$ ]] && pass "bundled defaults: POSTGRES_PASSWORD" ||
	fail "bundled defaults: POSTGRES_PASSWORD"
[[ "$(value DATABASE_URL)" == *"@postgres:5432/exagram?sslmode=disable&search_path=exagram%2Cpublic" ]] &&
	pass "bundled defaults: DATABASE_URL" || fail "bundled defaults: DATABASE_URL"
[[ "$(value OIDC_JWKS)" == '{"keys":[{"kty":"RSA"'* ]] && pass "bundled defaults: OIDC_JWKS" ||
	fail "bundled defaults: OIDC_JWKS"
if grep -v -e '^#' -e '^$' "$out_file" | grep -qv "^[A-Z0-9_]*='[^']*'\$"; then
	fail "bundled defaults: every line is KEY='value'"
else
	pass "bundled defaults: every line is KEY='value'"
fi
perms=$(stat -c '%a' "$out_file" 2>/dev/null || stat -f '%Lp' "$out_file")
[[ "$perms" == 600 ]] && pass "bundled defaults: mode 600" || fail "bundled defaults: mode is $perms"
bundled_env=$out_file

if env -i PATH="$work/bin:/usr/bin:/bin" GEN_SECRETS_ENV_FILE="$bundled_env" \
	bash "$gen" --app-host a --uc-host b --acme-email c >/dev/null 2>&1; then
	fail "refuses to overwrite"
else
	pass "refuses to overwrite"
fi

expect_reject "unknown flag" "unknown argument" -- --s3-host s3.example.test
expect_reject "bad --storage" "--storage must be" -- --storage minio
expect_reject "--db-plaintext without --external-db" "need --external-db" -- --db-plaintext
expect_reject "--allow-http-s3-endpoint without s3" "needs --storage s3" -- --allow-http-s3-endpoint
expect_reject "quote in a flag value" "single quote" -- --acme-email "o'neil@example.test"

# --- hosts ---
expect_reject "missing --app-host" "--app-host is required" -- --uc-host uc.example.test --acme-email ops@example.test

# Without --uc-host: "-files" after the first label, one level deep beside APP_HOST.
expect_ok "derived --uc-host" -- --app-host exagram.acme.com --acme-email ops@example.test
expect_value "derived --uc-host" UC_HOST exagram-files.acme.com
expect_value "derived --uc-host" APP_HOST exagram.acme.com
if grep -qx 'UC_HOST=exagram-files.acme.com (derived from --app-host; point DNS or the proxy at it as well)' "$out_std"; then
	pass "derived --uc-host: printed"
else
	fail "derived --uc-host: stdout is $(cat "$out_std")"
fi
expect_ok "derived --uc-host, 4 labels" -- --app-host docs.eu.acme.com --acme-email ops@example.test
expect_value "derived --uc-host, 4 labels" UC_HOST docs-files.eu.acme.com
expect_ok "explicit --uc-host wins" -- --app-host exagram.acme.com --uc-host files.acme.com \
	--acme-email ops@example.test
expect_value "explicit --uc-host wins" UC_HOST files.acme.com
if grep -qx 'UC_HOST=files.acme.com' "$out_std"; then
	pass "explicit --uc-host: printed"
else
	fail "explicit --uc-host: stdout is $(cat "$out_std")"
fi
expect_reject "no --uc-host, 2-label --app-host" "fewer than 3 labels" -- --app-host acme.com \
	--acme-email ops@example.test
expect_reject "no --uc-host, 1-label --app-host" "--uc-host is required" -- --app-host app \
	--acme-email ops@example.test
expect_reject "no --uc-host, first label too long" "longer than a DNS label" -- \
	--app-host "$(printf 'a%.0s' {1..60}).acme.com" --acme-email ops@example.test
expect_reject "same app and uc host" "must differ" -- --app-host app.example.test --uc-host app.example.test \
	--acme-email ops@example.test
for bad in APP.example.test https://app.example.test app.example.test:8443 app.example.test/x -app.example.test \
	"app example.test" 'app.example.test"><script>'; do
	expect_reject "--app-host '$bad'" "--app-host must be a lower-case host name" -- \
		--app-host "$bad" --uc-host uc.example.test --acme-email ops@example.test
	expect_reject "--uc-host '$bad'" "--uc-host must be a lower-case host name" -- \
		--app-host app.example.test --uc-host "$bad" --acme-email ops@example.test
done
expect_ok "single-label hosts" -- --app-host app --uc-host uc --acme-email ops@example.test

# --- TLS mode ---
expect_reject "acme without --acme-email" "needs --acme-email" -- --tls acme
expect_ok "explicit --tls acme" -- --tls acme --acme-email ops@example.test
expect_value "explicit --tls acme" COMPOSE_FILE compose.yml:compose.postgres.yml
expect_reject "bad --tls" "--tls must be acme or external" -- --tls none
expect_reject "--client-ip-header without external" "need --tls external" -- --client-ip-header Cf-Connecting-Ip
expect_reject "--http-bind without external" "need --tls external" -- --http-bind 127.0.0.1:8080

expect_ok "external defaults" -- --tls external
expect_value "external defaults" COMPOSE_FILE compose.yml:compose.postgres.yml:compose.tls-external.yml
expect_value "external defaults" HTTP_BIND 127.0.0.1:8080
expect_value "external defaults" PROXY_CLIENT_IP_HEADER X-Forwarded-For
expect_absent "external defaults" ACME_EMAIL
expect_value "external defaults" APP_HOST app.example.test
expect_value "external defaults" UC_HOST uc.example.test
external_env=$out_file

expect_ok "external, Cloudflare header, all interfaces" -- \
	--tls external --client-ip-header Cf-Connecting-Ip --http-bind 0.0.0.0:80
expect_value "external, Cloudflare" PROXY_CLIENT_IP_HEADER Cf-Connecting-Ip
expect_value "external, Cloudflare" HTTP_BIND 0.0.0.0:80
expect_ok "external, IPv6 loopback" -- --tls external --http-bind "[::1]:8080"
expect_value "external, IPv6 loopback" HTTP_BIND "[::1]:8080"
expect_reject "external with --acme-email" "does not apply to --tls external" -- \
	--tls external --acme-email ops@example.test
expect_reject "external, header with a colon" "must be a header name" -- --tls external --client-ip-header "X-Real-IP:"
expect_reject "external, header with a space" "must be a header name" -- --tls external --client-ip-header "X Real"
for bad in 8080 127.0.0.1 127.0.0.1:0 127.0.0.1:65536 localhost:8080 "::1:8080" 127.0.0.1:80:80; do
	expect_reject "external, --http-bind '$bad'" "--http-bind must be" -- --tls external --http-bind "$bad"
done

# --- external database ---
expect_ok "external verify-full, system roots" DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db
expect_value "external verify-full" COMPOSE_FILE compose.yml
expect_value "external verify-full" DATABASE_URL "$ext_app"
expect_value "external verify-full" MIGRATE_DATABASE_URL "$ext_mig"
expect_absent "external verify-full" POSTGRES_PASSWORD
expect_absent "external verify-full" DATABASE_CA_FILE
expect_absent "external verify-full" DATABASE_CA_SERVER_SPECIFIC

ca="sslmode=verify-full&sslrootcert=/certs/db-ca.pem"
expect_ok "external verify-full + CA" DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$(mig_url "$ca")" -- \
	--external-db --db-ca-file "$ca_file"
expect_value "external verify-full + CA" COMPOSE_FILE compose.yml:compose.db-ca.yml
expect_value "external verify-full + CA" DATABASE_CA_FILE "$(cd "$(dirname "$ca_file")" && pwd)/db-ca.pem"
expect_absent "external verify-full + CA" DATABASE_CA_SERVER_SPECIFIC

enc="sslmode=verify-full&sslrootcert=%2Fcerts%2Fdb-ca.pem"
expect_ok "percent-encoded sslrootcert" DATABASE_URL="$(app_url "$enc")" MIGRATE_DATABASE_URL="$(mig_url "$enc")" -- \
	--external-db --db-ca-file "$ca_file"
expect_reject "percent-encoded other sslrootcert" "sslrootcert must be" \
	DATABASE_URL="$(app_url "sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Frds.pem")" \
	MIGRATE_DATABASE_URL="$(mig_url "sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Frds.pem")" -- --external-db
expect_reject "repeated sslmode in DATABASE_URL" "more than once" \
	DATABASE_URL="$(app_url "sslmode=verify-full&sslmode=disable")" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db
expect_reject "repeated parameter in MIGRATE_DATABASE_URL" "more than once" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="$(mig_url "sslmode=verify-full&connect_timeout=5&connect_timeout=9")" -- \
	--external-db

expect_ok "relative --db-ca-file" DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$(mig_url "$ca")" -- \
	--external-db --db-ca-file db-ca.pem
expect_value "relative --db-ca-file" DATABASE_CA_FILE "$(cd "$work" && pwd -P)/db-ca.pem"

vca="sslmode=verify-ca&sslrootcert=/certs/db-ca.pem"
expect_ok "external verify-ca + CA + ack" DATABASE_URL="$(app_url "$vca")" MIGRATE_DATABASE_URL="$(mig_url "$vca")" -- \
	--external-db --db-ca-file "$ca_file" --db-ca-is-server-specific
expect_value "external verify-ca" DATABASE_CA_SERVER_SPECIFIC true
expect_value "external verify-ca" COMPOSE_FILE compose.yml:compose.db-ca.yml
expect_reject "verify-ca without ack" "--db-ca-is-server-specific" \
	DATABASE_URL="$(app_url "$vca")" MIGRATE_DATABASE_URL="$(mig_url "$vca")" -- --external-db --db-ca-file "$ca_file"
expect_reject "verify-ca without CA file" "needs --db-ca-file" \
	DATABASE_URL="$(app_url "$vca")" MIGRATE_DATABASE_URL="$(mig_url "$vca")" -- --external-db --db-ca-is-server-specific
expect_reject "ack with verify-full" "only applies to sslmode=verify-ca" \
	DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$(mig_url "$ca")" -- \
	--external-db --db-ca-file "$ca_file" --db-ca-is-server-specific

expect_ok "external disable + --db-plaintext" \
	DATABASE_URL="$(app_url sslmode=disable)" MIGRATE_DATABASE_URL="$(mig_url sslmode=disable)" -- --external-db --db-plaintext
expect_value "external disable" DATABASE_PLAINTEXT_HOSTS db.example.test
expect_value "external disable" COMPOSE_FILE compose.yml
expect_reject "disable without --db-plaintext" "--db-plaintext" \
	DATABASE_URL="$(app_url sslmode=disable)" MIGRATE_DATABASE_URL="$(mig_url sslmode=disable)" -- --external-db
expect_reject "--db-plaintext with verify-full" "only applies to sslmode=disable" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db --db-plaintext
expect_reject "--db-ca-file with disable" "does not apply" \
	DATABASE_URL="$(app_url sslmode=disable)" MIGRATE_DATABASE_URL="$(mig_url sslmode=disable)" -- \
	--external-db --db-plaintext --db-ca-file "$ca_file"

for mode in require prefer allow; do
	expect_reject "sslmode=$mode" "without verifying" \
		DATABASE_URL="$(app_url "sslmode=$mode")" MIGRATE_DATABASE_URL="$(mig_url "sslmode=$mode")" -- --external-db
done
expect_reject "sslmode=bogus" "unsupported sslmode" \
	DATABASE_URL="$(app_url sslmode=bogus)" MIGRATE_DATABASE_URL="$(mig_url sslmode=bogus)" -- --external-db
expect_reject "missing sslmode" "no sslmode" \
	DATABASE_URL="postgres://u:p@db.example.test/exagram?search_path=exagram%2Cpublic" \
	MIGRATE_DATABASE_URL="$(mig_url sslmode=verify-full)" -- --external-db
expect_reject "sslmode differs" "same sslmode" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="$(mig_url sslmode=disable)" -- --external-db --db-plaintext
expect_reject "sslrootcert=system" "sslrootcert must be" \
	DATABASE_URL="$(app_url "sslmode=verify-full&sslrootcert=system")" \
	MIGRATE_DATABASE_URL="$(mig_url "sslmode=verify-full&sslrootcert=system")" -- --external-db
expect_reject "other sslrootcert path" "sslrootcert must be" \
	DATABASE_URL="$(app_url "sslmode=verify-full&sslrootcert=/etc/ssl/rds.pem")" \
	MIGRATE_DATABASE_URL="$(mig_url "sslmode=verify-full&sslrootcert=/etc/ssl/rds.pem")" -- \
	--external-db --db-ca-file "$ca_file"
expect_reject "sslrootcert differs" "same sslrootcert" \
	DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db --db-ca-file "$ca_file"
expect_reject "sslrootcert without --db-ca-file" "needs --db-ca-file" \
	DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$(mig_url "$ca")" -- --external-db
expect_reject "--db-ca-file without sslrootcert" "needs sslrootcert" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db --db-ca-file "$ca_file"
expect_reject "missing CA file" "not a readable file" \
	DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$(mig_url "$ca")" -- \
	--external-db --db-ca-file "$work/nope.pem"
expect_reject "migrate host differs" "must name the same database" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="${ext_mig/db.example.test/other.example.test}" -- --external-db
expect_reject "migrate database name differs" "must name the same database" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="${ext_mig/5432\/exagram/5432\/other}" -- --external-db
expect_reject "migrate port differs" "must name the same database" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="${ext_mig/:5432/:5433}" -- --external-db
expect_ok "migrate user differs, host case and default port" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="${ext_mig/exagram:pw@db.example.test:5432/owner:x@DB.Example.Test}" -- --external-db
expect_reject "missing search_path" "search_path=exagram%2Cpublic" \
	DATABASE_URL="postgres://u:p@db.example.test/exagram?sslmode=verify-full" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db
expect_reject "missing x-migrations-table" "x-migrations-table" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="postgres://u:p@db.example.test/exagram?sslmode=verify-full" -- --external-db
expect_reject "unlisted app parameter" "sslcert is not allowed" \
	DATABASE_URL="$ext_app&sslcert=/x" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db
expect_reject "unlisted migrate parameter" "search_path is not allowed" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="$ext_mig&search_path=exagram%2Cpublic" -- --external-db
expect_reject "missing DATABASE_URL" "needs DATABASE_URL" MIGRATE_DATABASE_URL="$ext_mig" -- --external-db
expect_reject "not a postgres URL" "postgres:// URL" \
	DATABASE_URL="mysql://db.example.test/exagram?sslmode=verify-full&search_path=exagram%2Cpublic" \
	MIGRATE_DATABASE_URL="$ext_mig" -- --external-db
expect_reject "quote in URL" "single quote" \
	DATABASE_URL="postgres://u:p'w@db.example.test/exagram?sslmode=verify-full&search_path=exagram%2Cpublic" \
	MIGRATE_DATABASE_URL="$ext_mig" -- --external-db
expect_reject "newline in URL" "newline" \
	DATABASE_URL="$ext_app" MIGRATE_DATABASE_URL="$ext_mig"$'\n' -- --external-db

# --- S3 ---
expect_ok "s3 AWS, no endpoint, instance role" S3_BUCKET=b S3_REGION=eu-west-1 -- --storage s3
expect_value "s3 AWS" STORAGE_DRIVER s3
expect_value "s3 AWS" S3_BUCKET b
expect_value "s3 AWS" S3_REGION eu-west-1
expect_value "s3 AWS" COMPOSE_FILE compose.yml:compose.postgres.yml
expect_absent "s3 AWS" S3_ENDPOINT
expect_absent "s3 AWS" S3_ACCESS_KEY_ID
expect_ok "s3 R2 with keys" S3_BUCKET=b S3_REGION=auto S3_ENDPOINT=https://acct.r2.cloudflarestorage.com \
	S3_PUBLIC_ENDPOINT=https://acct.r2.cloudflarestorage.com S3_ACCESS_KEY_ID=k S3_SECRET_ACCESS_KEY=s -- --storage s3
expect_value "s3 R2" S3_ENDPOINT https://acct.r2.cloudflarestorage.com
expect_value "s3 R2" S3_SECRET_ACCESS_KEY s
expect_absent "s3 R2" S3_HTTP_HOSTS
expect_ok "s3 http endpoint + --allow-http-s3-endpoint" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=http://minio.internal:9000 S3_PUBLIC_ENDPOINT=https://s3.example.test S3_FORCE_PATH_STYLE=true -- \
	--storage s3 --allow-http-s3-endpoint
expect_value "s3 http endpoint" S3_HTTP_HOSTS minio.internal
expect_value "s3 http endpoint" S3_FORCE_PATH_STYLE true
expect_ok "s3 loopback http public endpoint" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT=http://localhost:9000 -- --storage s3
expect_ok "s3 loopback 127.x.x.x public endpoint" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT=http://127.0.0.1:9000 -- --storage s3
expect_ok "s3 loopback [::1] public endpoint" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT="http://[::1]:9000" -- --storage s3
expect_reject "s3 127.999.999.999 is not loopback" "S3_PUBLIC_ENDPOINT must be https" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT=http://127.999.999.999:9000 -- --storage s3
expect_reject "s3 127.0.0.01 is not loopback" "S3_PUBLIC_ENDPOINT must be https" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT=http://127.0.0.01:9000 -- --storage s3
expect_reject "s3 127.evil.com is not loopback" "S3_PUBLIC_ENDPOINT must be https" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT=http://127.evil.com:9000 -- --storage s3
expect_reject "s3 127.0.0.1.evil.com is not loopback" "S3_PUBLIC_ENDPOINT must be https" S3_BUCKET=b \
	S3_REGION=us-east-1 S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT=http://127.0.0.1.evil.com:9000 -- \
	--storage s3
expect_reject "s3 http endpoint without flag" "must be https" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=http://minio.internal:9000 S3_PUBLIC_ENDPOINT=https://s3.example.test -- --storage s3
expect_reject "s3 http public endpoint" "S3_PUBLIC_ENDPOINT must be https" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=http://minio.internal:9000 S3_PUBLIC_ENDPOINT=http://s3.example.test -- \
	--storage s3 --allow-http-s3-endpoint
expect_reject "s3 --allow-http with https endpoint" "only applies to an http://" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test S3_PUBLIC_ENDPOINT=https://s3.example.test -- --storage s3 --allow-http-s3-endpoint
expect_reject "s3 endpoint without public endpoint" "needs S3_PUBLIC_ENDPOINT" S3_BUCKET=b S3_REGION=us-east-1 \
	S3_ENDPOINT=https://s3.example.test -- --storage s3
expect_reject "s3 missing bucket" "S3_BUCKET" S3_REGION=us-east-1 -- --storage s3
expect_reject "s3 missing region" "S3_REGION" S3_BUCKET=b -- --storage s3
expect_reject "s3 key without secret" "together" S3_BUCKET=b S3_REGION=us-east-1 S3_ACCESS_KEY_ID=k -- --storage s3
expect_reject "s3 secret without key" "together" S3_BUCKET=b S3_REGION=us-east-1 S3_SECRET_ACCESS_KEY=s -- --storage s3
expect_reject "s3 bad path style" "S3_FORCE_PATH_STYLE" S3_BUCKET=b S3_REGION=us-east-1 S3_FORCE_PATH_STYLE=yes -- \
	--storage s3

# --- GCS ---
expect_ok "gcs" GCS_BUCKET=g GCS_PROJECT_ID=p -- --storage gcs
expect_value "gcs" STORAGE_DRIVER gcs
expect_value "gcs" GCS_BUCKET g
expect_value "gcs" GCS_PROJECT_ID p
expect_absent "gcs" GCS_SERVICE_ACCOUNT_KEY_BASE64
expect_reject "gcs missing bucket" "GCS_BUCKET" -- --storage gcs

# --- both external: the e2e case G shape ---
expect_ok "external db + CA + s3" DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$(mig_url "$ca")" \
	S3_BUCKET=b S3_REGION=us-east-1 S3_ENDPOINT=http://host.docker.internal:9000 \
	S3_PUBLIC_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY_ID=k S3_SECRET_ACCESS_KEY=s -- \
	--external-db --db-ca-file "$ca_file" --storage s3 --allow-http-s3-endpoint
expect_value "external db + CA + s3" COMPOSE_FILE compose.yml:compose.db-ca.yml
expect_value "external db + CA + s3" S3_HTTP_HOSTS host.docker.internal
both_env=$out_file

expect_ok "external db + CA + external TLS" DATABASE_URL="$(app_url "$ca")" MIGRATE_DATABASE_URL="$(mig_url "$ca")" -- \
	--external-db --db-ca-file "$ca_file" --tls external
expect_value "external db + CA + external TLS" COMPOSE_FILE compose.yml:compose.db-ca.yml:compose.tls-external.yml

# compose must read the generated files as data: render them (no daemon needed).
# render ENV_FILE [EXTRA_LAYER]: the rendered JSON of the file's COMPOSE_FILE, plus EXTRA_LAYER.
render() {
	local files
	files=$(sed -n "s/^COMPOSE_FILE='\\(.*\\)'\$/\\1/p" "$1")${2:+:$2}
	(cd "$script_dir" && COMPOSE_FILE="$files" "$real_docker" compose --env-file "$1" config --format json 2>"$work/config.err")
}

if [[ -n "$real_docker" ]] && command -v jq >/dev/null && "$real_docker" compose version >/dev/null 2>&1; then
	for f in "$bundled_env" "$both_env" "$external_env"; do
		if rendered=$(render "$f"); then
			want=$(sed -n "s/^DATABASE_URL='\\(.*\\)'\$/\\1/p" "$f")
			got=$(jq -r '.services.api.environment.DATABASE_URL' <<<"$rendered")
			if [[ "$got" == "$want" ]]; then
				pass "compose config reads $(basename "$f")"
			else
				fail "compose config: api DATABASE_URL is '$got', want '$want'"
			fi
			[[ "$(jq -r '.services.api.image' <<<"$rendered")" == "ghcr.io/cleverse/exagram-api:local" ]] &&
				pass "compose config: published image names" || fail "compose config: api image"
		else
			fail "compose config on $(basename "$f"): $(cat "$work/config.err")"
		fi
	done

	if rendered=$(render "$bundled_env"); then
		[[ "$(jq -c '[.services.caddy.ports[] | "\(.host_ip // "")|\(.published)|\(.target)"] | sort' <<<"$rendered")" == \
			'["|443|443","|443|443","|80|80"]' ]] && pass "acme: caddy publishes 80 and 443" ||
			fail "acme: caddy ports $(jq -c '.services.caddy.ports' <<<"$rendered")"
		[[ "$(jq -r '.services.caddy.environment.EXAGRAM_TLS // "unset"' <<<"$rendered")" == unset ]] &&
			pass "acme: caddy keeps the default TLS mode" || fail "acme: caddy EXAGRAM_TLS is set"
	fi
	if rendered=$(render "$external_env"); then
		[[ "$(jq -c '[.services.caddy.ports[] | "\(.host_ip)|\(.published)|\(.target)"]' <<<"$rendered")" == \
			'["127.0.0.1|8080|80"]' ]] && pass "external: caddy publishes only HTTP_BIND" ||
			fail "external: caddy ports $(jq -c '.services.caddy.ports' <<<"$rendered")"
		[[ "$(jq -c '.services.caddy.environment | {EXAGRAM_TLS, EXAGRAM_SITE_SCHEME, EXAGRAM_CLIENT_IP_HEADER}' <<<"$rendered")" == \
			'{"EXAGRAM_TLS":"external","EXAGRAM_SITE_SCHEME":"http://","EXAGRAM_CLIENT_IP_HEADER":"X-Forwarded-For"}' ]] &&
			pass "external: caddy environment" || fail "external: caddy environment"
		[[ "$(jq -r '.services.api.environment.CLIENT_IP_HEADER' <<<"$rendered")" == x-real-ip ]] &&
			pass "external: api still reads X-Real-IP" || fail "external: api CLIENT_IP_HEADER"
	else
		fail "compose config on the external TLS env: $(cat "$work/config.err")"
	fi
	if rendered=$(render "$bundled_env" compose.build.yml); then
		[[ "$(jq -c '[.services | to_entries[] | select(.value.build) | "\(.key)=\(.value.image)@\(.value.build.target)"] | sort' <<<"$rendered")" == \
			'["api=exagram-selfhost/api:local@api","caddy=exagram-selfhost/web:local@web","migrate=exagram-selfhost/migrate:local@migrate","preflight=exagram-selfhost/api:local@api","usercontent=exagram-selfhost/usercontent:local@usercontent","worker=exagram-selfhost/worker:local@worker"]' ]] &&
			pass "compose.build.yml builds every image locally" ||
			fail "compose.build.yml: $(jq -c '[.services | to_entries[] | {(.key): [.value.image, .value.build.target]}]' <<<"$rendered")"
	else
		fail "compose config with compose.build.yml: $(cat "$work/config.err")"
	fi
else
	echo "SKIP: docker compose not found; generated .env not rendered through compose"
fi

echo "$failures failure(s)"
[[ "$failures" -eq 0 ]]
