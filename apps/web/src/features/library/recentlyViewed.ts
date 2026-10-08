import { useEffect, useSyncExternalStore } from "react"
import { useLocation } from "react-router"
import { z } from "zod"

import { previewIdOf, projectIdOf } from "@/routes/paths"

const StoredViews = z.array(z.object({ kind: z.enum(["file", "project"]), id: z.string(), at: z.number() }))

export type RecentView = z.infer<typeof StoredViews>[number]

const RECENT_KEY = "exagram.recentlyViewed"
const KEEP = 30

const read = (): RecentView[] => {
	try {
		const stored = StoredViews.safeParse(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]"))
		return stored.success ? stored.data : []
	} catch {
		return []
	}
}

// Held here as well as in storage, so the list still works for this tab when storage is off.
let current = read()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * What this person opened lately, newest first: files (their page or a preview) and Project pages. Only this
 * browser knows; the API keeps no view history.
 */
export const useRecentViews = () => useSyncExternalStore(subscribe, () => current)

export const recordView = (kind: RecentView["kind"], id: string, at: number = Date.now()) => {
	if (current[0]?.kind === kind && current[0].id === id) return
	current = [{ kind, id, at }, ...current.filter((entry) => !(entry.kind === kind && entry.id === id))].slice(0, KEEP)
	try {
		window.localStorage.setItem(RECENT_KEY, JSON.stringify(current))
	} catch {
		// Storage can be off (private mode, blocked site data); the list then lasts until the tab closes.
	}
	for (const listener of listeners) listener()
}

const ARTIFACT_PATH = /^\/artifacts\/([^/]+)\/?$/

/** What a location shows that is worth jumping back to: a file, else the Project page around it. */
export const viewOf = (pathname: string, search: string): Omit<RecentView, "at"> | null => {
	const artifactId = ARTIFACT_PATH.exec(pathname)?.[1] ?? previewIdOf(search)
	if (artifactId) return { kind: "file", id: artifactId }
	const projectId = projectIdOf(pathname)
	return projectId ? { kind: "project", id: projectId } : null
}

/** Records each file and Project page the shell shows, for search's Recent list. */
export const useRecordRecentViews = () => {
	const { pathname, search } = useLocation()
	useEffect(() => {
		const view = viewOf(pathname, search)
		if (view) recordView(view.kind, view.id)
	}, [pathname, search])
}

/** Test seam: forget every view, in memory and in storage. */
export const clearRecentViews = () => {
	current = []
	try {
		window.localStorage.removeItem(RECENT_KEY)
	} catch {
		// Nothing stored to clear.
	}
	for (const listener of listeners) listener()
}
