BEGIN;

CREATE OR REPLACE FUNCTION "exagram"."invite_usable"(inviter UUID, invite_role TEXT, invite_via TEXT) RETURNS BOOLEAN
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

DROP TABLE "exagram"."join_requests";

COMMIT;
