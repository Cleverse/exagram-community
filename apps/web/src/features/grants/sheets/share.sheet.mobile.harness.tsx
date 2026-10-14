import { type Grant, type GrantRole, type VisibleArtifact } from "@exagram/api-client"
import { type QueryClient } from "@tanstack/react-query"
import { screen } from "@testing-library/react"
import { type UserEvent } from "@testing-library/user-event"

import { QueryKeys } from "@/config/queryKeys"
import { artifactFixture, projectFixture, renderSheet } from "@/features/artifact/sheets/sheetHarness"
import { anyoneSettings, fakeAnyoneServer } from "@/test/anyoneServer"
import { personGrant } from "@/test/grants"
import { ME } from "@/test/mobile"
import { providersFixture } from "@/test/providers"
import { sessionIn } from "@/test/workspaces"

export const load = () => import("./share.sheet.mobile")

export const grant = (over: Partial<Grant> = {}): Grant =>
	personGrant({
		id: "g1",
		artifactId: "a1",
		projectId: null,
		granteeId: "u2",
		granteeEmail: "grace@example.com",
		granteeName: "Grace Hopper",
		granteePending: false,
		role: "collaborate",
		pinnedRevisionId: null,
		createdAt: new Date("2026-09-01T00:00:00Z"),
		...over,
	})

export const invitedGrant = grant({
	id: "g3",
	granteeId: "u9",
	granteeEmail: "linus@example.com",
	granteeName: "linus@example.com",
	granteePending: true,
})

export const seedWith =
	(artifact: VisibleArtifact, grants: Grant[] = [], google = true, defaultShareRole: GrantRole = "collaborate") =>
	(client: QueryClient) => {
		client.setQueryData(QueryKeys.workspace.joining(), { defaultShareRole })
		client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [artifact])
		client.setQueryData(QueryKeys.artifacts.list({ scope: "all", projectId: "p1" }), [artifact])
		client.setQueryData(QueryKeys.projects.list(), [projectFixture()])
		client.setQueryData(QueryKeys.revisions.list(artifact.id), [])
		client.setQueryData(QueryKeys.grants.list(artifact.id), grants)
		client.setQueryData(QueryKeys.grants.access(artifact.id), artifact.access)
		client.setQueryData(QueryKeys.auth.providers(), providersFixture(google))
	}

export const openArtifact = (
	artifact: VisibleArtifact = artifactFixture(),
	grants: Grant[] = [grant()],
	google = true,
	defaultShareRole: GrantRole = "collaborate",
): ReturnType<typeof renderSheet> =>
	renderSheet("share", { target: { kind: "artifact", id: artifact.id } }, load, {
		seed: seedWith(artifact, grants, google, defaultShareRole),
	})

/** Seeds a session in a Personal Workspace that owns the Artifact. */
export const personalSeed =
	(artifact: VisibleArtifact, grants: Grant[] = []) =>
	(client: QueryClient) => {
		seedWith(artifact, grants)(client)
		client.removeQueries({ queryKey: QueryKeys.workspace.joining() })
		client.setQueryData(QueryKeys.auth.me(), { ...ME, ...sessionIn("personal", artifact.workspaceId) })
	}

export const openPersonal = (
	artifact: VisibleArtifact = artifactFixture(),
	grants: Grant[] = [],
): ReturnType<typeof renderSheet> =>
	renderSheet("share", { target: { kind: "artifact", id: artifact.id } }, load, {
		seed: personalSeed(artifact, grants),
	})

/** Opens the Owner's drawer on a file open to Anyone with the link; returns the `setAnyoneSettings` spy. */
export const openAnyone = (over: Partial<VisibleArtifact> = {}): ReturnType<typeof fakeAnyoneServer> => {
	const artifact = artifactFixture({ generalAccess: "anyone", anyoneSettings: anyoneSettings(), ...over })
	const save = fakeAnyoneServer(artifact)
	openArtifact(artifact)
	return save
}

export const enterLinkSettings = async (user: UserEvent): Promise<HTMLElement> => {
	await user.click(await screen.findByRole("button", { name: /^Link settings/ }))
	return screen.findByRole("dialog", { name: "Link settings" })
}
