# Every workspace manifest, which is all an install or a deploy needs.
FROM scratch AS manifests
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/usercontent/package.json apps/usercontent/
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
COPY packages/dotrc/package.json packages/dotrc/
COPY packages/mcp/package.json packages/mcp/
COPY packages/parser/package.json packages/parser/
COPY packages/redactor/package.json packages/redactor/

# Install and compile run on the builder's own platform: the JS output is the same everywhere, and emulating another
# CPU for them made a multi-platform release many times slower.
FROM --platform=$BUILDPLATFORM node:24.16-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY --from=manifests / ./
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
CMD ["pnpm", "--filter", "@exagram/api", "dev"]

# The Self-hosted SPA. No VITE_USERCONTENT_ORIGIN: Caddy renders the usercontent origin into
# index.html from UC_HOST on every request (deploy/caddy/usercontent-origin.html), so one build
# serves every install.
FROM deps AS web-build
COPY . .
RUN pnpm --filter @exagram/web build \
  && awk 'FNR == NR { meta = meta $0 "\n"; next } /<\/head>/ { printf "%s", meta } { print }' \
    deploy/caddy/usercontent-origin.html apps/web/dist/index.html >/tmp/index.html \
  && grep -q 'name="exagram-usercontent-origin"' /tmp/index.html \
  && mv /tmp/index.html apps/web/dist/index.html

# Caddy with the SPA and its configuration baked in; the TLS mode comes from the environment (deploy/Caddyfile).
FROM caddy:2-alpine AS web
COPY --from=web-build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/caddy/tls-acme.caddy deploy/caddy/tls-external.caddy /etc/caddy/

# The images ship bundled, unminified JS and no source: --no-sourcemap keeps the original TypeScript out of *.js.map, and
# the apps list @exagram/* under devDependencies (bundled by tsup), so `deploy --prod` copies none of their source. The
# rm drops pnpm's hoisted link to the workspace app itself, which dangles in the final image.
FROM deps AS server-build
COPY . .
RUN pnpm --workspace-concurrency=1 --filter @exagram/api --filter @exagram/worker --filter @exagram/usercontent build --no-sourcemap

# Production dependencies are installed on the image's own platform so native addons (@napi-rs/canvas) match it.
# --ignore-scripts: the only allowed build script is argon2's, which just looks for the prebuild it loads at runtime.
FROM node:24.16-alpine AS server-deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY --from=manifests / ./
RUN pnpm --filter @exagram/api deploy --prod --legacy --ignore-scripts /out/api \
  && pnpm --filter @exagram/worker deploy --prod --legacy --ignore-scripts /out/worker \
  && pnpm --filter @exagram/usercontent deploy --prod --legacy --ignore-scripts /out/usercontent \
  && rm -rf /out/api/node_modules/.pnpm/node_modules/@exagram /out/worker/node_modules/.pnpm/node_modules/@exagram \
    /out/usercontent/node_modules/.pnpm/node_modules/@exagram

# The servers run only `node`. The Node image's bundled npm, corepack and yarn are never used and carry
# their own dependencies (npm's tar), which the release scan would flag.
FROM node:24.16-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*

FROM runtime AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps /out/api/package.json /app/package.json
COPY --from=server-deps /out/api/node_modules /app/node_modules
COPY --from=server-build /app/apps/api/dist /app/dist
RUN mkdir -p /var/lib/exagram/objects && chown 1000:1000 /var/lib/exagram/objects
USER 1000
CMD ["node","dist/index.js"]

FROM runtime AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps /out/worker/package.json /app/package.json
COPY --from=server-deps /out/worker/node_modules /app/node_modules
COPY --from=server-build /app/apps/worker/dist /app/dist
RUN mkdir -p /var/lib/exagram/objects && chown 1000:1000 /var/lib/exagram/objects
USER 1000
CMD ["node","dist/index.js"]

FROM runtime AS usercontent
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps /out/usercontent/package.json /app/package.json
COPY --from=server-deps /out/usercontent/node_modules /app/node_modules
COPY --from=server-build /app/apps/usercontent/dist /app/dist
RUN mkdir -p /var/lib/exagram/objects && chown 1000:1000 /var/lib/exagram/objects
USER 1000
CMD ["node","dist/index.js"]

# golang-migrate with this release's migrations baked in, so an install needs no source checkout.
FROM migrate/migrate@sha256:76cc2074cb6642631f34a898ced71e6aeaa6b1a4d78c4daa743275a22e0c5be7 AS migrate
COPY database/postgres/migrations /migrations

# The install bundle: `docker run --rm <image> | tar x` writes ./exagram/. It never holds a .env, so
# extracting a newer bundle over an install replaces its files and leaves the .env alone.
FROM busybox:1.37@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e AS deploy
# A release (release-selfhost.yml) sets both: every image in compose.yml is then pinned to
# EXAGRAM_VERSION@digest. IMAGE_DIGESTS is space-separated name=sha256:<hex> for each image below.
ARG EXAGRAM_VERSION=local
ARG IMAGE_DIGESTS=""
WORKDIR /bundle/exagram
COPY deploy/compose.yml deploy/compose.postgres.yml deploy/compose.db-ca.yml deploy/compose.tls-external.yml \
  deploy/.env.example deploy/gen-secrets.sh deploy/verify.sh deploy/smoke.sh ./
RUN set -eu; \
  chmod 0644 compose*.yml .env.example && chmod 0755 gen-secrets.sh verify.sh smoke.sh; \
  printf '%s\n' "$EXAGRAM_VERSION" >VERSION; \
  if [ "$EXAGRAM_VERSION" != local ]; then \
    for name in api worker usercontent web migrate; do \
      digest=$(printf '%s\n' $IMAGE_DIGESTS | sed -n "s/^$name=\(sha256:[0-9a-f]\{64\}\)\$/\1/p"); \
      [ -n "$digest" ] || { echo "IMAGE_DIGESTS has no $name=sha256:<digest>" >&2; exit 1; }; \
      sed -i "s|^\( *image: ghcr.io/cleverse/exagram-$name\):\${EXAGRAM_VERSION:-local}\$|\1:$EXAGRAM_VERSION@$digest|" compose.yml; \
    done; \
    if grep -n 'image: .*EXAGRAM_VERSION' compose.yml; then echo "compose.yml has an unpinned image" >&2; exit 1; fi; \
  fi
ENTRYPOINT ["tar", "-C", "/bundle", "-cf", "-", "exagram"]
