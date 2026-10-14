import { type VisibleArtifact } from "@exagram/api-client"
import { useCallback, useEffect } from "react"
import { useLocation, useNavigate } from "react-router"

import { edition } from "@/edition/edition"
import { openArtifact } from "@/features/artifact/openArtifact"
import { canPreview } from "@/features/library/hooks/useCanPreview"
import { previewIdOf, withPreview } from "@/routes/paths"

/** Marks a preview this hook opened from a list, as opposed to one reached by a link or a reload. */
const IN_LIST_KEY = "previewInList"
/**
 * The browser keeps `history.state` across a reload, so a bare `true` would survive one and hide the
 * landing. The marker holds this document's load id instead; a reload mints a new id and the old
 * marker stops matching.
 */
const PAGE_LOAD_ID = Math.random().toString(36).slice(2)

type SelectionState = { [IN_LIST_KEY]?: string } | null

/** What the full page reads to send Back to the list it was opened from, with that file previewed. */
export type ReturnState = { returnTo?: string }

/**
 * One selection model for the library scopes, a Project page and Activity. A single click previews the
 * file beside the list as `?preview=<id>` when the window is wide enough for both (`canPreview`), and
 * otherwise opens its full page, `/artifacts/<id>`. An edition may open every file in a Mac app tab
 * instead (`edition.clickOpensTab`). Open, a double click, Enter on a row's name and a
 * search pick always go to the full page. The full page is told the list it came from, so its Back
 * returns there with the file previewed.
 *
 * Only opening a preview from the plain list pushes history; switching rows replaces, so the browser's
 * Back returns to the list rather than stepping through previews. Clear always replaces and never goes
 * Back: the page in the preview can push history entries of its own (a deck turning slides), and Back
 * would step through those instead of closing the preview.
 */
export const useArtifactSelection = (artifacts: VisibleArtifact[] | undefined) => {
	const location = useLocation()
	const navigate = useNavigate()
	const selectedId = previewIdOf(location.search)
	const state = location.state as SelectionState

	const writePreview = useCallback(
		(preview: string | null) => {
			const push = selectedId === null && preview !== null
			void navigate(withPreview(location.pathname, location.search, preview), {
				replace: !push,
				state: { ...state, [IN_LIST_KEY]: PAGE_LOAD_ID },
			})
		},
		[navigate, location.pathname, location.search, state, selectedId],
	)

	/** The full page, told to come back to this list with the file previewed. */
	const open = useCallback(
		(artifactId: string) => {
			const returnTo = withPreview(location.pathname, location.search, artifactId)
			openArtifact(navigate, artifactId, { state: { returnTo } satisfies ReturnState })
		},
		[navigate, location.pathname, location.search],
	)

	const select = useCallback(
		(artifactId: string | null) => {
			if (artifactId !== null && (edition.clickOpensTab() || !canPreview())) open(artifactId)
			else writePreview(artifactId)
		},
		[open, writePreview],
	)
	/** Moves the preview to another file in place (↑ ↓, the folder menu, Present): a replace, never a page. */
	const step = useCallback((artifactId: string) => writePreview(artifactId), [writePreview])
	const clear = useCallback(() => writePreview(null), [writePreview])

	useEffect(() => {
		if (selectedId === null) return
		const onKeyDown = (event: KeyboardEvent) => {
			// A menu, dialog or popover that took this Escape marks it handled; it is theirs, not the pane's.
			if (event.key !== "Escape" || event.defaultPrevented) return
			clear()
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [selectedId, clear])

	const selected = artifacts?.find((candidate) => candidate.id === selectedId) ?? null
	const missingPreviewId = selected === null ? selectedId : null

	return {
		/** The id the URL asks for, whether or not the list holds it. */
		requestedId: selectedId,
		/** The preview came from a link or a reload rather than a click in this list. */
		landed: selectedId !== null && state?.[IN_LIST_KEY] !== PAGE_LOAD_ID,
		selectedId: selected === null ? null : selectedId,
		missingPreviewId,
		selected,
		select,
		step,
		open,
		clear,
	}
}
