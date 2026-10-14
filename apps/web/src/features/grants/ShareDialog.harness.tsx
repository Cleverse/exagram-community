import { type Grant, type GrantRole, type VisibleArtifact, type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"

import { ShareDialog } from "./ShareDialog"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { personGrant } from "@/test/grants"
import { providersFixture } from "@/test/providers"
import { sessionIn } from "@/test/workspaces"

export const artifact: VisibleArtifact = {
	id: "00000000-0000-4000-8000-000000000001",
	workspaceId: "00000000-0000-4000-8000-000000000002",
	ownerId: "00000000-0000-4000-8000-000000000003",
	projectId: null,
	kind: "doc",
	title: "Shared document",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date("2026-09-01T00:00:00Z"),
	visibleRevisionId: "00000000-0000-4000-8000-000000000004",
	access: "view",
	isPinned: true,
	revisionSeq: 1,
	updatedAt: new Date("2026-09-01T00:00:00Z"),
	ownerName: "Ada Lovelace",
	sharedCount: 2,
	sharedWithNames: ["Nadia Okafor", "Tomas Reyes"],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Cleverse",
	orgDomain: "example.com",
}

export const grant = (extra: Partial<Grant>): Grant =>
	personGrant({
		id: "g1",
		artifactId: artifact.id,
		projectId: null,
		granteeId: "u9",
		granteeEmail: "grace@example.com",
		granteeName: "Grace Hopper",
		granteePending: false,
		role: "collaborate",
		pinnedRevisionId: null,
		createdAt: new Date("2026-09-01T00:00:00Z"),
		...extra,
	})

export const invitedGrant = grant({
	id: "g2",
	granteeEmail: "ada@elsewhere.test",
	granteeName: "ada@elsewhere.test",
	granteePending: true,
})

export const grace = { id: "u9", name: "Grace Hopper", email: "grace@example.com", pending: false }

export function showShareDialog(
	value: VisibleArtifact,
	serverAccess: VisibleArtifact["access"] | null = value.access,
	kind: WorkspaceKind = "team",
	sessionWorkspaceId: string = value.workspaceId,
	google = true,
	/** null, not undefined, which would take the "collaborate" default. */
	defaultShareRole: GrantRole | null = "collaborate",
	session: object = sessionIn(kind, sessionWorkspaceId),
): RenderResult {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.grants.access(value.id), serverAccess)
	client.setQueryData(QueryKeys.auth.me(), {
		id: value.ownerId,
		name: value.ownerName,
		email: "owner@example.test",
		...session,
	})
	client.setQueryData(QueryKeys.revisions.list(value.id), [])
	if (kind === "team" && defaultShareRole !== null) {
		client.setQueryData(QueryKeys.workspace.joining(), { defaultShareRole })
	}
	client.setQueryData(QueryKeys.auth.providers(), providersFixture(google))
	return render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<ShareDialog artifact={value} onClose={() => {}} />
			</ToastProvider>
		</QueryClientProvider>,
	)
}
