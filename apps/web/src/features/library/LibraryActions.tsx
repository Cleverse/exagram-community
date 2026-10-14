import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { useShell } from "@/components/mobile/shell"
import { useToast } from "@/components/Toast"
import { openArtifact } from "@/features/artifact/openArtifact"
import { useMe } from "@/features/auth/hooks/useMe"
import { DragProvider } from "@/features/library/dragState"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { type ReturnState } from "@/features/library/hooks/useArtifactSelection"
import { useProjects } from "@/features/library/hooks/useProjects"
import { useUpload } from "@/features/library/hooks/useUpload"
import { canAddTo, ONLY_OWNER_ADDS } from "@/features/library/projectSummary"
import { useRecordRecentViews } from "@/features/library/recentlyViewed"
import { SearchDialog } from "@/features/library/SearchDialog"
import { shortcutOf } from "@/features/library/shortcuts"
import { checkUpload, titleFromFilename } from "@/features/library/upload"
import { UploadDialog } from "@/features/library/UploadDialog"
import { type LibraryActions, LibraryActionsContext } from "@/features/library/useLibraryActions"
import { ProjectSettingsDialog } from "@/features/project/ProjectSettingsDialog"
import { paths, projectIdOf } from "@/routes/paths"

const NO_STEP = () => {}

/** What a finished drop says: one file by name, several by count, and whether any wait for approval. */
const droppedMessage = (done: { title: string; status: string }[]) => {
	const waiting = done.filter((result) => result.status !== "approved").length
	const what = done.length === 1 ? `"${done[0]?.title}"` : `${done.length} files`
	if (waiting === 0) return `Uploaded ${what}`
	return waiting === done.length
		? `Uploaded ${what} — waiting under Pending`
		: `Uploaded ${what} — ${waiting} waiting under Pending`
}

/** Search from a screen with no search of its own (Activity, Context, an Artifact's page): across everything. */
const EverywhereSearch = ({ onClose }: { onClose: () => void }) => {
	const navigate = useNavigate()
	const location = useLocation()
	const everything = useArtifacts({ scope: "all" })
	const projects = useProjects()
	return (
		<SearchDialog
			artifacts={everything.data ?? []}
			projects={projects.data ?? []}
			onClose={onClose}
			onOpenArtifact={(artifactId) =>
				openArtifact(navigate, artifactId, {
					state: { returnTo: `${location.pathname}${location.search}` } satisfies ReturnState,
				})
			}
		/>
	)
}

/**
 * Upload and New folder, owned once by the shell: the sidebar's "+" and a dropped file work on every screen,
 * and the library header opens the same dialogs, so the two never disagree about the target Project.
 */
export const LibraryActionsProvider = ({ children }: { children: ReactNode }) => {
	const location = useLocation()
	const navigate = useNavigate()
	const projects = useProjects()
	const meId = useMe().data?.id
	const [uploading, setUploading] = useState<{ file: File | null; projectId: string | null } | null>(null)
	const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
	const selectRef = useRef<((artifactId: string) => void) | null>(null)
	const searchRef = useRef<(() => void) | null>(null)
	const [searchingEverywhere, setSearchingEverywhere] = useState(false)
	const toast = useToast()
	const { mutateAsync: uploadOne, discard: discardFailed } = useUpload(NO_STEP)
	const desktop = useShell() === "desktop"

	useRecordRecentViews()

	// The target is fixed when Upload opens, so moving between screens behind the dialog cannot retarget it.
	const routeProjectId = useRef<string | null>(projectIdOf(location.pathname))
	useEffect(() => {
		routeProjectId.current = projectIdOf(location.pathname)
	}, [location.pathname])
	const project = uploading?.projectId
		? projects.data?.find((candidate) => candidate.id === uploading.projectId)
		: undefined

	const registerSelect = useCallback((select: (artifactId: string) => void) => {
		selectRef.current = select
		return () => {
			if (selectRef.current === select) selectRef.current = null
		}
	}, [])

	const registerSearch = useCallback((open: () => void) => {
		searchRef.current = open
		return () => {
			if (searchRef.current === open) searchRef.current = null
		}
	}, [])

	const openSearch = useCallback(() => {
		if (searchRef.current) searchRef.current()
		else setSearchingEverywhere(true)
	}, [])

	// The phone has its own Search drawer and rarely a keyboard, so the shortcuts are the desktop's alone.
	useEffect(() => {
		if (!desktop) return
		const onKeyDown = (event: KeyboardEvent) => {
			const shortcut = shortcutOf(event)
			if (shortcut === null) return
			event.preventDefault()
			if (event.repeat) return
			if (shortcut === "copyLink") {
				navigator.clipboard
					.writeText(window.location.href)
					.then(() => toast("Link copied"))
					.catch(() => toast("Could not copy the link"))
				return
			}
			// Another dialog (Upload, Share, a confirm) keeps the screen, and Present covers everything; search is
			// not stacked on top of either.
			if (document.querySelector('[role="dialog"], [data-presenting]')) return
			openSearch()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [desktop, openSearch, toast])

	// One file at a time, so a large drop never races the ticket calls and each failure names its own file.
	const uploadFiles = useCallback(
		async (files: File[], projectId: string | null) => {
			// A drop anywhere on a shared Project's screen lands here; only its Owner may add files.
			if (!canAddTo(projects.data ?? [], projectId, meId)) {
				toast(ONLY_OWNER_ADDS)
				return
			}
			const accepted: File[] = []
			for (const file of files) {
				const problem = checkUpload(file)
				if (problem) toast(problem)
				else accepted.push(file)
			}
			if (accepted.length === 0) return

			toast(accepted.length === 1 ? `Uploading "${accepted[0]?.name}"…` : `Uploading ${accepted.length} files…`)
			const done: { title: string; status: string }[] = []
			for (const file of accepted) {
				const title = titleFromFilename(file.name)
				try {
					const result = await uploadOne({ file, title, projectId, artifactId: null, note: null })
					done.push({ title, status: result.status })
				} catch (error) {
					// A drop has no retry, so an Artifact the failed attempt created would stay empty for good.
					await discardFailed()
					toast(`"${file.name}" did not upload — ${error instanceof Error ? error.message : "try again"}`)
				}
			}
			if (done.length > 0) toast(droppedMessage(done))
		},
		[toast, uploadOne, discardFailed, projects.data, meId],
	)

	const actions = useMemo<LibraryActions>(
		() => ({
			upload: (file = null, projectId = routeProjectId.current) => {
				if (canAddTo(projects.data ?? [], projectId, meId)) setUploading({ file, projectId })
				else toast(ONLY_OWNER_ADDS)
			},
			uploadFiles: (files, projectId = routeProjectId.current) => void uploadFiles(files, projectId),
			newProject: (parentId = null) => setCreating({ parentId }),
			selectArtifact: (artifactId) => {
				if (selectRef.current) selectRef.current(artifactId)
				else openArtifact(navigate, artifactId)
			},
			registerSelect,
			openSearch,
			registerSearch,
		}),
		[navigate, registerSelect, openSearch, registerSearch, uploadFiles, projects.data, meId, toast],
	)

	return (
		<LibraryActionsContext.Provider value={actions}>
			<DragProvider>{children}</DragProvider>

			{searchingEverywhere ? <EverywhereSearch onClose={() => setSearchingEverywhere(false)} /> : null}

			{uploading ? (
				<UploadDialog
					projectId={project?.id ?? null}
					publishPolicy={project?.publishPolicy ?? "auto"}
					initialFile={uploading.file}
					onClose={() => setUploading(null)}
				/>
			) : null}

			{creating ? (
				<ProjectSettingsDialog
					mode="create"
					projectId={creating.parentId ?? undefined}
					onClose={() => setCreating(null)}
					onCreated={(created) => {
						setCreating(null)
						void navigate(paths.project(created))
					}}
				/>
			) : null}
		</LibraryActionsContext.Provider>
	)
}
