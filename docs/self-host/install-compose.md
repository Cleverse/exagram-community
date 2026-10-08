# Install with Docker Compose

[Self-hosting overview](../self-host.md) · Install with Docker Compose

One machine runs everything. You need Docker with Compose 2.24.4 or later, two host names, and with the default TLS mode
ports 80 and 443 open and both names resolving to the machine (see [Requirements](requirements.md)).

## 1. Download the bundle

Each release is an image, `exagram-deploy`, holding a small `exagram/` folder: the compose files, `.env.example`,
`gen-secrets.sh`, `verify.sh`, `smoke.sh` and a `VERSION` file. Its `compose.yml` pins every image to the release by
version and digest, so the bundle decides exactly what runs.

```sh
VERSION=vX.Y.Z
cosign verify ghcr.io/cleverse/exagram-deploy:$VERSION \
  --certificate-identity https://github.com/Cleverse/exagram-community/.github/workflows/release-selfhost.yml@refs/tags/selfhost@$VERSION \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
docker run --rm ghcr.io/cleverse/exagram-deploy:$VERSION | tar x
cd exagram
```

`cosign verify` is optional. It checks that the bundle was signed by Exagram's release workflow for that tag; the same
command verifies any of the six images (`exagram-api`, `exagram-worker`, `exagram-usercontent`, `exagram-web`,
`exagram-migrate`, `exagram-deploy`).

Run every later command from this `exagram/` folder. Don't edit its files: the next upgrade overwrites them. Your
settings live in `.env`, which the bundle never contains.

## 2. Generate the configuration

`gen-secrets.sh` writes `.env` with every password and signing key freshly generated. It takes host names and choices as
flags, and secrets and connection strings from environment variables of the same name, never as arguments, so they stay
out of `ps`. It needs Docker running, refuses to overwrite an existing `.env`, refuses flags that don't fit your
choices, and makes the file readable only by you (`chmod 600`).

The shortest form, with the bundled database and store and Caddy getting its own certificates:

```sh
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com
```

| Flag                                               | Meaning                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `--app-host HOST`                                  | Required. The app's host name, lower-case, no scheme or port                                |
| `--uc-host HOST`                                   | The file preview host. Default: `-files` after the first label; required below three labels |
| `--tls acme --acme-email EMAIL`                    | The default: Caddy gets certificates from Let's Encrypt; `--acme-email` is required         |
| `--tls external`                                   | A tunnel or proxy in front holds the certificates (see [Networking](networking.md))         |
| `--client-ip-header NAME`, `--http-bind ADDR:PORT` | With `--tls external` only                                                                  |
| `--external-db`                                    | Your own Postgres, from `DATABASE_URL` and `MIGRATE_DATABASE_URL`                           |
| `--db-ca-file PATH`, `--db-ca-is-server-specific`  | With `--external-db`: a private CA file, and `verify-ca` for a per-instance CA              |
| `--db-plaintext`                                   | With `--external-db`: `sslmode=disable` on a trusted private network                        |
| `--storage filesystem\|s3\|gcs`                    | The object store; `filesystem` (the bundled volume) is the default                          |
| `--allow-http-s3-endpoint`                         | With `--storage s3`: an `http://` `S3_ENDPOINT` on a trusted private network                |

`--external-db`, `--storage` and `--tls external` combine freely. The script also writes `COMPOSE_FILE`, which picks the
compose files for your choices for every later `docker compose` command. Optional features are settings you add to
`.env` later; see [Configuration](configuration.md#optional-features).

### Your own database

Both URLs are required; the [Postgres contract](configuration.md#postgres-contract) explains their shape. With
`verify-full` against a public or system-trusted CA (Neon, Azure):

```sh
export DATABASE_URL='postgres://exagram:...@db.example.com:5432/exagram?sslmode=verify-full&search_path=exagram%2Cpublic'
export MIGRATE_DATABASE_URL='postgres://exagram:...@db.example.com:5432/exagram?sslmode=verify-full&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22'
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com --external-db
```

With a private CA file (the RDS bundle), both URLs must also say `sslrootcert=/certs/db-ca.pem`; the file is mounted
there read-only, and must be readable by UID 1000:

```sh
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com \
  --external-db --db-ca-file /etc/exagram/rds-global-bundle.pem
```

`verify-ca`, for a per-instance CA whose certificate can't match the host name (Cloud SQL). Use it only if that CA signs
this one server's certificate; with a shared or public CA, any server holding a certificate from it would pass:

```sh
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com \
  --external-db --db-ca-file /etc/exagram/cloudsql-server-ca.pem --db-ca-is-server-specific
```

Plaintext, on a trusted private network only. Credentials and data cross the network unencrypted; the URLs say
`sslmode=disable`:

```sh
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com --external-db --db-plaintext
```

### Your own bucket

The bucket must meet the [bucket requirements](configuration.md#bucket-requirements): private, with CORS for browser
uploads. AWS S3, with an instance role (omit the keys) or static keys (set both):

```sh
export S3_BUCKET=exagram-objects S3_REGION=eu-west-1
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com --storage s3
```

Cloudflare R2. The region is `auto`; both endpoints are the account endpoint:

```sh
export S3_BUCKET=exagram S3_REGION=auto S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
export S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com S3_PUBLIC_ENDPOINT=https://<account>.r2.cloudflarestorage.com
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com --storage s3
```

Any S3-compatible store. `S3_ENDPOINT` is where the containers reach it, `S3_PUBLIC_ENDPOINT` where browsers upload
(`https://`). With an endpoint, path-style addressing is the default; set `S3_FORCE_PATH_STYLE=false` for virtual-hosted
style. An `http://` `S3_ENDPOINT` is accepted only for loopback, or on a trusted private network with
`--allow-http-s3-endpoint`:

```sh
export S3_BUCKET=exagram S3_REGION=us-east-1 S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
export S3_ENDPOINT=http://s3.internal:9000 S3_PUBLIC_ENDPOINT=https://s3.example.com
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com --storage s3 --allow-http-s3-endpoint
```

GCS with a service account key:

```sh
export GCS_BUCKET=exagram-objects GCS_PROJECT_ID=my-project
export GCS_SERVICE_ACCOUNT_KEY_BASE64="$(base64 < key.json | tr -d '\n')"
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com --storage gcs
```

GCS on a GCE VM with its own credentials: omit the key. Signing upload URLs without a key needs the IAM Service Account
Credentials API enabled, the VM's service account granted `roles/iam.serviceAccountTokenCreator` on itself, the
`cloud-platform` access scope on the VM, and `roles/storage.objectAdmin` on the bucket.

```sh
export GCS_BUCKET=exagram-objects
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com --storage gcs
```

## 3. Start and check

```sh
docker compose up -d
./verify.sh
```

The first start pulls the images, runs `preflight` (it checks the database URLs, the storage settings and the signing
keys before anything touches the database), the migrations, then the apps. `verify.sh` checks readiness, OAuth metadata,
the two origins, every service and the migration state, and ends with `all checks passed` (see
[Verify](operations.md#verify)).

## 4. Create the Admin

Open `https://exagram.example.com` and create the first account, which becomes the Admin. Do it right away, before you
share the address. Then invite people (see [Accounts](accounts.md)).

## Change a setting

Edit `.env` (values are single-quoted) and run `docker compose up -d`. Compose recreates only the services whose
settings changed. [Configuration](configuration.md) lists every setting.

## Next

- [Turn on optional features](configuration.md#optional-features).
- [Schedule backups](operations.md#backup).
- [Connect Claude or ChatGPT](accounts.md#connect-ai-tools).
- Work through the [hardening checklist](security.md#hardening-checklist).

## Build from source

From a clone of the source repository you can build the images instead of pulling them. Docker needs at least 2 GB of
memory for the build.

```sh
git clone https://github.com/Cleverse/exagram-community.git
cd exagram-community/deploy
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com
```

Add `compose.build.yml` to the end of `COMPOSE_FILE` in `.env`, for example
`COMPOSE_FILE='compose.yml:compose.postgres.yml:compose.build.yml'`, then:

```sh
docker compose build
docker compose up -d
./verify.sh
```

To upgrade a source install, `git pull`, then `docker compose build` and `docker compose up -d`.
