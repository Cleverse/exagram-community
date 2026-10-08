BEGIN;

-- Notification Email (ADR 0039). A member's email choices sit beside their app switches in the same row
-- but in their own columns, so neither set moves the other: no row still means the defaults, a daily
-- digest of every kind at 08:00 UTC. time_zone is an IANA name; the api stores only names Postgres knows,
-- so the sweep's AT TIME ZONE never fails on it.
ALTER TABLE "exagram"."notification_preferences"
	ADD COLUMN "email_cadence" TEXT NOT NULL DEFAULT 'daily'
		CHECK ("email_cadence" IN ('off', 'immediate', 'daily')),
	ADD COLUMN "email_access_requests" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "email_pending_revisions" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "email_grants" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "email_comments" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "digest_hour" SMALLINT NOT NULL DEFAULT 8 CHECK ("digest_hour" BETWEEN 0 AND 23),
	ADD COLUMN "time_zone" TEXT NOT NULL DEFAULT 'UTC';

-- An Admin's switch for the whole Workspace; members' choices are kept while it is off.
ALTER TABLE "exagram"."workspaces"
	ADD COLUMN "notification_email_enabled" BOOLEAN NOT NULL DEFAULT true;

-- Where each member's email stands: the keyset position of the last item mailed and the local date of the
-- last digest. A row exists only once the cursor has started, so its presence is the "started" flag: a
-- member's first sweep inserts it at now() and mails nothing, and turning email off (by the member, by an
-- unsubscribe or by an Admin for the Workspace) deletes it, so turning it back on starts again from then
-- rather than mailing what piled up meanwhile. The sweep locks one row at a time with FOR UPDATE SKIP
-- LOCKED; checked_at keeps one run from visiting the same member twice.
CREATE TABLE "exagram"."notification_email_deliveries" (
	"user_id" UUID PRIMARY KEY REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"cursor_at" TIMESTAMPTZ NOT NULL,
	"cursor_id" UUID,
	"last_digest_on" DATE,
	"checked_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sweep claims members in checked_at order, among those not yet visited in its run.
CREATE INDEX "notification_email_deliveries_checked_idx"
	ON "exagram"."notification_email_deliveries" ("checked_at", "user_id");

-- The mailbox an address delivers to, for limits that must not be dodged with aliases: lowercased, any "+tag" cut
-- from the local part, and for Gmail (gmail.com, googlemail.com, which deliver to the same mailboxes) the dots in the
-- local part removed and the domain written gmail.com. Other providers may also ignore dots; this is the common case.
CREATE FUNCTION "exagram".canonical_email_address(p_email TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT AS $$
	WITH parts AS (
		SELECT split_part(lower(p_email), '@', 1) AS local,
		       CASE split_part(lower(p_email), '@', 2)
		         WHEN 'googlemail.com' THEN 'gmail.com'
		         ELSE split_part(lower(p_email), '@', 2)
		       END AS domain
	),
	untagged AS (SELECT split_part(local, '+', 1) AS local, domain FROM parts)
	SELECT CASE WHEN domain = 'gmail.com' THEN replace(local, '.', '') ELSE local END || '@' || domain
	FROM untagged
$$;

-- Confirmation emails (ADR 0039): one row per email sent. The token is stored only as its SHA-256, is bound to the
-- address it was sent to (lowercased), expires after 24 hours and is single use. The rows also hold the rate limits:
-- per member and per address, counted on the database's clock.
CREATE TABLE "exagram"."notification_email_confirmations" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"email" TEXT NOT NULL CHECK ("email" = lower("email")),
	-- The per-address limit counts this, so aliases of one mailbox share it.
	"canonical_email" TEXT NOT NULL CHECK ("canonical_email" = "exagram".canonical_email_address("email")),
	"token_hash" TEXT NOT NULL UNIQUE,
	"sent_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"expires_at" TIMESTAMPTZ NOT NULL,
	"confirmed_at" TIMESTAMPTZ
);
CREATE INDEX "notification_email_confirmations_user_idx"
	ON "exagram"."notification_email_confirmations" ("user_id", "sent_at");
CREATE INDEX "notification_email_confirmations_canonical_idx"
	ON "exagram"."notification_email_confirmations" ("canonical_email", "sent_at");
CREATE INDEX "notification_email_confirmations_sent_idx"
	ON "exagram"."notification_email_confirmations" ("sent_at");

-- Whether a member's current address is proven: a Google identity carrying that same address, or a confirmation of
-- that same address followed while signed in as them. Changing users.email, or a Google identity whose address
-- changed, leaves it unverified. The one place this is decided; every Notification Email query calls it.
CREATE FUNCTION "exagram".notification_email_verified(p_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1
		FROM "exagram"."users" u
		WHERE u.id = p_user_id
		  AND (
			EXISTS (
				SELECT 1 FROM "exagram"."user_identities" i
				WHERE i.user_id = u.id AND i.provider = 'google' AND lower(i.email::text) = lower(u.email::text)
			)
			OR EXISTS (
				SELECT 1 FROM "exagram"."notification_email_confirmations" c
				WHERE c.user_id = u.id AND c.email = lower(u.email::text) AND c.confirmed_at IS NOT NULL
			)
		  )
	)
$$;

-- The earliest time another confirmation may go to this member, or NULL when one may go now. Four limits, the
-- latest binding one wins: one per member per 10 minutes; five per member per 24 hours; one per mailbox (canonical
-- address) per 24 hours across every account, so a mailbox that never asked gets at most one confirmation a day
-- however many aliases accounts were made with; and p_global_per_hour across the whole server.
CREATE FUNCTION "exagram".notification_email_confirmation_retry_after(p_user_id UUID, p_global_per_hour INTEGER)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
	WITH me AS (
		SELECT u.id, "exagram".canonical_email_address(u.email::text) AS canonical
		FROM "exagram"."users" u WHERE u.id = p_user_id
	),
	limits AS (
		SELECT
			(SELECT max(c.sent_at) + interval '10 minutes'
			   FROM "exagram"."notification_email_confirmations" c WHERE c.user_id = me.id) AS member_gap,
			(SELECT (array_agg(c.sent_at ORDER BY c.sent_at DESC))[5] + interval '24 hours'
			   FROM "exagram"."notification_email_confirmations" c
			  WHERE c.user_id = me.id AND c.sent_at > now() - interval '24 hours') AS member_day,
			(SELECT max(c.sent_at) + interval '24 hours'
			   FROM "exagram"."notification_email_confirmations" c WHERE c.canonical_email = me.canonical) AS address_day,
			(SELECT (array_agg(c.sent_at ORDER BY c.sent_at DESC))[p_global_per_hour] + interval '1 hour'
			   FROM "exagram"."notification_email_confirmations" c
			  WHERE c.sent_at > now() - interval '1 hour') AS global_hour
		FROM me
	)
	SELECT CASE WHEN GREATEST(member_gap, member_day, address_day, global_hour) > now()
	            THEN GREATEST(member_gap, member_day, address_day, global_hour) END
	FROM limits
$$;

COMMIT;
