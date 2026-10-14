import { type Project, type Revision, type VisibleArtifact } from "@exagram/api-client"
import { useEffect } from "react"

import { useSheet } from "@/components/mobile/sheet/context"
import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { type SheetKind, type SheetParams } from "@/components/mobile/sheet/types"
import { isSheetLoaded, preloadSheet, recordingSheets, renderMobile } from "@/test/mobile"

/**
 * Test-only: opens one real drawer on mount, with every other kind recording what it was pushed with. The
 * drawer's module is loaded before it opens, so the open doesn't suspend (see `loadedSheet`).
 */
export const renderSheet = <K extends SheetKind>(
	kind: K,
	params: SheetParams[K],
	load: SheetLoader,
	options: Omit<NonNullable<Parameters<typeof renderMobile>[1]>, "sheets"> = {},
): ReturnType<typeof renderMobile> => {
	const sheets = recordingSheets()
	sheets.set(kind, load)
	const ready = preloadSheet(load)
	const Opener = () => {
		const sheet = useSheet()
		useEffect(() => {
			if (isSheetLoaded(load)) {
				sheet.open(kind, params)
				return
			}
			let live = true
			void ready.then(() => {
				if (live) sheet.open(kind, params)
			})
			return () => {
				live = false
			}
		}, [sheet])
		return null
	}
	return renderMobile(<Opener />, { ...options, sheets })
}

export const artifactFixture = (over: Partial<VisibleArtifact> = {}): VisibleArtifact => ({
	id: "a1",
	workspaceId: "w1",
	ownerId: "u1",
	projectId: "p1",
	kind: "doc",
	title: "Board pack",
	defaultPin: "latest",
	publishPolicy: null,
	effectivePublishPolicy: "auto",
	deletedAt: null,
	createdAt: new Date("2026-09-01T00:00:00Z"),
	visibleRevisionId: "r3",
	currentRevisionId: "r3",
	access: "owner",
	isPinned: false,
	revisionSeq: 3,
	updatedAt: new Date("2026-09-20T00:00:00Z"),
	ownerName: "Ada Lovelace",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
	generalAccess: "restricted",
	workspaceName: "Cleverse",
	orgDomain: "northwind.example",
	...over,
})

export const revisionFixture = (seq: number, over: Partial<Revision> = {}): Revision => ({
	id: `r${seq}`,
	artifactId: "a1",
	seq,
	status: "approved",
	authorUserId: "u1",
	authorConnectionId: null,
	storageKey: `k${seq}`,
	mime: "text/markdown",
	bytes: 2048,
	sha256: "x",
	note: null,
	extractedText: null,
	extractionStatus: "done",
	createdAt: new Date("2026-09-10T00:00:00Z"),
	approvedAt: null,
	...over,
})

export const projectFixture = (over: Partial<Project> = {}): Project => ({
	id: "p1",
	workspaceId: "w1",
	ownerId: "u1",
	parentProjectId: null,
	name: "Q4 planning",
	publishPolicy: "auto",
	linkPreview: "metadata",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	...over,
})
