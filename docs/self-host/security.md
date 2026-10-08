# Security

[Self-hosting overview](../self-host.md) · Security

## No telemetry

The server images and the web app send no telemetry, analytics or crash reports, and check for no updates. Open tabs
poll the install's own `/version.json` to notice a new release.

## What leaves your install

Everything Exagram itself contacts, and everything people's browsers load from elsewhere while using it:

| Destination                                                                                          | Who connects                                | When                                                                  | What it learns                                                              | To avoid it                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ghcr.io`, Docker Hub                                                                                | Docker or the cluster                       | Pulling images                                                        | Your address, the version                                                   | Mirror the images to your registry                         |
| Let's Encrypt, ZeroSSL                                                                               | `web` (Caddy)                               | Getting and renewing certificates                                     | Your host names, `ACME_EMAIL`                                               | `--tls external` or `tls.mode=ingress`                     |
| `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com` | `usercontent`                               | Someone opens an HTML Artifact that loads a library or font from them | The library's path, your server's address                                   | Block the egress; those Artifacts render unstyled or blank |
| `fonts.googleapis.com`, `fonts.gstatic.com`                                                          | People's browsers                           | Every page load of the app                                            | The person's address, that they use the app                                 | Not configurable                                           |
| `view.officeapps.live.com` (Microsoft)                                                               | People's browsers, then Microsoft's servers | Previewing a PowerPoint file                                          | Microsoft fetches the file from `UC_HOST` through a short-lived signed link | Don't preview `.pptx` files                                |
| Google (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`)                        | `api` and browsers                          | Google sign-in                                                        | Who signs in                                                                | Leave `GOOGLE_CLIENT_ID` unset                             |
| Your database and bucket                                                                             | the apps                                    | Always, when brought                                                  | Everything stored                                                           | Bundled layers                                             |
| Google's token and IAM services, AWS STS, the cloud's metadata server                                | the apps                                    | A GCS store, or S3 with the VM's or Pod's own credentials             | Which identity the install uses, and when it signs upload URLs              | S3 with static keys                                        |
| Claude, ChatGPT and other AI tools                                                                   | They connect to you                         | A person approves a Connection                                        | What that person lets the tool read; every read is in the Ledger            | Don't approve Connections                                  |

Exagram fetches a URL someone else supplies in two places: `usercontent`'s CDN proxy, which only reaches the five hosts
listed, and the OAuth server, which fetches the public-key URL an AI tool names when it registers with key-based client
authentication. Registration needs no sign-in, but that fetch refuses private, loopback and link-local addresses, the
cloud metadata server included. Link previews inside the app come from your database.

## Hardening checklist

- [ ] Create the Admin account right after the first start, before the address is shared.
- [ ] Verify the release signature with `cosign verify` before installing and before each upgrade.
- [ ] Bring the database and the store for production data, with your provider's encryption at rest and backups.
- [ ] Back up the secrets (`.env` or the Secret) somewhere as protected as the secrets; test a restore.
- [ ] With `--tls external`, keep the plain-HTTP port bound to `127.0.0.1`, or firewalled to the proxy alone.
- [ ] On Kubernetes, run a network plugin that enforces NetworkPolicy, and keep `networkPolicy.enabled` on.
- [ ] Limit who has a shell on the machine or `exec` rights in the namespace (see below).
- [ ] Keep `.env` mode 600 (`gen-secrets.sh` sets it) and out of version control.
- [ ] Keep the bucket private, with CORS for `APP_HOST` only. `verify.sh` with `VERIFY_OBJECT_KEY` checks privacy and
      that `APP_HOST` is allowed, not that other origins are refused.
- [ ] Upgrade to new releases; older ones aren't patched.
- [ ] Review **Settings → Audit** and each person's Connections from time to time.

## Built in

- **Two origins.** Previewed files run on `UC_HOST` under a Content-Security-Policy that blocks network access, inside a
  sandboxed frame, so a file's scripts can't act as the signed-in person. Those scripts can still send out what the file
  itself contains: by navigating their own frame to another site, in the path of a library loaded through
  `usercontent`'s proxy to the five CDN hosts, by asking the app to open a link in a new tab, and in some browsers
  through DNS or WebRTC. Nothing else is reachable from the frame. Treat an HTML Artifact you didn't write like a web
  page you open.
- **Verified database TLS only.** The apps refuse `sslmode=require` and other unverified modes; plaintext needs an
  explicit opt-in per host.
- **Signed, conditional uploads.** Upload URLs are signed for one object, size and type, and can't overwrite a stored
  file.
- **Every read recorded.** People, Links and AI tools all leave Ledger entries. A read hands out a file URL that works
  for five minutes; fetching it again in that time adds no new read.
- **Non-root apps.** The api, worker and usercontent run as UID 1000. On Helm their containers drop every Linux
  capability, and Caddy keeps only `NET_BIND_SERVICE`.

## What an operator can see

Anyone with a shell on the machine, or `exec` rights in the namespace, has the secrets and the database. They can read
every file, every Ledger entry and every setting, and create a Reset Link for any password account with the server
command. The Ledger records Reset Links, but someone with database access can also edit the Ledger. Treat that access as
full Admin access to the install.

## Reporting a vulnerability

Report it privately, as [SECURITY.md](../../SECURITY.md) describes. Fixes go into the latest release only.
