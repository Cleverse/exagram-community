import { type VisibleArtifact } from "@exagram/api-client"
import { type ReactNode } from "react"
import { MemoryRouter, useLocation, useNavigationType } from "react-router"

import { type ReturnState, useArtifactSelection } from "./useArtifactSelection"

export const artifact = (id: string): VisibleArtifact => ({
	id,
	workspaceId: "w1",
	ownerId: "u1",
	projectId: null,
	kind: "doc",
	title: id,
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	visibleRevisionId: "r1",
	access: "owner",
	isPinned: false,
	revisionSeq: 1,
	updatedAt: new Date("2026-09-14T00:00:00Z"),
	ownerName: "owner",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Northwind",
	orgDomain: "northwind.example",
})

export const useSubject = () => {
	const location = useLocation()
	return {
		selection: useArtifactSelection([artifact("a1"), artifact("a2")]),
		path: `${location.pathname}${location.search}`,
		returnTo: (location.state as ReturnState | null)?.returnTo,
		navigationType: useNavigationType(),
	}
}

export const wrapper =
	(initial: string) =>
	({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>

export const setWindowWidth = (width: number) =>
	Object.defineProperty(window, "innerWidth", { value: width, configurable: true })
export const originalWidth = window.innerWidth
