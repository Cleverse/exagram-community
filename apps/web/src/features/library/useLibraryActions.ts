import { createContext, useContext, useEffect } from "react"

export type LibraryActions = {
	/** Opens Upload into `projectId`, by default the Project on screen when there is one. */
	upload: (file?: File | null, projectId?: string | null) => void
	/**
	 * Uploads files dropped from the desktop straight away, with no dialog: each is titled from its name and
	 * lands in `projectId`, by default the Project on screen. A file Exagram cannot store is skipped with a toast.
	 */
	uploadFiles: (files: File[], projectId?: string | null) => void
	/** Opens New project; `parentId` nests it under that Project. */
	newProject: (parentId?: string | null) => void
	/** The sidebar's PINNED rows: the open list's own preview when a list registered one, else the Artifact's address. */
	selectArtifact: (artifactId: string) => void
	/** A list screen hands in its selection so a pinned row previews in place; returns the cleanup. */
	registerSelect: (select: (artifactId: string) => void) => () => void
	/** Search (⌘K / ⌘P): the open list's own dialog when a list registered one, else search across everything. */
	openSearch: () => void
	/** A list screen hands in its search opener so the shortcut searches its scope; returns the cleanup. */
	registerSearch: (open: () => void) => () => void
}

export const LibraryActionsContext = createContext<LibraryActions | null>(null)

export const useLibraryActions = () => {
	const actions = useContext(LibraryActionsContext)
	if (!actions) throw new Error("useLibraryActions needs a LibraryActionsProvider")
	return actions
}

/** Lets the sidebar's PINNED rows open the preview inside this list rather than jumping to the library root. */
export const useRegisterArtifactSelect = (select: (artifactId: string) => void) => {
	const { registerSelect } = useLibraryActions()
	useEffect(() => registerSelect(select), [registerSelect, select])
}

/** Lets ⌘K / ⌘P open this list's own search, scoped as its Search button is. */
export const useRegisterSearch = (open: () => void) => {
	const { registerSearch } = useLibraryActions()
	useEffect(() => registerSearch(open), [registerSearch, open])
}
