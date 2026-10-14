#!/usr/bin/env bash
set -euo pipefail

# HTTP post-deploy checks against a running Exagram, from outside. Needs only curl and jq; no Docker,
# no .env. Usage:
#
#   smoke.sh APP_URL UC_URL
#   smoke.sh https://exagram.acme.com https://exagram-files.acme.com
#
# APP_URL is the web/API origin, UC_URL the usercontent origin. Each is scheme://host[:port] with no
# path. The app is expected to name itself by https://<host of APP_URL> (its API_ORIGIN) and the
# usercontent origin as https://<host of UC_URL>, whatever scheme the requests use, so a check made at
# plain http:// behind a TLS-terminating proxy still passes.
#
#   SMOKE_CURL_OPTS           extra curl arguments for every request, split on whitespace
#                             (e.g. "--connect-to app.test:443:127.0.0.1:8443 --cacert /path/root.crt")
#   SMOKE_SKIP_HTTP_REDIRECT  1: skip the http:// -> https:// redirect check, for when a proxy in front
#                             owns http://. The check only runs when APP_URL is https://, and requests
#                             http://<host of APP_URL>/ on the default port.
#   SMOKE_NO_SUMMARY          1: print only the check lines, for a wrapper that prints its own summary

if [[ $# -ne 2 ]]; then
	echo "usage: smoke.sh APP_URL UC_URL" >&2
	exit 2
fi

for bin in curl jq; do
	if ! command -v "$bin" >/dev/null 2>&1; then
		echo "FAIL: $bin not found on PATH" >&2
		exit 1
	fi
done

# Sets ${prefix}_scheme, ${prefix}_host (no port) and ${prefix}_hostport.
parse_url() {
	local prefix=$1 url=${2%/}
	if [[ ! "$url" =~ ^(https?)://(\[[0-9a-fA-F:]+\]|[^/:@?#[:space:]]+)(:[0-9]+)?$ ]]; then
		echo "FAIL: not an origin (want scheme://host[:port]): $2" >&2
		exit 2
	fi
	printf -v "${prefix}_scheme" '%s' "${BASH_REMATCH[1]}"
	printf -v "${prefix}_host" '%s' "${BASH_REMATCH[2]}"
	printf -v "${prefix}_hostport" '%s' "${BASH_REMATCH[2]}${BASH_REMATCH[3]}"
}

parse_url app "$1"
parse_url uc "$2"
app_url="${app_scheme}://${app_hostport}"
uc_url="${uc_scheme}://${uc_hostport}"
app_origin="https://${app_host}"
uc_origin="https://${uc_host}"

curl_opts=()
if [[ -n "${SMOKE_CURL_OPTS:-}" ]]; then
	read -r -a curl_opts <<<"$SMOKE_CURL_OPTS"
fi
vcurl() {
	curl ${curl_opts[@]+"${curl_opts[@]}"} "$@"
}

failures=0

check() {
	local name=$1
	if "${@:2}"; then
		echo "PASS: $name"
	else
		echo "FAIL: $name"
		failures=$((failures + 1))
	fi
}

check_readiness() {
	local body
	body=$(vcurl -fsS "${app_url}/readiness") || return 1
	[[ "$body" == "OK" ]]
}

check_spa_root() {
	local status
	status=$(vcurl -s -o /dev/null -w '%{http_code}' "${app_url}/")
	[[ "$status" == "200" ]]
}

check_index_names_usercontent() {
	# The web image renders the usercontent origin into index.html from UC_HOST on every request,
	# also on the SPA fallback, and the page must not be cached.
	local path response want="<meta name=\"exagram-usercontent-origin\" content=\"${uc_origin}\" />"
	for path in / /oauth/consent/abc; do
		response=$(vcurl -fsS -i "${app_url}${path}") || return 1
		if ! grep -qF "$want" <<<"$response"; then
			echo "  GET $path: no $want" >&2
			return 1
		fi
		if ! grep -qix 'cache-control: no-store' <<<"${response//$'\r'/}"; then
			echo "  GET $path: no Cache-Control: no-store" >&2
			return 1
		fi
	done
}

check_spa_consent_route() {
	# /oauth/consent/<uid> is a React route (vite.config.ts's negative lookahead), not proxied.
	local status
	status=$(vcurl -s -o /dev/null -w '%{http_code}' "${app_url}/oauth/consent/abc")
	[[ "$status" == "200" ]]
}

check_protected_resource_metadata() {
	local body resource authz
	body=$(vcurl -fsS "${app_url}/.well-known/oauth-protected-resource") || return 1
	resource=$(jq -r '.resource' <<<"$body")
	authz=$(jq -r '.authorization_servers[0]' <<<"$body")
	[[ "$resource" == "${app_origin}/mcp" && "$authz" == "${app_origin}/oauth" ]]
}

check_oidc_issuer() {
	# Proves the issuer stays pinned to API_ORIGIN through the proxy (https://APP_HOST in either TLS mode).
	local body issuer
	body=$(vcurl -fsS "${app_url}/oauth/.well-known/openid-configuration") || return 1
	issuer=$(jq -r '.issuer' <<<"$body")
	[[ "$issuer" == "${app_origin}/oauth" ]]
}

check_usercontent_not_found() {
	local status
	status=$(vcurl -s -o /dev/null -w '%{http_code}' "${uc_url}/uc/x")
	[[ "$status" == "404" ]]
}

check_http_redirects_to_https() {
	local status
	status=$(vcurl -s -o /dev/null -w '%{http_code}' "http://${app_host}/")
	[[ "$status" =~ ^3 ]]
}

check "GET /readiness" check_readiness
check "GET / (SPA)" check_spa_root
check "index.html names https://UC_HOST, uncached" check_index_names_usercontent
check "GET /oauth/consent/abc (SPA route, not proxied)" check_spa_consent_route
check "GET /.well-known/oauth-protected-resource" check_protected_resource_metadata
check "GET /oauth/.well-known/openid-configuration" check_oidc_issuer
check "GET UC_HOST/uc/x -> 404" check_usercontent_not_found
if [[ "$app_scheme" == https && "${SMOKE_SKIP_HTTP_REDIRECT:-}" != 1 ]]; then
	check "GET http://APP_HOST/ -> redirect to https" check_http_redirects_to_https
fi

if [[ "$failures" -gt 0 ]]; then
	[[ "${SMOKE_NO_SUMMARY:-}" == 1 ]] || echo "$failures check(s) failed" >&2
	exit 1
fi
[[ "${SMOKE_NO_SUMMARY:-}" == 1 ]] || echo "all checks passed"
