# Networking

[Self-hosting overview](../self-host.md) · Networking

## TLS modes

| Mode                            | Who holds the certificates             | Choose it when                                                          |
| ------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Compose, `--tls acme` (default) | Caddy, from Let's Encrypt              | The machine has a public address and ports 80 and 443 free              |
| Compose, `--tls external`       | A tunnel or proxy in front             | No public address, ports taken, or something in front already holds TLS |
| Helm, `tls.mode=acme` (default) | Caddy, behind a `LoadBalancer` Service | The cluster gives load balancers a public address                       |
| Helm, `tls.mode=ingress`        | Your Ingress controller                | You already run an ingress controller and cert-manager                  |

With Caddy's own certificates, both host names must resolve to it before it can get them; it retries on its own until
they do, falling back to ZeroSSL if Let's Encrypt fails. Certificates are kept in the `caddy-data` volume and renewed
automatically.

## Behind a proxy or tunnel

Generate the configuration with `--tls external`:

```sh
./gen-secrets.sh --app-host exagram.example.com --tls external --client-ip-header Cf-Connecting-Ip
```

Caddy then gets no certificates and serves **both** host names as plain HTTP on one port, `127.0.0.1:8080` by default,
routing by host name. Point both public names at it:

- **Keep the original `Host` header.** Caddy routes `APP_HOST` and `UC_HOST` by it.
- **Don't buffer responses.** Live updates (`/v1/events`, `/l/<token>/events`) are server-sent events; a buffering proxy
  delays them until the buffer fills.
- **Allow request bodies of 21 MB** on `APP_HOST` (uploads with the filesystem store go through the api).
- **Name the client-address header** your proxy sets with `--client-ip-header` (`X-Forwarded-For` by default).

Cloudflare Tunnel has its own page: [Install on Cloudflare](install-cloudflare.md). A starting point for nginx (not
tested end to end), one server block for both names. It sets `X-Forwarded-For`, so generate the configuration with
`--client-ip-header X-Forwarded-For` (the default):

```nginx
server {
  listen 443 ssl;
  server_name exagram.example.com exagram-files.example.com;
  # ssl_certificate ... ; ssl_certificate_key ... ;
  client_max_body_size 21m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

`X-Forwarded-For $remote_addr` replaces whatever the caller sent with the address nginx saw.

## The client address

The request logs record it, and the limits on sign-in, sign-up, Google sign-in and open Link page streams count by it,
so it must be the real caller's. The Ledger doesn't record addresses.

- **Caddy's own TLS:** the address is the TCP peer. On Helm, the `LoadBalancer` Service uses
  `externalTrafficPolicy: Local` so the peer is the caller, not a node.
- **Behind a proxy or tunnel:** Caddy takes the address from the header you named, and only when the request came from a
  private address (the tunnel connector, the proxy, the Docker bridge). It reads a list in the header right to left, so
  an address a caller adds in front is never the one taken. Caddy passes the result to the api as `X-Real-IP`, replacing
  anything the caller sent.
- **Helm behind an Ingress:** as behind a proxy, from `ingress.clientIpHeader`. Keep the controller's Service on
  `externalTrafficPolicy: Local`.

Because Caddy trusts the header from any private address, the plain-HTTP port must be reachable only by the tunnel or
proxy. The default `127.0.0.1` bind does that for a connector or proxy on the same machine. For a proxy on another
machine, bind a private address with `--http-bind 10.0.0.5:8080` and firewall that port to the proxy alone. On Helm, the
chart's NetworkPolicies keep every Pod but Caddy away from the api.

Leave `CLIENT_IP_HEADER` at `x-real-ip`. The api reads it, and only Caddy sets it.

## Routes

Everything enters through Caddy.

| Host       | Path                                                                                        | Goes to                        |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| `APP_HOST` | `/v1/*`, `/mcp`, `/.well-known/*`, `/l/*`, `/oauth/*` except the consent page, `/readiness` | `api`                          |
| `APP_HOST` | A share URL fetched by a link-preview bot (Slack, Teams, …)                                 | `api`, which renders a preview |
| `APP_HOST` | Everything else                                                                             | The web app, served by Caddy   |
| `UC_HOST`  | Everything                                                                                  | `usercontent`                  |

`APP_HOST` responses carry HSTS, `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy. `UC_HOST` responses
carry their own Content-Security-Policy, which blocks previewed files' requests except to the CDN libraries
`usercontent` proxies; a file's scripts can still send out its own content (see [Security](security.md#built-in)).
