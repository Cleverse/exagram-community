BEGIN;

ALTER TABLE "exagram"."workspaces"
	ADD COLUMN "join_mode" TEXT NOT NULL DEFAULT 'invite' CHECK ("join_mode" IN ('invite', 'domain')),
	ADD COLUMN "join_approval" TEXT NOT NULL DEFAULT 'admin' CHECK ("join_approval" IN ('admin', 'auto')),
	ADD COLUMN "member_invites" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "domain_link_enabled" BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN "domain_link_id" UUID NOT NULL DEFAULT gen_random_uuid(),
	ADD COLUMN "default_share_role" TEXT NOT NULL DEFAULT 'collaborate'
		CHECK ("default_share_role" IN ('view', 'collaborate', 'edit')),
	ADD COLUMN "seat_limit" INTEGER CHECK ("seat_limit" IS NULL OR "seat_limit" > 0),
	ADD CONSTRAINT "workspaces_domain_link_id_key" UNIQUE ("domain_link_id");

ALTER TABLE "exagram"."workspace_invites"
	ADD COLUMN "via" TEXT NOT NULL DEFAULT 'admin_invite' CHECK ("via" IN ('admin_invite', 'member_invite'));

-- Seats used counts only unexpired Invites (ADR 0041 §2).
CREATE INDEX "workspace_invites_workspace_id_expires_at_idx"
	ON "exagram"."workspace_invites" ("workspace_id", "expires_at");

-- A Member's Invite is usable only while its sender could send it now (ADR 0041 §1); an Admin's keeps 000033's rule.
DROP FUNCTION "exagram"."invite_usable"(UUID, TEXT);

CREATE FUNCTION "exagram"."invite_usable"(inviter UUID, invite_role TEXT, invite_via TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		JOIN "exagram"."workspaces" w ON w.id = u.workspace_id
		WHERE u.id = inviter AND u.removed_at IS NULL
			AND CASE invite_via
				WHEN 'member_invite' THEN invite_role = 'member' AND w.member_invites AND w.join_approval = 'auto'
				ELSE invite_role <> 'admin' OR u.is_admin
			END
	)
$$;

COMMIT;
