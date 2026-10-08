# Configuration

[Self-hosting overview](../self-host.md) · Configuration

## Where settings live

**Compose.** Every setting is a line in `.env` in the `exagram/` folder. `gen-secrets.sh` writes it; edit it afterwards
(values are single-quoted) and run `docker compose up -d`. `.env.example` in the bundle lists the settings with
comments. The apps check every setting when they start and refuse to run on a bad one, naming it in their log.

### Settings on Helm

The chart derives host names, database, storage and secrets from its own values. Other settings go under `env` by
variable name; the chart refuses a name it doesn't pass to any app. Secret ones go in a Secret you name in `envFrom`,
which the `api` and `worker` both read:

```sh
kubectl --namespace exagram create secret generic exagram-features \
  --from-literal=GOOGLE_CLIENT_SECRET=...
helm upgrade exagram oci://ghcr.io/cleverse/charts/exagram --version X.Y.Z --namespace exagram \
  --reset-then-reuse-values --set 'envFrom[0].secretRef.name=exagram-features' \
  --set env.GOOGLE_CLIENT_ID=....apps.googleusercontent.com --wait --wait-for-jobs
```

The apps read their settings when they start. A change to `env` or another value restarts them; a change only inside a
Secret (editing `exagram-features`, or a new storage key in values) doesn't, so restart them yourself:
`kubectl --namespace exagram rollout restart deployment exagram-api exagram-worker exagram-usercontent`.

## Settings reference

**Secret** settings are 32 or more characters; `gen-secrets.sh` and the chart generate them. Keep them with your backups
(see [Backup](operations.md#backup)). On Helm, a dash means the chart sets it from the values named, or fixes it.

### Install

| Variable                 | Default                 | Meaning                                                                                                        | Helm                     |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `APP_HOST`               | required                | The app's host name                                                                                            | `appHost`                |
| `UC_HOST`                | required                | The file preview host name                                                                                     | `ucHost`                 |
| `ACME_EMAIL`             | required with Caddy TLS | Let's Encrypt account email                                                                                    | `acmeEmail`              |
| `COMPOSE_FILE`           | written by the script   | Which compose files run: the layers you chose                                                                  | -                        |
| `EXAGRAM_VERSION`        | pinned in `compose.yml` | Set by the bundle; don't edit                                                                                  | `image.tag`              |
| `HTTP_BIND`              | `127.0.0.1:8080`        | `--tls external` only: where Caddy serves plain HTTP                                                           | -                        |
| `PROXY_CLIENT_IP_HEADER` | `X-Forwarded-For`       | `--tls external` only: the header your proxy sets to the client address                                        | `ingress.clientIpHeader` |
| `CLIENT_IP_HEADER`       | `x-real-ip`             | The header the api reads the client address from. Leave it; see [Networking](networking.md#the-client-address) | -                        |
| `LOG_LEVEL`              | `info`                  | `silent`, `fatal`, `error`, `warn`, `info`, `debug` or `trace`. Must be present in `.env`                      | `env.LOG_LEVEL`          |

### Accounts and sign-in

| Variable                    | Default   | Meaning                                                                                       | Helm                            |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------- | ------------------------------- |
| `GOOGLE_CLIENT_ID`          | unset     | With the secret, turns on Google sign-in                                                      | `env.GOOGLE_CLIENT_ID`          |
| `GOOGLE_CLIENT_SECRET`      | unset     | Secret. Google OAuth client secret                                                            | `env.` or `envFrom`             |
| `OIDC_COOKIE_KEYS`          | generated | Secret. Signs OAuth sign-in cookies                                                           | -                               |
| `OIDC_JWKS`                 | generated | Secret. The OAuth server's signing key: a JWK set or a PEM RSA private key, 2048 bits or more | -                               |
| `MCP_RATE_LIMIT_PER_MINUTE` | `60`      | MCP calls per Connection per minute. Must be present in `.env`                                | `env.MCP_RATE_LIMIT_PER_MINUTE` |

### Database

| Variable                      | Default   | Meaning                                                                             | Helm                                   |
| ----------------------------- | --------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| `DATABASE_URL`                | generated | Secret. The apps' connection string (see [Postgres contract](#postgres-contract))   | `database.external.url`                |
| `MIGRATE_DATABASE_URL`        | generated | Secret. The same database, for migrations                                           | `database.external.migrateUrl`         |
| `POSTGRES_PASSWORD`           | generated | Secret. The bundled database's password, also inside both URLs                      | -                                      |
| `DATABASE_MAX_CONNECTIONS`    | `10`      | Connections per app process, at least 2                                             | `env.DATABASE_MAX_CONNECTIONS`         |
| `DATABASE_PLAINTEXT_HOSTS`    | unset     | Hosts allowed `sslmode=disable`, comma-separated. The bundled database lists itself | `database.external.plaintextHosts`     |
| `DATABASE_CA_FILE`            | unset     | Absolute path on the host to a private CA, mounted at `/certs/db-ca.pem`            | `database.external.caSecret`           |
| `DATABASE_CA_SERVER_SPECIFIC` | `false`   | `true` allows `sslmode=verify-ca`, for a CA that signs only this one server         | `database.external.caIsServerSpecific` |

### Object store

| Variable                         | Default                 | Meaning                                                                  | Helm                                  |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `STORAGE_DRIVER`                 | `filesystem`            | `filesystem` (the bundled volume), `s3` or `gcs`                         | `storage.driver`                      |
| `S3_BUCKET`                      | `exagram`               | Bucket name                                                              | `storage.s3.bucket`                   |
| `S3_REGION`                      | `us-east-1`             | The bucket's real region (R2: `auto`)                                    | `storage.s3.region`                   |
| `S3_ENDPOINT`                    | AWS                     | Where the apps reach the store; omit for AWS                             | `storage.s3.endpoint`                 |
| `S3_PUBLIC_ENDPOINT`             | `S3_ENDPOINT`           | Where browsers upload; `https://`                                        | `storage.s3.publicEndpoint`           |
| `S3_ACCESS_KEY_ID`               | unset                   | With the secret key, static credentials; neither uses the instance role  | `storage.s3.accessKeyId`              |
| `S3_SECRET_ACCESS_KEY`           | unset                   | Secret                                                                   | `storage.s3.secretAccessKey`          |
| `S3_FORCE_PATH_STYLE`            | `true` with an endpoint | Path-style addressing; `false` for virtual-hosted style                  | `storage.s3.forcePathStyle`           |
| `S3_HTTP_HOSTS`                  | unset                   | Hosts allowed an `http://` `S3_ENDPOINT`, on a trusted private network   | `storage.s3.httpHosts`                |
| `GCS_BUCKET`                     | unset                   | Bucket name                                                              | `storage.gcs.bucket`                  |
| `GCS_PROJECT_ID`                 | unset                   | Project                                                                  | `storage.gcs.projectId`               |
| `GCS_SERVICE_ACCOUNT_KEY_BASE64` | unset                   | Secret. A service account key; without it, the machine's own credentials | `storage.gcs.serviceAccountKeyBase64` |
| `UPLOAD_TOKEN_SECRET`            | generated               | Secret. Signs upload URLs with the filesystem store                      | -                                     |
| `USERCONTENT_TOKEN_SECRET`       | generated               | Secret. Signs file preview URLs                                          | -                                     |

The apps also read a few settings these tables leave out (session length, token lifetimes, worker concurrency). Compose
doesn't pass them, so editing them in `.env` has no effect, and the chart's `env` refuses them. Leave them at their
defaults.

## Optional features

### Google sign-in

Create an OAuth client of type _Web application_ in Google Cloud Console, with the authorized redirect URI
`https://APP_HOST/v1/auth/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Existing accounts keep
signing in with their passwords, but new accounts are then created through Google only.

## Postgres contract

What a database you bring must provide.

- **Version:** 18, what the bundled layer runs and what is tested end to end. Other versions are untested.
- **Role:** one role that owns the database, not a superuser. It needs `CREATE` on the database (migrations create the
  `exagram` and `source_archive` schemas, `citext` is a trusted extension, and the job queue creates its `pgboss` schema
  on first start) and `CREATE` on schema `public` (for `public.schema_migrations` and `citext`; Postgres 15+ revokes
  this from `PUBLIC`, so a role that doesn't own the database needs an explicit grant). A separate migrator and app role
  is not supported.
- **URLs:** `DATABASE_URL` for the apps, with `search_path=exagram%2Cpublic`. `MIGRATE_DATABASE_URL` for migrations,
  without `search_path`, with `x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22`. One
  host each, direct to the server. Both must name the same host, port (default 5432) and database; only the user,
  password and parameters may differ. Both take the same `sslmode` and `sslrootcert`.
- **TLS:** `sslmode` and `sslrootcert` mean what they mean in libpq. The apps and `preflight` refuse to start on
  anything else, and `gen-secrets.sh` refuses to write it:
  - `verify-full` (recommended): the server certificate chains to the system roots, or to `sslrootcert`, and matches the
    host. Use it for RDS with the RDS CA bundle, Neon, and Azure (also behind a private endpoint).
  - `verify-ca`: only with `sslrootcert` naming a CA that belongs to this one server, and only with
    `DATABASE_CA_SERVER_SPECIFIC=true`. Cloud SQL's per-instance CA is one; its certificate carries a DNS name only with
    Private Service Connect. With a shared or public CA, any server holding a certificate from it would pass.
  - `disable`, or no `sslmode`: only for a loopback host, or a host listed in `DATABASE_PLAINTEXT_HOSTS` (exact match).
    `gen-secrets.sh` refuses a missing `sslmode`.
  - Refused: `require`, `prefer` and `allow` (they encrypt without verifying), `sslrootcert=system` (omit `sslrootcert`
    for the system roots), `sslrootcert` without TLS, a repeated parameter, `host` or `hostaddr` parameters, several
    hosts, and any other parameter. Allowed besides the TLS pair: `search_path`, `application_name` and
    `connect_timeout` in `DATABASE_URL`; `x-migrations-table`, `x-migrations-table-quoted` and `connect_timeout` in
    `MIGRATE_DATABASE_URL`.
  - A private CA comes through `DATABASE_CA_FILE` (an absolute host path, readable by UID 1000), mounted read-only at
    `/certs/db-ca.pem`; both URLs then say `sslrootcert=/certs/db-ca.pem`. On Helm, `database.external.caSecret` names a
    Secret holding it. The apps read the file at startup, so after replacing the CA in that Secret, restart them:
    `kubectl --namespace exagram rollout restart deployment exagram-api exagram-worker exagram-usercontent`.
- **Connections:** direct only. Poolers (PgBouncer, RDS Proxy) are untested: transaction-mode pooling breaks
  `LISTEN`/`NOTIFY` and the job queue. Each app process opens up to `DATABASE_MAX_CONNECTIONS` (10), plus the job
  queue's and one `LISTEN` connection in the api and worker; budget about 50 for the three apps, plus `migrate` during
  upgrades.

## Bucket requirements

For S3 and GCS stores. `verify.sh`, given an uploaded object's key, checks that anonymous reads and listing are refused
and that CORS allows the upload from `APP_HOST`; it doesn't check conditional writes, or that CORS allows no other
origin.

- **Private:** no public access, no anonymous read or listing. This is the default for new S3, R2 and GCS buckets.
  Signed URLs still work under GCS public access prevention.
- **CORS** allowing `PUT` from `https://APP_HOST` with the `Content-Type` header, plus `If-None-Match` on S3-compatible
  stores, `x-goog-content-length-range` and `x-goog-if-generation-match` on GCS. Browsers upload directly to the bucket.
- **Conditional writes:** S3-compatible stores must honour `If-None-Match: *` on `PUT`, so a replayed upload URL can't
  overwrite an object. AWS S3 and R2 do; a store that ignores the header is unsupported. GCS does the same with
  `x-goog-if-generation-match: 0`, which Exagram always signs.
- **Region:** the bucket's real region in `S3_REGION` (R2: `auto`).
- **Credentials:** a static key pair, or neither, which uses the SDK's default chain (instance role, environment). The
  adapter reads, writes and deletes objects.
- **R2:** both endpoints are the account endpoint `https://<account>.r2.cloudflarestorage.com`. Presigned URLs don't
  work on R2 custom domains; leave the `r2.dev` URL and any custom domain off.
- **AWS with an instance role:** presigned URLs expire when the temporary credential does, and containers need the EC2
  metadata hop limit set to 2.
- **No age-based lifecycle rules.** With a bucket, abandoned uploads stay; a lifecycle rule can't tell them from stored
  files, which share the `artifacts/` prefix.

## Limits

| Limit                                             | Value                                                 |
| ------------------------------------------------- | ----------------------------------------------------- |
| Upload size                                       | 20 MiB per file, fixed                                |
| A file an AI tool uploads                         | 5 MiB                                                 |
| Text extracted from one file                      | 5 MiB; a file with more can't be searched by its text |
| A file a CDN library proxied for an HTML Artifact | 8 MiB                                                 |
| Invite link lifetime                              | 7 days                                                |
| Reset Link lifetime                               | 1 hour, one use                                       |
| Users and files                                   | No limit                                              |
| `api` replicas                                    | 1                                                     |

## Provider status

What has been run end to end, and what is configured from provider documentation but not yet run on a real account.

| Configuration                                                                                  | Status                                    |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Compose: bundled Postgres, filesystem store, including backup and restore                      | Tested end to end                         |
| Compose: external Postgres 18 over TLS (private CA, `verify-full`, non-superuser owner)        | Tested end to end                         |
| Compose: generic S3-compatible store                                                           | Tested end to end                         |
| Compose: `--tls external` origin, client address from `Cf-Connecting-Ip`                       | Tested end to end                         |
| Helm, `tls.mode=ingress` (ingress-nginx), bundled layers, including backup and restore         | Tested end to end on a local cluster      |
| Helm, `tls.mode=acme` (MetalLB, a local ACME server), bundled layers                           | Tested end to end on a local cluster      |
| AWS S3, Cloudflare R2, GCS                                                                     | Configured, not verified on real accounts |
| RDS, Cloud SQL, Azure, Neon                                                                    | Configured, not verified on real accounts |
| Cloudflare Tunnel, other proxies and load balancers                                            | Configured, not verified on real accounts |
| Helm on a cloud load balancer (provisioning, health checks, UDP 443); Helm with brought layers | Configured, not verified on real accounts |
