import { anyoneGateOf, statusOf, type LibraryScope } from "@exagram/api-client"
import { useCallback, useEffect, useRef } from "react"
import { useLocation, useNavigate, useParams } from "react-router"

import { NotFound } from "@/components/NotFound"
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton"
import { useArtifact } from "@/features/artifact/hooks/useArtifact"
import { GateScreen, ReadGate } from "@/features/artifact/PasswordGate"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { type ReturnState } from "@/features/library/hooks/useArtifactSelection"
import { canPreview } from "@/features/library/hooks/useCanPreview"
import { useListWidth } from "@/features/library/hooks/useListWidth"
import { useProjects } from "@/features/library/hooks/useProjects"
import { FULL_VIEW_LAYER, paneFrame } from "@/features/library/paneLayout"
import { ALL_ARTIFACTS_FOLDER, type FolderRef, previewNavFor } from "@/features/library/previewNav"
import { PreviewPane } from "@/features/library/PreviewPane"
import { sortArtifacts } from "@/features/library/sort"
import { paths, projectIdOf, withPreview } from "@/routes/paths"

/** The library lists a page opened from one can step through, by the list's path. */
const LIST_FOLDERS: Record<string, { scope: LibraryScope; folder: FolderRef }> = {
	[paths.sharedWithMe]: {
		scope: "sharedWithMe",
		folder: { kind: "list", name: "Shared with me", href: paths.sharedWithMe },
	},
	[paths.mine]: { scope: "mine", folder: { kind: "list", name: "My uploads", href: paths.mine } },
}

/**
 * The full view's frame while the library that holds the file loads: its top bar, then its body. It covers
 * the viewport as full view does, so the app frame never shows before the file.
 */
const ArtifactPageSkeleton = () => (
	<div className="flex min-w-0 flex-col bg-panel" style={paneFrame(true)}>
		<div
			className="flex flex-none items-center"
			style={{ gap: 12, height: 52, padding: "0 20px", borderBottom: "1px solid var(--color-pane-line)" }}
		>
			<Skeleton width={20} height={20} radius={5} />
			<Skeleton width={240} height={14} />
		</div>
		<div className="mx-auto w-full" style={{ maxWidth: 720, padding: "56px 32px" }}>
			<Skeleton width="48%" height={24} radius={5} style={{ marginBottom: 28 }} />
			<SkeletonText label="Loading file…" lines={8} />
		</div>
	</div>
)

/** `returnTo` with another file previewed, so Back after stepping lands on the file now on show. */
const retarget = (returnTo: string, artifactId: string): string => {
	const url = new URL(returnTo, window.location.origin)
	return withPreview(url.pathname, url.search, artifactId)
}

/**
 * `/artifacts/:artifactId`: an Artifact's own page, the file in full view. It is where a shared or
 * copied link lands, and where Open, a double click and a narrow window's click go.
 *
 * Back returns to the list the page was opened from, with the file previewed there. A page reached by a
 * link has no list behind it, so Back goes to the file's Project (previewing it when the window has
 * room), or to All artifacts.
 *
 * ↑ ↓ / j k step through the file's Project, or the list behind the page (`previewNavFor`),
 * replacing this address; Back then returns to that list with the file now on show previewed.
 *
 * The file is loaded by id; an id the reader cannot open shows the same page as a missing one.
 */
export const ArtifactPage = () => {
	const { artifactId = "" } = useParams()
	const location = useLocation()
	const navigate = useNavigate()
	const file = useArtifact(artifactId)
	const everything = useArtifacts({ scope: "all" })
	const projects = useProjects()
	const listWidth = useListWidth()

	const artifact = file.data ?? null
	const inList = everything.data?.some((candidate) => candidate.id === artifactId) ?? false
	const projectVisible = artifact?.projectId
		? (projects.data?.some((project) => project.id === artifact.projectId) ?? false)
		: false
	const returnTo = (location.state as ReturnState | null)?.returnTo
	// A file with no Project steps through the list the page was opened from; any other list, or none, is All
	// artifacts. The list's sort is not kept across the page, so its order is the default, newest first.
	const listFolder = returnTo ? LIST_FOLDERS[new URL(returnTo, window.location.origin).pathname] : undefined
	const list = useArtifacts({ scope: listFolder?.scope ?? "all" })

	// Stepping replaces the page's address, keeping the query (an open panel) and a Back that previews the
	// file now on show.
	const step = useCallback(
		(nextId: string) => {
			void navigate(`${paths.artifact(nextId)}${location.search}`, {
				replace: true,
				state: returnTo ? ({ returnTo: retarget(returnTo, nextId) } satisfies ReturnState) : null,
			})
		},
		[navigate, location.search, returnTo],
	)

	const back = useCallback(() => {
		if (returnTo) {
			const url = new URL(returnTo, window.location.origin)
			const returnProjectId = projectIdOf(url.pathname)
			if (returnProjectId !== null && !projects.data?.some((project) => project.id === returnProjectId)) {
				void navigate(paths.library, { replace: true })
				return
			}
			void navigate(inList ? returnTo : withPreview(url.pathname, url.search, null), { replace: true })
			return
		}
		const home = projectVisible && artifact?.projectId ? paths.project(artifact.projectId) : paths.library
		void navigate(canPreview() && inList ? withPreview(home, "", artifactId) : home, { replace: true })
	}, [returnTo, artifact?.projectId, artifactId, inList, projectVisible, projects.data, navigate])

	// Escape leaves the page the way Back does, unless a menu, dialog or popover took it first.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.defaultPrevented) back()
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [back])

	// Open took focus off the list's pane; opened from a list, the page hands it to Back.
	const focused = useRef(false)
	useEffect(() => {
		if (focused.current || artifact === null || !returnTo) return
		focused.current = true
		document.querySelector<HTMLButtonElement>('[data-focus-target="back"]')?.focus()
	}, [artifact, returnTo])

	if (file.isError && statusOf(file.error) === 404) return <NotFound what="file" artifactId={artifactId} />
	if (artifact === null) {
		// A file open to Anyone with the link that wants its password, or has expired (ADR 0044).
		const gate = file.isError ? anyoneGateOf(file.error) : null
		if (gate) {
			return (
				<GateScreen layer={FULL_VIEW_LAYER}>
					<ReadGate gate={gate} artifactId={artifactId} />
				</GateScreen>
			)
		}
		if (file.isError)
			return (
				<p role="alert" className="text-danger p-8 text-sm">
					{file.error.message}
				</p>
			)
		return <ArtifactPageSkeleton />
	}

	const projectNames = new Map((projects.data ?? []).map((project) => [project.id, project.name]))
	const projectName = artifact.projectId === null ? null : (projectNames.get(artifact.projectId) ?? null)
	const nav = previewNavFor({
		artifact,
		everything: everything.data ?? [],
		projectNames,
		list: sortArtifacts(listFolder ? (list.data ?? []) : (everything.data ?? []), "updated"),
		listFolder: listFolder?.folder ?? ALL_ARTIFACTS_FOLDER,
	})

	return (
		<PreviewPane
			artifact={artifact}
			projectName={projectName}
			siblings={nav.siblings}
			folder={nav.folder}
			onStep={step}
			fullView
			onFullViewChange={(next) => {
				if (!next) back()
			}}
			onClose={back}
			listWidth={listWidth}
		/>
	)
}
