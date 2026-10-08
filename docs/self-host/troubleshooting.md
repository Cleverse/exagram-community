# Troubleshooting

[Self-hosting overview](../self-host.md) · Troubleshooting

Start with `./verify.sh` (Compose) or `helm test exagram --namespace exagram` (Helm): each names the check that fails.

## On Compose

- **`migrate` never runs.** `preflight` refused the configuration. Read `docker compose logs preflight`: it names the
  setting, URL parameter or host (never the password) and, for the filesystem store, the directory it couldn't write.
- **An app restarts in a loop.** It checks its own settings when it starts, including the optional features'. Read
  `docker compose logs <app>`: it names the setting.
- **`docker compose` rejects `!override`.** Compose is older than 2.24.4. Upgrade it.
- **No certificate, or the browser warns** (Caddy's own TLS). Read `docker compose logs caddy`. Both names must resolve
  to the machine and ports 80 and 443 must be reachable from the internet; Caddy retries on its own once they are.
- **The tunnel or proxy shows an error page** (`--tls external`). `./verify.sh` checks the stack at the plain-HTTP port.
  If it passes, the tunnel or proxy isn't reaching that port, or isn't keeping the `Host` header; if it fails, read its
  output and `docker compose logs caddy api`.
- **The api doesn't come up.** Read `docker compose logs api`, and check the migration state:
  `docker compose run --rm --no-deps migrate 'exec migrate -path=/migrations -database="$MIGRATE_DATABASE_URL" version'`
  (single quotes: the container expands the URL, not your shell).
- **`preflight` says "this deploy/.env was generated for the MinIO-based layout".** See
  [Installs from before the layer split](#installs-from-before-the-layer-split).

## On Helm

- **`helm install` or `helm upgrade` fails on the migrate Job.** `preflight` refused the configuration, or a migration
  failed. Read `kubectl --namespace exagram logs job/exagram-migrate-<revision> --container preflight`, then
  `--container migrate`; `helm history exagram --namespace exagram` lists the revisions. If the release changes the
  schema, the previous revision's `api`, `worker` and `usercontent` keep running.
- **Apps stay in `Init`.** They wait for the schema the migrate Job writes. Read that Job's log as above, and
  `kubectl --namespace exagram logs deploy/exagram-api --container wait-for-schema`.
- **Pods stay `Pending`.** `kubectl --namespace exagram describe pod <pod>`. Usually no default StorageClass, or, with
  the filesystem store, the node holding the volume lacks room for all three apps.
- **The `web` Service gets no address** (`tls.mode=acme`). The cluster gives `LoadBalancer` Services no public address.
  Install a load balancer (MetalLB, k3s's ServiceLB), or use `tls.mode=ingress`.
- **No certificate** (`tls.mode=acme`). `kubectl --namespace exagram logs deploy/exagram-web`. Both names must resolve
  to the Service's address and ports 80 and 443 must reach it.
- **After an Argo CD or Flux sync, the apps can't reach the database.** The render generated a new Secret; see
  [GitOps](install-helm.md#gitops-argo-cd-flux).

## In the app

- **Live updates arrive late or not at all.** Something in front buffers responses: turn buffering off for both names
  (see [Behind a proxy or tunnel](networking.md#behind-a-proxy-or-tunnel)).
- **Uploads fail with a bucket.** The bucket's CORS doesn't allow `PUT` from `https://APP_HOST` with the right headers,
  or `S3_PUBLIC_ENDPOINT` isn't reachable from browsers. Run `VERIFY_OBJECT_KEY=<a stored key> ./verify.sh`, and see the
  [bucket requirements](configuration.md#bucket-requirements).
- **An upload is refused as too large.** Files are limited to 20 MiB.
- **HTML Artifacts render unstyled or blank.** `usercontent` can't reach the CDN hosts it proxies (see
  [Outbound connections](requirements.md#outbound-connections)).
- **PowerPoint previews don't load.** Microsoft's viewer fetches the file from `UC_HOST`, which must be reachable from
  the internet.
- **Claude or ChatGPT can't connect.** `https://APP_HOST/mcp` must be reachable from the internet with a publicly
  trusted certificate, and nothing in front may require its own login.
- **An AI tool is refused an Artifact a person can read.** The Connection's folder access may exclude it.
- **Locked out.** See [Password reset](accounts.md#password-reset).

## Installs from before the layer split

`preflight` stops with "this deploy/.env was generated for the MinIO-based layout" when `.env` sets `S3_HOST`, which
only the early bundled-MinIO layout wrote. It changed nothing: the database and files are as they were. That layout
can't be upgraded in place, because its files live in a MinIO volume this version doesn't read. Extract the bundle you
were running before and run `docker compose up -d` to keep using it, and back it up; moving to this version means a
fresh install and copying your files across yourself.

## Reporting a problem

Collect these, with secrets removed:

- The version: `cat VERSION`, or `helm list --namespace exagram`.
- The install: Compose or Helm, the TLS mode, bundled or brought database and store, and what sits in front.
- The output of `./verify.sh` or `helm test exagram --namespace exagram --logs`.
- Logs from the failing service around the time of the problem: `docker compose logs --since 30m <service>`, or
  `kubectl --namespace exagram logs deploy/exagram-<app> --since 30m`.
- `docker compose ps --all`, or `kubectl --namespace exagram get pods,jobs`.
- What you did, what you expected, and what happened instead.

`.env`, the Secret, and database URLs hold passwords and keys. Never share them.
