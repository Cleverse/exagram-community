# Install with Helm

[Self-hosting overview](../self-host.md) · Install with Helm

Set two values, run one command, point DNS, and Exagram is up. The chart generates every password and signing key, runs
the database migrations, and gets the HTTPS certificates itself.

You need Helm 3.14 or later, a default StorageClass, a cluster that gives `LoadBalancer` Services a public address, and
a network plugin that enforces NetworkPolicy (see [Requirements](requirements.md#kubernetes-helm)). With an ingress
controller instead of a load balancer, see [Behind an Ingress](#behind-an-ingress).

## Quick start

1. Install, with your host name and an email for Let's Encrypt:

   ```sh
   helm install exagram oci://ghcr.io/cleverse/charts/exagram --version X.Y.Z \
     --namespace exagram --create-namespace \
     --set appHost=exagram.example.com --set acmeEmail=admin@example.com \
     --wait --wait-for-jobs --timeout 15m
   ```

2. Point DNS at the load balancer. Read its address:

   ```sh
   kubectl get service exagram-web --namespace exagram \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}{"\n"}'
   ```

   Then create two records pointing at it, `exagram.example.com` and `exagram-files.example.com`: an A record for an IP,
   a CNAME for a host name.

3. Open `https://exagram.example.com` and create the first account, which becomes the Admin. Do it before you share the
   address (see [Accounts](accounts.md)).

HTTPS starts working a few minutes after DNS resolves; Caddy retries on its own until it gets the certificates.

The chart version is the release number without the `v`: release `vX.Y.Z` is chart `X.Y.Z`, and it pins every Exagram
image to that release by digest.

## What the install does

```mermaid
flowchart LR
  install([helm install]) --> secret[Secret: every password and key, generated once]
  secret --> pg[(Postgres)]
  pg --> migrate[Job: checks, then migrations]
  migrate --> apps[api, worker, usercontent and web start]
  apps --> done(["helm install returns"])
  dns([You point DNS]) --> certs[Caddy gets the certificates]
  done --> certs
  certs --> open([Exagram on HTTPS])
```

- The Secret `exagram` holds every generated password and key. Upgrades reuse it and `helm uninstall` keeps it.
- The bundled Postgres starts first, then the Job `exagram-migrate-1` checks the settings and runs the migrations.
- `api`, `worker` and `usercontent` each wait until the schema is at their version. `--wait` returns once they are
  ready, before HTTPS works: Caddy can get certificates only after DNS points at it.

What then runs in the namespace:

```mermaid
flowchart LR
  people([Browsers, AI tools]) -->|HTTPS| lb[Service exagram-web, LoadBalancer]
  subgraph ns [Namespace exagram]
    lb --> web[web: Caddy and the web app]
    web --> api
    web --> uc[usercontent]
    api --> pg[(Postgres)]
    worker --> pg
    uc --> pg
    api --> files[(Files volume)]
    worker --> files
    uc --> files
  end
```

NetworkPolicies let only Caddy reach `api` and `usercontent`, and only the apps reach Postgres. With a bucket instead of
the files volume, the apps and browsers use the bucket.

To check the install from inside the cluster and from your machine, see [Verify](operations.md#verify).

### Verify the chart's signature (optional)

```sh
VERSION=X.Y.Z
cosign verify ghcr.io/cleverse/charts/exagram:$VERSION \
  --certificate-identity https://github.com/Cleverse/exagram-community/.github/workflows/release-selfhost.yml@refs/tags/selfhost@v$VERSION \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Customizing

Anything beyond the two values goes in a values file, passed with `-f values.yaml` to `helm install` and to every
`helm upgrade`. `helm show values oci://ghcr.io/cleverse/charts/exagram --version $VERSION` prints every value with a
comment. The ones most installs touch:

| Values                                     | What they choose                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `appHost`, `ucHost`                        | The two host names. `ucHost` defaults to `appHost` with `-files` after its first label.                                               |
| `acmeEmail`                                | Let's Encrypt account email. Required with `tls.mode=acme`.                                                                           |
| `tls.mode`, `ingress.*`                    | `acme` (default): a `LoadBalancer` and Caddy's own certificates. `ingress`: your Ingress controller holds them.                       |
| `database.bundled`, `database.external.*`  | The bundled Postgres, or yours: `url`, `migrateUrl` and `caSecret` (see the [Postgres contract](configuration.md#postgres-contract)). |
| `storage.driver`, `storage.s3.*`, `.gcs.*` | `filesystem` (default, one volume), or a bucket meeting the [bucket requirements](configuration.md#bucket-requirements).              |
| `env`, `envFrom`                           | App settings by variable name, and a Secret holding feature keys (see [Settings on Helm](configuration.md#settings-on-helm)).         |
| `existingSecret`                           | A Secret you manage instead of the generated one (see [GitOps](#gitops-argo-cd-flux)).                                                |
| `persistence.*`                            | Size and StorageClass of the database, files and certificate volumes.                                                                 |
| `resources.*`                              | Requests per app; no limits by default.                                                                                               |
| `networkPolicy.enabled`                    | Policies that let only Caddy reach `api` and `usercontent`, and only the apps reach Postgres. On by default.                          |
| `imagePullSecrets`                         | Credentials for a registry mirror.                                                                                                    |

The filesystem store is one ReadWriteOnce volume, so `api`, `worker`, `usercontent` and the migrate Job all run on the
node that holds it, and losing that node stops them. It is fine to start with; for production, bring a bucket.

### A production values file

Behind ingress-nginx with cert-manager, with your own Postgres and an S3 bucket:

```yaml
appHost: exagram.example.com
tls:
  mode: ingress
ingress:
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  tls:
    - hosts: [exagram.example.com, exagram-files.example.com]
      secretName: exagram-tls
database:
  bundled: false
  external:
    url: postgres://exagram:<password>@db.example.com:5432/exagram?sslmode=verify-full&search_path=exagram%2Cpublic
    migrateUrl: postgres://exagram:<password>@db.example.com:5432/exagram?sslmode=verify-full&x-migrations-table=%22public%22.%22schema_migrations%22&x-migrations-table-quoted=1
storage:
  driver: s3
  s3:
    region: eu-west-1
    bucket: exagram-files
    accessKeyId: <key id>
    secretAccessKey: <secret>
```

```sh
helm install exagram oci://ghcr.io/cleverse/charts/exagram --version $VERSION \
  --namespace exagram --create-namespace -f values.yaml --wait --wait-for-jobs --timeout 15m
```

Values files hold passwords here; keep them out of version control, or keep secrets in your own Secret as below.

### Behind an Ingress

```mermaid
flowchart LR
  people([Browsers, AI tools]) -->|HTTPS| ctrl[Your Ingress controller, with the certificates]
  ctrl -->|HTTP, both host names| web[Service exagram-web, ClusterIP: Caddy]
  web --> api
  web --> uc[usercontent]
```

With `tls.mode=ingress`, the `web` Service is a `ClusterIP` behind an Ingress for both host names, and your controller
holds the certificates. Caddy takes the client address from `X-Forwarded-For` as the controller sets it, reading only
the address the controller added; keep the controller's own Service on `externalTrafficPolicy: Local` so that address is
the real client, not a node.

The chart's default annotations turn off ingress-nginx's response buffering (live updates are server-sent events) and
allow 21 MB request bodies. For another controller, set the equivalent annotations, and `ingress.clientIpHeader` and
`ingress.controllerNamespace` to match it.

## GitOps (Argo CD, Flux)

Tools that render the chart with `helm template` can't see the Secret already in the cluster, so the chart would
generate new keys and passwords on every render: the apps would lose the bundled database's password, and AI tools'
sign-ins in progress would fail. Create the Secret once yourself and set `existingSecret: exagram-secrets`; the chart
then creates none. After changing a Secret you manage, restart the apps with
`kubectl --namespace exagram rollout restart deployment exagram-api exagram-worker exagram-usercontent`. For release
`exagram` with the bundled database:

```sh
kubectl create namespace exagram
PG_PASSWORD=$(openssl rand -hex 24)
PG="postgres://exagram:$PG_PASSWORD@exagram-postgres:5432/exagram?sslmode=disable"
kubectl --namespace exagram create secret generic exagram-secrets \
  --from-literal=USERCONTENT_TOKEN_SECRET="$(openssl rand -hex 32)" \
  --from-literal=UPLOAD_TOKEN_SECRET="$(openssl rand -hex 32)" \
  --from-literal=OIDC_COOKIE_KEYS="$(openssl rand -hex 32)" \
  --from-literal=OIDC_JWKS="$(openssl genrsa 2048 2>/dev/null)" \
  --from-literal=POSTGRES_PASSWORD="$PG_PASSWORD" \
  --from-literal=DATABASE_URL="$PG&search_path=exagram%2Cpublic" \
  --from-literal=MIGRATE_DATABASE_URL="$PG&x-migrations-table=%22public%22.%22schema_migrations%22&x-migrations-table-quoted=1"
```

For another release name the database host is `<release>-exagram-postgres` (or `<release>-postgres` when the name
already contains `exagram`). With your own database, set `DATABASE_URL` and `MIGRATE_DATABASE_URL` to its URLs and leave
out `POSTGRES_PASSWORD`. Bucket credentials go in the same Secret as `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, or
`GCS_SERVICE_ACCOUNT_KEY_BASE64`. `OIDC_JWKS` takes a PEM RSA private key, as here, or a JWK set. Back this Secret up
with the database (see [Backup](operations.md#backup)).

## Next

- [Turn on optional features](configuration.md#settings-on-helm).
- [Schedule backups](operations.md#backup) and learn the [upgrade](operations.md#upgrade-with-helm) steps.
- Work through the [hardening checklist](security.md#hardening-checklist).
