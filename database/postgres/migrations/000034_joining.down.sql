BEGIN;

DROP FUNCTION "exagram"."invite_usable"(UUID, TEXT, TEXT);

CREATE FUNCTION "exagram"."invite_usable"(inviter UUID, invite_role TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		WHERE u.id = inviter AND u.removed_at IS NULL AND (invite_role <> 'admin' OR u.is_admin)
	)
$$;

DROP INDEX "exagram"."workspace_invites_workspace_id_expires_at_idx";

-- 000033's predicate cannot tell a Member's Invite apart, so one the settings had stopped would work again.
DELETE FROM "exagram"."workspace_invites" WHERE "via" = 'member_invite';

ALTER TABLE "exagram"."workspace_invites" DROP COLUMN "via";

ALTER TABLE "exagram"."workspaces"
	DROP CONSTRAINT "workspaces_domain_link_id_key",
	DROP COLUMN "seat_limit",
	DROP COLUMN "default_share_role",
	DROP COLUMN "domain_link_id",
	DROP COLUMN "domain_link_enabled",
	DROP COLUMN "member_invites",
	DROP COLUMN "join_approval",
	DROP COLUMN "join_mode";

COMMIT;
