# Self-hosting Exagram

Exagram runs on your own infrastructure from signed images for `linux/amd64` and `linux/arm64`. Install it with Docker
Compose on one machine, or with a Helm chart on Kubernetes. Your documents, the Ledger of who read them, and every
signing key stay on servers you control. Exagram sends no telemetry (see [Security](self-host/security.md)).

This page is the overview. Each topic has its own page:

| Page                                                        | What it covers                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Requirements](self-host/requirements.md)                   | Sizing, software versions, DNS and ports, every outbound connection         |
| [Install with Docker Compose](self-host/install-compose.md) | One machine or VM, with every database, storage and TLS choice              |
| [Install with Helm](self-host/install-helm.md)              | Kubernetes, with two required values                                        |
| [Install on Cloudflare](self-host/install-cloudflare.md)    | Compose behind a Cloudflare Tunnel, files in R2, no open ports              |
| [Configuration](self-host/configuration.md)                 | Every setting, optional features, the database and bucket you bring, limits |
| [Networking](self-host/networking.md)                       | TLS modes, proxies and tunnels, the client address, routes                  |
| [Accounts](self-host/accounts.md)                           | The first Admin, invites, password resets, connecting AI tools              |
| [Operations](self-host/operations.md)                       | Verify, monitor, upgrade, back up, restore, uninstall                       |
| [Security](self-host/security.md)                           | What leaves your install, hardening checklist, what an operator can see     |
| [Troubleshooting](self-host/troubleshooting.md)             | Symptoms and fixes, and what to collect before asking for help              |

## What runs

```mermaid
flowchart LR
  browser([Browser]) -->|HTTPS, APP_HOST| web
  browser -->|HTTPS, UC_HOST| web
  ai([Claude, ChatGPT]) -->|HTTPS, APP_HOST/mcp| web
  subgraph install [Your install]
    web[web: Caddy and the web app] --> api
    web --> usercontent
    api --> db[(Postgres)]
    worker --> db
    usercontent --> db
    api --> store[(Object store)]
    worker --> store
    usercontent --> store
  end
  browser -. "uploads, with S3 or GCS" .-> store
```

| Service       | Role                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `web`         | Caddy with the web app: serves the app, routes API, OAuth and MCP calls, and holds TLS unless a proxy does |
| `api`         | HTTP API, OAuth and MCP. One replica only                                                                  |
| `worker`      | Background jobs: parsing uploads, cleanup, optional features                                               |
| `usercontent` | Serves previewed files from their own origin, `UC_HOST`                                                    |
| `preflight`   | One-shot: checks the database URLs and storage settings before anything touches the database               |
| `migrate`     | One-shot: applies pending migrations before the apps start                                                 |
| `postgres`    | The bundled database, when you don't bring one                                                             |

People open `APP_HOST`. Previewed files (HTML Artifacts, PDFs) come from a second origin, `UC_HOST`, so a file's scripts
can never act as the signed-in person. `UC_HOST` defaults to `APP_HOST` with `-files` after its first label
(`exagram.acme.com` gives `exagram-files.acme.com`). Both need DNS records.

The database and the object store are each either **bundled** or **brought** by you:

| Layer        | Bundled                                                       | Brought                                                  |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| Database     | A `postgres:18` container (Compose) or StatefulSet (Helm)     | Any Postgres 18 you run, over verified TLS               |
| Object store | A Docker volume (Compose) or one PersistentVolumeClaim (Helm) | S3 API (AWS, Cloudflare R2, any compatible store) or GCS |

Bundled layers need nothing beyond Docker or the cluster. For production data, bring them: your provider's backups and
durability then cover them.

## Choose an install

| Install                                        | Use it when                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Docker Compose](self-host/install-compose.md) | One machine or VM. The simplest to run and to back up.                              |
| [Helm](self-host/install-helm.md)              | You already run Kubernetes. Two required values; the chart generates every secret.  |
| [Cloudflare](self-host/install-cloudflare.md)  | Your domain is on Cloudflare. The machine needs no public address and no open port. |

## Quick start

The shortest install: one Linux machine with Docker, the bundled database and store, and Caddy getting its own
certificates. Before you start, point DNS A records for `exagram.example.com` and `exagram-files.example.com` at the
machine, and open ports 80 and 443.

```sh
VERSION=vX.Y.Z
docker run --rm ghcr.io/cleverse/exagram-deploy:$VERSION | tar x
cd exagram
./gen-secrets.sh --app-host exagram.example.com --acme-email admin@example.com
docker compose up -d
./verify.sh
```

On Kubernetes, the same install is one command:

```sh
helm install exagram oci://ghcr.io/cleverse/charts/exagram --version X.Y.Z \
  --namespace exagram --create-namespace \
  --set appHost=exagram.example.com --set acmeEmail=admin@example.com \
  --wait --wait-for-jobs --timeout 15m
```

Then point DNS at the address the install prints. Either way, finish by opening `https://exagram.example.com` and
creating the first account, which becomes the Admin (see [First account](self-host/accounts.md#first-account)).

Replace `vX.Y.Z` with a release tag. Releases are tagged `selfhost@vX.Y.Z`; there is no `latest` (see
[Versions](self-host/operations.md#versions)).

## What you are responsible for

Exagram ships the images, the bundle and the chart. Running them is yours:

- DNS for both host names, and TLS when a proxy in front holds the certificates.
- Backups of the database, the files and the secrets, and testing that they restore
  ([Backup](self-host/operations.md#backup)). Nothing backs up automatically.
- Updates to the operating system, Docker or Kubernetes, and upgrading Exagram to new releases.
- Watching that the install is up ([Monitor](self-host/operations.md#monitor)).
- Who has a shell on the server or access to the cluster: they can read the database and create sign-in links for any
  password account ([What an operator can see](self-host/security.md#what-an-operator-can-see)).

## Not supported

- Password resets by email. A reset is a link an Admin creates and sends.
- More than one `api` replica, or any high-availability setup. Each install is one copy of each app.
- Switching an existing install from one store to another: the database holds object keys, so moving means copying the
  objects yourself.
- A separate migrator and app database role, connection poolers, and Postgres versions other than 18 (untested).
- Plaintext or unverified database TLS outside the opt-ins in the
  [Postgres contract](self-host/configuration.md#postgres-contract).
- Azure Blob storage (no S3 API), and GCS through its S3 interoperability endpoint.
- Uploads larger than 20 MiB. The limit is fixed.
- Air-gapped installs: image pulls, and certificates in the default mode, need internet access.
