#!/usr/bin/env bash
set -euo pipefail

# Generates .env next to this script from scratch: hosts, TLS mode and ACME email from flags; the
# layers (bundled or external database, object store) from flags; external connection values from
# environment variables of the same name, so secrets stay out of `ps`.
# Everything else (passwords, signing keys, JWKS) is freshly random. Refuses to overwrite an
# existing .env. Nothing sources the result: every value is single-quoted dotenv, read by docker
# compose and verify.sh.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${GEN_SECRETS_ENV_FILE:-$script_dir/.env}"

usage() {
	cat >&2 <<'EOF'
usage: gen-secrets.sh --app-host HOST [--uc-host HOST]
                      [--tls acme --acme-email EMAIL | --tls external [--client-ip-header NAME] [--http-bind ADDR]]
                      [--external-db [--db-ca-file PATH] [--db-ca-is-server-specific] [--db-plaintext]]
                      [--storage filesystem|s3|gcs] [--allow-http-s3-endpoint]

--uc-host         the usercontent host; default: "-files" after APP_HOST's first label
                  (exagram.acme.com -> exagram-files.acme.com), which needs 3 or more labels
--tls acme        the default: Caddy gets certificates itself on ports 80 and 443; needs --acme-email
--tls external    a TLS-terminating proxy or tunnel in front: Caddy serves both hosts as plain HTTP
                  on --http-bind (default 127.0.0.1:8080), and takes the client address from the
                  proxy's --client-ip-header (default X-Forwarded-For; Cloudflare: Cf-Connecting-Ip)
--external-db     reads DATABASE_URL and MIGRATE_DATABASE_URL from the environment
--storage s3      reads S3_BUCKET, S3_REGION and optionally S3_ENDPOINT, S3_PUBLIC_ENDPOINT,
                  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE from the environment
--storage gcs     reads GCS_BUCKET and optionally GCS_PROJECT_ID, GCS_SERVICE_ACCOUNT_KEY_BASE64
EOF
	exit 1
}

die() {
	echo "gen-secrets: $*" >&2
	exit 1
}

app_host=""
uc_host=""
tls=acme
acme_email=""
client_ip_header=""
http_bind=""
external_db=false
db_ca_file=""
db_ca_is_server_specific=false
db_plaintext=false
storage=filesystem
allow_http_s3_endpoint=false

while [[ $# -gt 0 ]]; do
	case "$1" in
	--app-host | --uc-host | --tls | --acme-email | --client-ip-header | --http-bind | --db-ca-file | --storage)
		[[ $# -ge 2 ]] || die "$1 needs a value"
		case "$1" in
		--app-host) app_host=$2 ;;
		--uc-host) uc_host=$2 ;;
		--tls) tls=$2 ;;
		--acme-email) acme_email=$2 ;;
		--client-ip-header) client_ip_header=$2 ;;
		--http-bind) http_bind=$2 ;;
		--db-ca-file) db_ca_file=$2 ;;
		--storage) storage=$2 ;;
		esac
		shift 2
		;;
	--external-db) external_db=true && shift ;;
	--db-ca-is-server-specific) db_ca_is_server_specific=true && shift ;;
	--db-plaintext) db_plaintext=true && shift ;;
	--allow-http-s3-endpoint) allow_http_s3_endpoint=true && shift ;;
	-h | --help) usage ;;
	*)
		echo "gen-secrets: unknown argument: $1" >&2
		usage
		;;
	esac
done

[[ -n "$app_host" ]] ||
	{
		echo "gen-secrets: --app-host is required" >&2
		usage
	}

# Lower-case DNS names, nothing else: the web image renders https://UC_HOST into index.html only
# when it has this shape (caddy/usercontent-origin.html), and the apps build their origins from both.
host_re='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'
[[ "$app_host" =~ $host_re ]] || die "--app-host must be a lower-case host name, without scheme, port or path: $app_host"

# The default stays one level deep beside APP_HOST (a sibling, not a subdomain of it), so a wildcard
# certificate for APP_HOST's parent, such as Cloudflare Universal SSL's, covers both hosts.
uc_host_derived=false
if [[ -z "$uc_host" ]]; then
	app_labels=${app_host//[^.]/}
	if [[ ${#app_labels} -lt 2 ]]; then
		die "--uc-host is required when --app-host has fewer than 3 labels ($app_host): the default, \"-files\" after the first label, would need a host like app.example.com"
	fi
	uc_host="${app_host%%.*}-files.${app_host#*.}"
	[[ ${#uc_host} -le 253 && "${uc_host%%.*}" =~ ^.{1,63}$ ]] ||
		die "--uc-host is required: the default ${uc_host%%.*} is longer than a DNS label allows"
	uc_host_derived=true
fi
[[ "$uc_host" =~ $host_re ]] || die "--uc-host must be a lower-case host name, without scheme, port or path: $uc_host"
[[ "$app_host" != "$uc_host" ]] || die "--uc-host must differ from --app-host: HTML bodies would run on the app's origin"

case "$tls" in
acme)
	[[ -n "$acme_email" ]] || die "--tls acme (the default) needs --acme-email"
	[[ -z "$client_ip_header" && -z "$http_bind" ]] || die "--client-ip-header and --http-bind need --tls external"
	;;
external)
	[[ -z "$acme_email" ]] || die "--acme-email does not apply to --tls external: the proxy in front holds the certificates"
	client_ip_header=${client_ip_header:-X-Forwarded-For}
	http_bind=${http_bind:-127.0.0.1:8080}
	[[ "$client_ip_header" =~ ^[A-Za-z0-9-]+$ ]] || die "--client-ip-header must be a header name: $client_ip_header"
	# IPv4:PORT or [IPv6]:PORT; a bare port would publish on every interface.
	bind_re='^([0-9]{1,3}(\.[0-9]{1,3}){3}|\[[0-9A-Fa-f:.]+\]):([0-9]{1,5})$'
	[[ "$http_bind" =~ $bind_re ]] && ((10#${BASH_REMATCH[3]} >= 1 && 10#${BASH_REMATCH[3]} <= 65535)) ||
		die "--http-bind must be ADDRESS:PORT (127.0.0.1:8080, 0.0.0.0:8080, [::1]:8080): $http_bind"
	;;
*) die "--tls must be acme or external, not: $tls" ;;
esac

case "$storage" in
filesystem | s3 | gcs) ;;
*) die "--storage must be filesystem, s3 or gcs, not: $storage" ;;
esac

if [[ "$external_db" == false ]]; then
	[[ -z "$db_ca_file" && "$db_ca_is_server_specific" == false && "$db_plaintext" == false ]] ||
		die "--db-ca-file, --db-ca-is-server-specific and --db-plaintext need --external-db"
fi
if [[ "$storage" != s3 && "$allow_http_s3_endpoint" == true ]]; then
	die "--allow-http-s3-endpoint needs --storage s3"
fi

if [[ -e "$env_file" ]]; then
	die "refusing to overwrite existing $env_file"
fi

# --- URL helpers -------------------------------------------------------------------------------

is_loopback() {
	case "$1" in
	localhost | ::1 | "[::1]") return 0 ;;
	esac
	# Four decimal octets, 0-255, no leading zeros, first one 127.
	local re='^127\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$' octet
	[[ "$1" =~ $re ]] || return 1
	for octet in "${BASH_REMATCH[@]:1}"; do
		((octet <= 255)) || return 1
	done
}

# Host of scheme://[userinfo@]host[:port][/path][?query]; IPv6 keeps its brackets, as URL.hostname
# does. Userinfo must percent-encode "/", "?" and "#", as any URL must.
url_host() {
	local rest=${1#*://}
	rest=${rest%%[/?#]*}
	rest=${rest##*@}
	if [[ "$rest" == \[* ]]; then
		echo "${rest%%]*}]"
	else
		echo "${rest%%:*}"
	fi
}

# Port of scheme://[userinfo@]host[:port]/...; 5432 when absent.
url_port() {
	local rest=${1#*://}
	rest=${rest%%[/?#]*}
	rest=${rest##*@}
	if [[ "$rest" == \[* ]]; then
		rest=${rest#*]}
	else
		rest=${rest#"${rest%%:*}"}
	fi
	rest=${rest#:}
	echo "${rest:-5432}"
}

# Percent-decoded database name: the first path segment, before any query or fragment.
url_dbname() {
	local rest=${1#*://} path
	rest=${rest%%[?#]*}
	[[ "$rest" == */* ]] || return 0
	path=${rest#*/}
	pct_decode "${path%%/*}"
}

url_scheme() {
	echo "${1%%://*}"
}

url_query() {
	local url=${1%%#*}
	if [[ "$url" == *\?* ]]; then
		echo "${url#*\?}"
	fi
}

# Percent-decodes $1, as the runtime's URL parser does before it reads sslrootcert.
pct_decode() {
	printf '%b' "${1//%/\\x}"
}

# Prints the value of the first KEY=value pair in the query, or fails if the key is absent.
query_get() {
	local pair pairs
	IFS='&' read -r -a pairs <<<"$1"
	for pair in ${pairs[@]+"${pairs[@]}"}; do
		if [[ "${pair%%=*}" == "$2" ]]; then
			if [[ "$pair" == *=* ]]; then
				echo "${pair#*=}"
			fi
			return 0
		fi
	done
	return 1
}

query_keys() {
	local pair pairs
	IFS='&' read -r -a pairs <<<"$1"
	for pair in ${pairs[@]+"${pairs[@]}"}; do
		[[ -n "$pair" ]] && echo "${pair%%=*}"
	done
	return 0
}

# --- External database ------------------------------------------------------------------------

readonly DB_CA_PATH=/certs/db-ca.pem
readonly APP_URL_PARAMS=" sslmode sslrootcert search_path application_name connect_timeout "
readonly MIGRATE_URL_PARAMS=" sslmode sslrootcert x-migrations-table x-migrations-table-quoted connect_timeout "

database_plaintext_hosts=""
database_ca_server_specific=""
database_ca_file_abs=""

check_db_url() {
	local name=$1 url=$2 allowed=$3 scheme query key seen=" "
	[[ -n "$url" ]] || die "--external-db needs $name in the environment"
	scheme=$(url_scheme "$url")
	[[ "$scheme" == postgres || "$scheme" == postgresql ]] || die "$name must be a postgres:// URL"
	[[ -n "$(url_host "$url")" ]] || die "$name has no host"
	query=$(url_query "$url")
	while IFS= read -r key; do
		[[ -z "$key" ]] && continue
		[[ "$allowed" == *" $key "* ]] || die "$name: parameter $key is not allowed (allowed:$allowed)"
		# libpq and pg read the last value, URLSearchParams the first: refuse the ambiguity, as db-tls.ts does.
		[[ "$seen" != *" $key "* ]] || die "$name sets $key more than once"
		seen="$seen$key "
	done < <(query_keys "$query")
	return 0
}

if [[ "$external_db" == true ]]; then
	database_url=${DATABASE_URL:-}
	migrate_database_url=${MIGRATE_DATABASE_URL:-}
	check_db_url DATABASE_URL "$database_url" "$APP_URL_PARAMS"
	check_db_url MIGRATE_DATABASE_URL "$migrate_database_url" "$MIGRATE_URL_PARAMS"
	app_target=$(printf '%s:%s/%s' "$(url_host "$database_url" | tr '[:upper:]' '[:lower:]')" "$(url_port "$database_url")" "$(url_dbname "$database_url")")
	migrate_target=$(printf '%s:%s/%s' "$(url_host "$migrate_database_url" | tr '[:upper:]' '[:lower:]')" "$(url_port "$migrate_database_url")" "$(url_dbname "$migrate_database_url")")
	[[ "$app_target" == "$migrate_target" ]] ||
		die "DATABASE_URL and MIGRATE_DATABASE_URL must name the same database (host, port and database name); only the user, password and parameters may differ"
	app_query=$(url_query "$database_url")
	migrate_query=$(url_query "$migrate_database_url")

	search_path=$(query_get "$app_query" search_path) || search_path=""
	[[ "$search_path" == "exagram%2Cpublic" || "$search_path" == "exagram%2cpublic" ]] ||
		die "DATABASE_URL needs search_path=exagram%2Cpublic"
	[[ "$(query_get "$migrate_query" x-migrations-table || true)" == "%22public%22.%22schema_migrations%22" ]] ||
		die "MIGRATE_DATABASE_URL needs x-migrations-table=%22public%22.%22schema_migrations%22"
	[[ "$(query_get "$migrate_query" x-migrations-table-quoted || true)" == "1" ]] ||
		die "MIGRATE_DATABASE_URL needs x-migrations-table-quoted=1"

	app_sslmode=$(query_get "$app_query" sslmode) || die "DATABASE_URL has no sslmode (use verify-full, verify-ca or disable)"
	migrate_sslmode=$(query_get "$migrate_query" sslmode) || die "MIGRATE_DATABASE_URL has no sslmode (use verify-full, verify-ca or disable)"
	[[ "$app_sslmode" == "$migrate_sslmode" ]] ||
		die "DATABASE_URL and MIGRATE_DATABASE_URL must use the same sslmode ($app_sslmode vs $migrate_sslmode)"
	app_rootcert=$(pct_decode "$(query_get "$app_query" sslrootcert || true)")
	migrate_rootcert=$(pct_decode "$(query_get "$migrate_query" sslrootcert || true)")
	[[ "$app_rootcert" == "$migrate_rootcert" ]] ||
		die "DATABASE_URL and MIGRATE_DATABASE_URL must name the same sslrootcert"
	if [[ -n "$app_rootcert" && "$app_rootcert" != "$DB_CA_PATH" ]]; then
		die "sslrootcert must be $DB_CA_PATH (the mounted --db-ca-file), not: $app_rootcert"
	fi

	case "$app_sslmode" in
	verify-full | verify-ca) ;;
	disable) ;;
	require | prefer | allow)
		die "sslmode=$app_sslmode encrypts without verifying the server; use verify-full (or verify-ca with a server-specific CA)"
		;;
	*) die "unsupported sslmode: $app_sslmode" ;;
	esac

	if [[ -n "$db_ca_file" ]]; then
		[[ "$app_sslmode" != disable ]] || die "--db-ca-file does not apply to sslmode=disable"
		[[ -n "$app_rootcert" ]] || die "--db-ca-file needs sslrootcert=$DB_CA_PATH in both URLs"
		[[ -f "$db_ca_file" && -r "$db_ca_file" ]] || die "--db-ca-file is not a readable file: $db_ca_file"
		database_ca_file_abs="$(cd "$(dirname "$db_ca_file")" && pwd)/$(basename "$db_ca_file")"
	elif [[ -n "$app_rootcert" ]]; then
		die "sslrootcert=$DB_CA_PATH needs --db-ca-file, which mounts the CA there"
	fi

	if [[ "$app_sslmode" == verify-ca ]]; then
		[[ -n "$db_ca_file" ]] || die "sslmode=verify-ca needs --db-ca-file with a CA that belongs to this one server"
		[[ "$db_ca_is_server_specific" == true ]] ||
			die "sslmode=verify-ca needs --db-ca-is-server-specific: confirm the CA signs only this server's certificate, or use verify-full"
		database_ca_server_specific=true
	elif [[ "$db_ca_is_server_specific" == true ]]; then
		die "--db-ca-is-server-specific only applies to sslmode=verify-ca"
	fi

	if [[ "$app_sslmode" == disable ]]; then
		[[ "$db_plaintext" == true ]] ||
			die "sslmode=disable sends credentials and data unencrypted; pass --db-plaintext only on a trusted private network"
		database_plaintext_hosts=$(url_host "$database_url")
		migrate_host=$(url_host "$migrate_database_url")
		if [[ "$migrate_host" != "$database_plaintext_hosts" ]]; then
			database_plaintext_hosts="$database_plaintext_hosts,$migrate_host"
		fi
	elif [[ "$db_plaintext" == true ]]; then
		die "--db-plaintext only applies to sslmode=disable"
	fi
fi

# --- Object store -----------------------------------------------------------------------------

s3_http_hosts=""

check_https() {
	local name=$1 url=$2 scheme host
	scheme=$(url_scheme "$url")
	host=$(url_host "$url")
	[[ "$url" == *://* && -n "$host" ]] || die "$name is not a URL: $url"
	case "$scheme" in
	https) return 0 ;;
	http) is_loopback "$host" && return 0 ;;
	*) die "$name must be https://: $url" ;;
	esac
	return 1
}

if [[ "$storage" == s3 ]]; then
	[[ -n "${S3_BUCKET:-}" ]] || die "--storage s3 needs S3_BUCKET in the environment"
	[[ -n "${S3_REGION:-}" ]] || die "--storage s3 needs S3_REGION in the environment (R2: auto)"
	if [[ -n "${S3_ENDPOINT:-}" ]]; then
		[[ -n "${S3_PUBLIC_ENDPOINT:-}" ]] ||
			die "S3_ENDPOINT needs S3_PUBLIC_ENDPOINT, the address browsers upload to (often the same URL)"
		if check_https S3_ENDPOINT "$S3_ENDPOINT"; then
			[[ "$allow_http_s3_endpoint" == false || "$(url_scheme "$S3_ENDPOINT")" == http ]] ||
				die "--allow-http-s3-endpoint only applies to an http:// S3_ENDPOINT"
		elif [[ "$allow_http_s3_endpoint" == true ]]; then
			s3_http_hosts=$(url_host "$S3_ENDPOINT")
		else
			die "S3_ENDPOINT must be https:// (pass --allow-http-s3-endpoint only on a trusted private network): $S3_ENDPOINT"
		fi
	elif [[ "$allow_http_s3_endpoint" == true ]]; then
		die "--allow-http-s3-endpoint needs an http:// S3_ENDPOINT"
	fi
	if [[ -n "${S3_PUBLIC_ENDPOINT:-}" ]]; then
		check_https S3_PUBLIC_ENDPOINT "$S3_PUBLIC_ENDPOINT" ||
			die "S3_PUBLIC_ENDPOINT must be https://: browsers upload to it from an https page: $S3_PUBLIC_ENDPOINT"
	fi
	if [[ -n "${S3_ACCESS_KEY_ID:-}" && -z "${S3_SECRET_ACCESS_KEY:-}" ]] ||
		[[ -z "${S3_ACCESS_KEY_ID:-}" && -n "${S3_SECRET_ACCESS_KEY:-}" ]]; then
		die "set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY together, or neither (instance role)"
	fi
	case "${S3_FORCE_PATH_STYLE:-}" in
	"" | true | false) ;;
	*) die "S3_FORCE_PATH_STYLE must be true or false" ;;
	esac
elif [[ "$storage" == gcs ]]; then
	[[ -n "${GCS_BUCKET:-}" ]] || die "--storage gcs needs GCS_BUCKET in the environment"
fi

# --- Write ------------------------------------------------------------------------------------

compose_file=compose.yml
if [[ "$external_db" == false ]]; then
	compose_file="$compose_file:compose.postgres.yml"
elif [[ -n "$database_ca_file_abs" ]]; then
	compose_file="$compose_file:compose.db-ca.yml"
fi
if [[ "$tls" == external ]]; then
	compose_file="$compose_file:compose.tls-external.yml"
fi

usercontent_token_secret=$(openssl rand -hex 32)
upload_token_secret=$(openssl rand -hex 32)
oidc_cookie_keys=$(openssl rand -hex 32)

# Same recipe as apps/api/test/oauthApp.ts's testJwks(): one RSA-2048 signing key, Node crypto
# only (jose is not a root dependency). Pinned by digest, not tag, since this runs unattended.
oidc_jwks=$(docker run --rm node@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a node -e '
const { generateKeyPairSync, randomUUID } = require("node:crypto")
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const jwk = privateKey.export({ format: "jwk" })
process.stdout.write(JSON.stringify({ keys: [{ ...jwk, kid: randomUUID(), use: "sig", alg: "RS256" }] }))
')

if [[ "$external_db" == false ]]; then
	postgres_password=$(openssl rand -hex 24)
	database_url="postgres://exagram:${postgres_password}@postgres:5432/exagram?sslmode=disable&search_path=exagram%2Cpublic"
	migrate_database_url="postgres://exagram:${postgres_password}@postgres:5432/exagram?sslmode=disable&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22"
fi

out=""
line() {
	out+="$1"$'\n'
}

# Single quotes carry every byte literally except the quote itself and a newline.
kv() {
	local key=$1 value=$2 nl=$'\n'
	[[ "$value" != *"'"* ]] || die "$key contains a single quote, which .env can't carry"
	[[ "$value" != *"$nl"* && "$value" != *$'\r'* ]] || die "$key contains a newline, which .env can't carry"
	line "$key='$value'"
}

kv_if_set() {
	[[ -z "$2" ]] || kv "$1" "$2"
}

line "# Layers: compose.postgres.yml = bundled database, compose.db-ca.yml = private database CA,"
line "# compose.tls-external.yml = TLS terminated by a proxy in front."
kv COMPOSE_FILE "$compose_file"
line ""
kv APP_HOST "$app_host"
kv UC_HOST "$uc_host"
if [[ "$tls" == acme ]]; then
	kv ACME_EMAIL "$acme_email"
else
	kv HTTP_BIND "$http_bind"
	kv PROXY_CLIENT_IP_HEADER "$client_ip_header"
fi
line ""
kv NODE_ENV production
kv LOG_LEVEL info
line ""
if [[ "$external_db" == false ]]; then
	kv POSTGRES_PASSWORD "$postgres_password"
fi
kv DATABASE_URL "$database_url"
kv MIGRATE_DATABASE_URL "$migrate_database_url"
kv_if_set DATABASE_PLAINTEXT_HOSTS "$database_plaintext_hosts"
kv_if_set DATABASE_CA_FILE "$database_ca_file_abs"
kv_if_set DATABASE_CA_SERVER_SPECIFIC "$database_ca_server_specific"
line ""
kv STORAGE_DRIVER "$storage"
if [[ "$storage" == s3 ]]; then
	kv S3_BUCKET "$S3_BUCKET"
	kv S3_REGION "$S3_REGION"
	kv_if_set S3_ENDPOINT "${S3_ENDPOINT:-}"
	kv_if_set S3_PUBLIC_ENDPOINT "${S3_PUBLIC_ENDPOINT:-}"
	kv_if_set S3_HTTP_HOSTS "$s3_http_hosts"
	kv_if_set S3_FORCE_PATH_STYLE "${S3_FORCE_PATH_STYLE:-}"
	kv_if_set S3_ACCESS_KEY_ID "${S3_ACCESS_KEY_ID:-}"
	kv_if_set S3_SECRET_ACCESS_KEY "${S3_SECRET_ACCESS_KEY:-}"
elif [[ "$storage" == gcs ]]; then
	kv GCS_BUCKET "$GCS_BUCKET"
	kv_if_set GCS_PROJECT_ID "${GCS_PROJECT_ID:-}"
	kv_if_set GCS_SERVICE_ACCOUNT_KEY_BASE64 "${GCS_SERVICE_ACCOUNT_KEY_BASE64:-}"
fi
line ""
kv USERCONTENT_TOKEN_SECRET "$usercontent_token_secret"
kv UPLOAD_TOKEN_SECRET "$upload_token_secret"
kv OIDC_COOKIE_KEYS "$oidc_cookie_keys"
kv OIDC_JWKS "$oidc_jwks"
kv MCP_RATE_LIMIT_PER_MINUTE 60

umask 077
printf '%s' "$out" >"$env_file"
chmod 600 "$env_file"

echo "wrote $env_file"
if [[ "$uc_host_derived" == true ]]; then
	echo "UC_HOST=$uc_host (derived from --app-host; point DNS or the proxy at it as well)"
else
	echo "UC_HOST=$uc_host"
fi
