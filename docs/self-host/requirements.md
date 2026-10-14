# Requirements

[Self-hosting overview](../self-host.md) · Requirements

## Sizing

Exagram is light. Measured with the bundled database and store, signed in, during one PDF upload and its background
processing:

| Service       | Peak memory | Peak CPU  | Helm request |
| ------------- | ----------- | --------- | ------------ |
| `api`         | 146 MiB     | 0.7 core  | 256Mi, 100m  |
| `worker`      | 98 MiB      | 0.1 core  | 256Mi, 100m  |
| `postgres`    | 102 MiB     | under 0.1 | 256Mi, 100m  |
| `usercontent` | 55 MiB      | 0.3 core  | 128Mi, 50m   |
| `web` (Caddy) | 50 MiB      | under 0.1 | 64Mi, 50m    |
| **Total**     | **451 MiB** |           | 960Mi, 400m  |

These are a single-user baseline, not a load test. Parsing a large Office file raises the worker's memory for a while
(archives may expand to 100 MiB), and every concurrent user adds to the api. Size from these:

| Install                            | CPU    | Memory | Disk                         |
| ---------------------------------- | ------ | ------ | ---------------------------- |
| Trying it out                      | 1 vCPU | 1 GB   | 10 GB                        |
| A team, bundled layers             | 2 vCPU | 4 GB   | 20 GB plus your files, twice |
| A team, brought database and store | 2 vCPU | 2 GB   | 10 GB                        |

Disk holds the images (about 2 GB with `postgres:18`), the database, and with the bundled store every uploaded file.
Keep room for a second copy of the database and files while you take a backup. Docker Desktop on a Mac needs at least 2
GB of memory for its VM.

## Software

### Docker Compose

- Linux with Docker Engine and the Compose plugin **2.24.4 or later** (`docker compose version`). Docker Desktop or
  OrbStack on a Mac or Windows machine work too.
- `openssl` for `gen-secrets.sh`, and `curl` and `jq` for `verify.sh`.
- Optional: [`cosign`](https://docs.sigstore.dev/cosign/system_config/installation/) to verify release signatures.

### Kubernetes (Helm)

- Helm **3.14 or later** (`helm version`) and `kubectl`, with rights to create Secrets in the install's namespace.
- A default StorageClass, or `persistence.*.storageClass` set: the bundled database, the filesystem store and Caddy's
  certificates each need a volume.
- With Caddy's own certificates (the default, `tls.mode=acme`): a cluster that gives a `LoadBalancer` Service a public
  address with ports 80 and 443 (managed Kubernetes, k3s's ServiceLB, MetalLB).
- With `tls.mode=ingress`: an ingress controller and certificates for both host names (cert-manager, for example). The
  chart installs neither; its defaults suit ingress-nginx.
- A network plugin that enforces NetworkPolicy (Calico, Cilium, most managed clusters with policy turned on). The
  chart's policies let only Caddy reach the api; without enforcement any Pod in the cluster can call the api directly
  and choose the client address the logs record and the sign-in limits count.
- `curl` and `jq` on your machine for `smoke.sh`, and optionally `cosign`.

### Brought layers

- **Postgres 18**, reachable from the machine or cluster, set up as the
  [Postgres contract](configuration.md#postgres-contract) describes.
- **An S3 or GCS bucket**, set up as the [bucket requirements](configuration.md#bucket-requirements) describe.

## DNS and ports

Two host names, `APP_HOST` and `UC_HOST`, each with a DNS record.

| Install                          | DNS                                                                       | Open inbound                        |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| Compose, Caddy's own TLS         | A records for both names at the machine, resolving **before** first start | TCP 80 and 443, UDP 443 for HTTP/3  |
| Compose behind a tunnel or proxy | Both names at the tunnel or proxy                                         | None on the machine                 |
| Helm, `tls.mode=acme`            | Both names at the `LoadBalancer` address, created after install           | TCP 80 and 443 to the load balancer |
| Helm, `tls.mode=ingress`         | Both names at your ingress controller                                     | Whatever the controller needs       |

`APP_HOST` must be reachable from the internet for Claude and ChatGPT to connect: they call MCP from their providers'
servers. Microsoft's servers fetch PowerPoint previews from `UC_HOST`, so those need it public too (see
[What leaves your install](security.md#what-leaves-your-install)).

## Outbound connections

The install needs outbound connections to (HTTPS unless noted):

| Destination                                                                                          | From                  | When                                                                  |
| ---------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `ghcr.io`, Docker Hub (`postgres:18`)                                                                | Docker or the cluster | Pulling images                                                        |
| Let's Encrypt (`acme-v02.api.letsencrypt.org`), falling back to ZeroSSL (`acme.zerossl.com`)         | `web`                 | Caddy's own TLS only                                                  |
| `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com` | `usercontent`         | Someone opens an HTML Artifact that loads a library or font from them |
| Your database (Postgres protocol) and bucket                                                         | the apps              | When you bring them                                                   |
| `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`                                 | `api`                 | Google sign-in, when configured                                       |
| `appleid.apple.com`                                                                                  | `api`                 | Sign in with Apple, when configured                                   |
| Google (`oauth2.googleapis.com`, `www.googleapis.com`, `iamcredentials.googleapis.com`)              | the apps              | A GCS store: tokens, and without a key file, signing upload URLs      |
| The cloud's metadata server (`169.254.169.254`, plain HTTP)                                          | the apps              | An S3 or GCS store using the VM's or Pod's own credentials            |
| AWS STS (`sts.<region>.amazonaws.com`)                                                               | the apps              | S3 with a web identity (EKS service account)                          |

Blocking the CDN hosts only leaves HTML Artifacts that use them unstyled or blank. People's browsers also load fonts
from Google and PowerPoint previews from Microsoft; [Security](security.md#what-leaves-your-install) lists everything
that leaves the install and why.
