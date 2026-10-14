import { useEffect, useSyncExternalStore } from "react"
import { useLocation } from "react-router"
import { z } from "zod"

import { forgetAtSessionBoundary } from "@/features/auth/sessionMemory"
import { dropUnscopedKey, useStateScope } from "@/features/workspace/stateScope"
import { previewIdOf, projectIdOf } from "@/routes/paths"

const StoredViews = z.array(z.object({ kind: z.enum(["file", "project"]), id: z.string(), at: z.number() }))

export type RecentView = z.infer<typeof StoredViews>[number]

const RECENT_KEY = "exagram.recentlyViewed"
const KEEP = 30

const keyFor = (scope: string) => `${RECENT_KEY}.${scope}`

dropUnscopedKey(RECENT_KEY)

const read = (scope: string): RecentView[] => {
	try {
		const stored = StoredViews.safeParse(JSON.parse(window.localStorage.getItem(keyFor(scope)) ?? "[]"))
		return stored.success ? stored.data : []
	} catch {
		return []
	}
}

// Held here as well as in storage, so the list still works for this tab when storage is off.
const lists = new Map<string, RecentView[]>()
const listeners = new Set<() => void>()
forgetAtSessionBoundary(() => lists.clear())

const viewsOf = (scope: string): RecentView[] => {
	let views = lists.get(scope)
	if (views === undefined) {
		views = read(scope)
		lists.set(scope, views)
	}
	return views
}

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * What this person opened lately in the Workspace the session acts in, newest first: files (their page or a
 * preview) and Project pages. Only this browser knows; the API keeps no view history.
 */
export const useRecentViews = () => {
	const scope = useStateScope()
	return useSyncExternalStore(subscribe, () => viewsOf(scope))
}

export const recordView = (scope: string, kind: RecentView["kind"], id: string, at: number = Date.now()) => {
	const views = viewsOf(scope)
	if (views[0]?.kind === kind && views[0].id === id) return
	const next = [{ kind, id, at }, ...views.filter((entry) => !(entry.kind === kind && entry.id === id))].slice(0, KEEP)
	lists.set(scope, next)
	try {
		window.localStorage.setItem(keyFor(scope), JSON.stringify(next))
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
	const scope = useStateScope()
	const { pathname, search } = useLocation()
	useEffect(() => {
		const view = viewOf(pathname, search)
		if (view) recordView(scope, view.kind, view.id)
	}, [scope, pathname, search])
}

/** Test seam: forget every scope's views, in memory and in storage. */
export const clearRecentViews = () => {
	for (const scope of lists.keys()) {
		try {
			window.localStorage.removeItem(keyFor(scope))
		} catch {
			// Nothing stored to clear.
		}
	}
	lists.clear()
	for (const listener of listeners) listener()
}
