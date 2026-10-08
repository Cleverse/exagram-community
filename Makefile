.PHONY: local-db-up local-db-config local-db-init local-db-drop local-db-name local-migrate-up local-migrate-down local-migrate-roundtrip

# Local Docker Postgres (DATABASE_URL from .env)

# A non-empty exported DATABASE_URL wins; otherwise read just that line from .env. Including the
# whole file would hand make values it can't parse (OIDC_JWKS is JSON).
ifeq ($(strip $(DATABASE_URL)),)
DATABASE_URL := $(shell sed -n 's/^DATABASE_URL=//p' $(CURDIR)/.env 2>/dev/null)
endif

MIGRATE_IMAGE ?= migrate/migrate@sha256:76cc2074cb6642631f34a898ced71e6aeaa6b1a4d78c4daa743275a22e0c5be7
MIGRATIONS_DIR := $(CURDIR)/database/postgres/migrations
STEPS ?= 12

# golang-migrate keeps its version table wherever the connection's search_path points, which here is
# `exagram` — the very schema 000001's down half drops. These two options put it in `public` instead,
# so the last down can drop the schema plainly and the runner still knows where it stands.
MIGRATE_TABLE := x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22

# golang-migrate opens the connection with SELECT CURRENT_SCHEMA() and fails with "no schema" if
# search_path names a schema that doesn't exist yet — which `exagram` doesn't until 000001 runs.
# The migrations are all fully-qualified, so the CLI never needs search_path; strip it here and
# leave it in DATABASE_URL for the application.
MIGRATE_DATABASE_URL := $(subst &search_path=exagram%2Cpublic,,$(subst ?search_path=exagram%2Cpublic&,?,$(DATABASE_URL)))
MIGRATE_URL = $(MIGRATE_DATABASE_URL)&$(MIGRATE_TABLE)

# One shared Postgres for every worktree, one database each (scripts/local-db.sh)
local-db-up:
	./scripts/local-db.sh up

local-db-config:
	./scripts/local-db.sh config

local-db-init:
	./scripts/local-db.sh init

local-db-drop:
	./scripts/local-db.sh drop

local-db-name:
	@./scripts/local-db.sh name

local-migrate-up:
	@./scripts/local-db.sh guard "$(DATABASE_URL)"
	docker run --rm --network host -v "$(MIGRATIONS_DIR):/migrations" $(MIGRATE_IMAGE) \
		-path=/migrations -database "$(MIGRATE_URL)" -verbose up

local-migrate-down:
	@./scripts/local-db.sh guard "$(DATABASE_URL)"
	docker run --rm --network host -v "$(MIGRATIONS_DIR):/migrations" $(MIGRATE_IMAGE) \
		-path=/migrations -database "$(MIGRATE_URL)" -verbose down $(STEPS)

local-migrate-roundtrip:
	./scripts/migrate-roundtrip.sh
