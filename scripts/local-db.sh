#!/usr/bin/env bash
# One shared local Postgres, one database per git worktree. See `local-db.sh help`.
set -euo pipefail

DEFAULT_PORT=25432
PG_IMAGE="${PG_IMAGE:-postgres:18}"

die() {
	echo "local-db: $*" >&2
	exit 1
}

# An isolated e2e stack exports COMPOSE_PROJECT_NAME, EXAGRAM_PG_PORT and DATABASE_URL; acting on
# the shared Postgres from that shell would recreate it on the e2e port or write that port into .env.
refuse_e2e_shell() {
	[[ -z "${COMPOSE_PROJECT_NAME:-}" || "${COMPOSE_PROJECT_NAME:-}" == exagram ]] ||
		die "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME: this looks like an e2e stack's shell. Open a new shell or run 'unset COMPOSE_PROJECT_NAME EXAGRAM_PG_PORT EXAGRAM_DB_NAME DATABASE_URL'."
}

abs_dir() { (cd "$1" && pwd -P); }

sha256_hex() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum | cut -d' ' -f1
	else
		shasum -a 256 | cut -d' ' -f1
	fi
}

# Database name for a linked worktree's absolute path: exagram_<sanitised basename>_<8 hex of the path's
# sha256>. The output is [a-z0-9_] only and at most 63 bytes, which is also what keeps it safe to
# interpolate into SQL. The path hash keeps same-named worktrees in different parents apart.
db_name_for_dir() {
	local path="$1" slug hash
	slug="$(printf '%s' "$(basename "$path")" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C tr -c 'a-z0-9' '_')"
	hash="$(printf '%s' "$path" | sha256_hex | cut -c1-8)"
	printf 'exagram_%s_%s\n' "${slug:0:46}" "$hash"
}

toplevel() { git rev-parse --show-toplevel; }

main_checkout() {
	local common
	common="$(abs_dir "$(git rev-parse --git-common-dir)")"
	dirname "$common"
}

is_linked_worktree() {
	local gitdir common
	gitdir="$(abs_dir "$(git rev-parse --git-dir)")"
	common="$(abs_dir "$(git rev-parse --git-common-dir)")"
	[[ "$gitdir" != "$common" ]]
}

expected_name() {
	if is_linked_worktree; then
		db_name_for_dir "$(abs_dir "$(toplevel)")"
	else
		echo exagram
	fi
}

resolve_port() {
	local port="${EXAGRAM_PG_PORT:-}"
	if [[ -z "$port" && -f "$(toplevel)/.env" ]]; then
		port="$(sed -n 's/^EXAGRAM_PG_PORT=//p' "$(toplevel)/.env" | tail -n 1)"
	fi
	port="${port:-$DEFAULT_PORT}"
	[[ "$port" =~ ^[0-9]+$ ]] || die "EXAGRAM_PG_PORT must be a number, got '$port'"
	echo "$port"
}

# Replaces the KEY= line in a file, or appends it. .env is not shell-sourceable, so it is only ever
# edited line-wise.
set_kv() {
	local file="$1" key="$2" value="$3" tmp esc
	esc="${value//\\/\\\\}"
	esc="${esc//&/\\&}"
	esc="${esc//#/\\#}"
	if grep -q "^$key=" "$file"; then
		tmp="$(mktemp "${TMPDIR:-/tmp}/local-db.XXXXXX")"
		sed "s#^$key=.*#$key=$esc#" "$file" >"$tmp"
		cat "$tmp" >"$file"
		rm -f "$tmp"
	else
		printf '%s=%s\n' "$key" "$value" >>"$file"
	fi
}

psql_admin() {
	local port
	port="$(resolve_port)"
	docker run --rm --network host "$PG_IMAGE" \
		psql "postgres://exagram:exagram@localhost:$port/postgres?sslmode=disable" \
		-v ON_ERROR_STOP=1 -tA "$@"
}

cmd_name() { expected_name; }

cmd_up() {
	local port
	refuse_e2e_shell
	port="$(resolve_port)"
	cd "$(main_checkout)"
	EXAGRAM_PG_PORT="$port" docker compose -p exagram up -d --wait postgres
}

# Writes .env and dbhub.toml for this checkout's database. No Docker, no network.
cmd_config() {
	local root name port url
	refuse_e2e_shell
	root="$(toplevel)"
	name="$(expected_name)"
	port="$(resolve_port)"
	url="postgres://exagram:exagram@localhost:$port/$name"

	[[ -f "$root/.env" ]] || cp "$root/.env.example" "$root/.env"
	set_kv "$root/.env" DATABASE_URL "$url?sslmode=disable&search_path=exagram%2Cpublic"
	set_kv "$root/.env" EXAGRAM_PG_PORT "$port"
	set_kv "$root/.env" EXAGRAM_DB_NAME "$name"

	sed -e "s#^dsn = .*#dsn = \"$url\"#" "$root/dbhub.example.toml" >"$root/dbhub.toml"
}

cmd_init() {
	local root name port url from="${FROM:-}" exists
	refuse_e2e_shell
	root="$(toplevel)"
	name="$(expected_name)"
	port="$(resolve_port)"
	url="postgres://exagram:exagram@localhost:$port/$name"

	if [[ -n "$from" ]]; then
		[[ "$from" =~ ^[a-z0-9_]+$ ]] || die "FROM must match ^[a-z0-9_]+\$, got '$from'"
		[[ "$from" != "$name" ]] || die "FROM is this checkout's own database"
	fi

	exists="$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$name'")" ||
		die "cannot reach Postgres on localhost:$port; run 'make local-db-up', and if it is already up check which host port the main checkout's docker-compose.yml publishes (it must match EXAGRAM_PG_PORT=$port)"
	if [[ -n "$exists" && -n "$from" ]]; then
		die "database '$name' already exists, so FROM=$from cannot clone into it; run 'make local-db-drop' first"
	fi
	if [[ -z "$exists" ]]; then
		if [[ -n "$from" ]]; then
			psql_admin -c "CREATE DATABASE \"$name\" TEMPLATE \"$from\"" ||
				die "cloning '$from' failed; Postgres refuses while anything is connected to it (stop the API/worker using it)"
		else
			psql_admin -c "CREATE DATABASE \"$name\""
		fi
	fi

	cmd_config

	make -C "$root" local-migrate-up DATABASE_URL="$url?sslmode=disable&search_path=exagram%2Cpublic"
	echo "local-db: $name ready on localhost:$port"
}

cmd_drop() {
	local name
	name="$(expected_name)"
	[[ "$name" != exagram && "$name" == exagram_* ]] ||
		die "refusing to drop '$name'; only worktree databases (exagram_*) can be dropped"
	psql_admin -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)"
	echo "local-db: dropped $name"
}

# Refuses when a DATABASE_URL names a database other than this checkout's own, e.g. a
# worktree that inherited main's .env. ALLOW_OTHER_DB=1 overrides.
cmd_guard() {
	local url="${1:-}" rest auth path userinfo user db expected q kv
	[[ -n "$url" ]] || return 0
	[[ "${ALLOW_OTHER_DB:-}" != 1 ]] || return 0
	rest="${url#*://}"
	auth="${rest%%[/?#]*}"
	path="${rest#"$auth"}"
	userinfo=""
	[[ "$auth" == *@* ]] && userinfo="${auth%@*}"
	user="${userinfo%%:*}"
	db=""
	q=""
	[[ "$path" == *\?* ]] && q="${path#*\?}"
	if [[ "$path" == /* ]]; then
		db="${path#/}"
		db="${db%%[?#]*}"
	fi
	if [[ -z "$db" ]]; then
		local IFS='&'
		for kv in $q; do
			[[ "$kv" == dbname=* ]] && db="${kv#dbname=}"
		done
		IFS=$' \t\n'
		[[ -n "$db" ]] || db="$user"
	fi
	[[ -n "$db" ]] || return 0
	expected="$(expected_name)"
	[[ "$db" == "$expected" ]] && return 0
	die "DATABASE_URL points at '$db' but this checkout's database is '$expected'.
Run 'make local-db-init' to point .env at it, or set ALLOW_OTHER_DB=1 to use '$db' anyway."
}

usage() {
	cat <<'EOF'
Usage: scripts/local-db.sh <command>

  name    print this checkout's database name (main checkout: exagram; worktree: exagram_<dir>_<path hash>)
  up      start the shared Postgres (compose project "exagram", run from the main checkout)
  config  write .env and dbhub.toml for this checkout's database without touching Postgres
  init    point .env and dbhub.toml at this checkout's database, create it, migrate it
          FROM=<db> clones <db> instead (fails while anything is connected to <db>)
  drop    drop this worktree's database (never the main checkout's)
  guard   <url>  refuse a DATABASE_URL that names another checkout's database

Port: EXAGRAM_PG_PORT from the environment, else .env, else 25432.
EOF
}

main() {
	case "${1:-}" in
	name) cmd_name ;;
	up) cmd_up ;;
	config) cmd_config ;;
	init) cmd_init ;;
	drop) cmd_drop ;;
	guard) shift && cmd_guard "$@" ;;
	*) usage && [[ "${1:-}" == help || "${1:-}" == -h ]] ;;
	esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
