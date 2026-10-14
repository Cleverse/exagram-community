import { type GrantRole } from "@exagram/api-client"
import { useCallback, useSyncExternalStore } from "react"
import { z } from "zod"

import { forgetAtSessionBoundary } from "@/features/auth/sessionMemory"
import { useStateScope } from "@/features/workspace/stateScope"

const SentRequestSchema = z.object({
	at: z.number(),
	role: z.enum(["view", "collaborate", "edit"] satisfies GrantRole[]),
	note: z.string(),
})

export type SentRequest = z.infer<typeof SentRequestSchema>

const SENT_KEY = "exagram.accessRequests.sent"
const KEEP = 50

const keyFor = (scope: string) => `${SENT_KEY}.${scope}`

/** Storage's book for the scope with any entry that does not parse dropped, or null when storage cannot be read. */
const read = (scope: string): Record<string, SentRequest> | null => {
	try {
		const stored: unknown = JSON.parse(window.localStorage.getItem(keyFor(scope)) ?? "{}")
		if (typeof stored !== "object" || stored === null) return {}
		return Object.fromEntries(
			Object.entries(stored).flatMap(([id, value]) => {
				const entry = SentRequestSchema.safeParse(value)
				return entry.success ? [[id, entry.data]] : []
			}),
		)
	} catch {
		return null
	}
}

const sentByScope = new Map<string, Record<string, SentRequest>>()
const listeners = new Set<() => void>()
forgetAtSessionBoundary(() => sentByScope.clear())

const bookOf = (scope: string): Record<string, SentRequest> => {
	let book = sentByScope.get(scope)
	if (book === undefined) {
		book = read(scope) ?? {}
		sentByScope.set(scope, book)
	}
	return book
}

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

window.addEventListener("storage", (event) => {
	if (event.key !== null && !event.key.startsWith(SENT_KEY)) return
	sentByScope.clear()
	for (const listener of listeners) listener()
})

let storageWritable = true

const save = (scope: string, book: Record<string, SentRequest>) => {
	sentByScope.set(scope, book)
	try {
		window.localStorage.setItem(keyFor(scope), JSON.stringify(book))
	} catch {
		// Storage can be off (private mode, blocked site data); the request then shows as pending until the tab closes.
		storageWritable = false
	}
	for (const listener of listeners) listener()
}

/** Another tab may have written since this one last did, so a write starts from storage unless storage is off. */
const latestBook = (scope: string) => (storageWritable ? (read(scope) ?? bookOf(scope)) : bookOf(scope))

export const sentRequestOf = (scope: string, artifactId: string): SentRequest | undefined => bookOf(scope)[artifactId]

export const useSentRequest = (artifactId: string): SentRequest | undefined => {
	const scope = useStateScope()
	return useSyncExternalStore(subscribe, () => sentRequestOf(scope, artifactId))
}

export const recordSent = (scope: string, artifactId: string, request: SentRequest) => {
	const newest = Object.entries({ ...latestBook(scope), [artifactId]: request })
		.sort(([, a], [, b]) => b.at - a.at)
		.slice(0, KEEP)
	save(scope, Object.fromEntries(newest))
}

export const forgetSent = (scope: string, artifactId: string) => {
	save(scope, Object.fromEntries(Object.entries(latestBook(scope)).filter(([id]) => id !== artifactId)))
}

export const useForgetSent = (artifactId: string) => {
	const scope = useStateScope()
	return useCallback(() => forgetSent(scope, artifactId), [scope, artifactId])
}

export const clearSentRequests = () => {
	for (const scope of sentByScope.keys()) {
		try {
			window.localStorage.removeItem(keyFor(scope))
		} catch {
			// Nothing stored to clear.
		}
	}
	sentByScope.clear()
	storageWritable = true
	for (const listener of listeners) listener()
}
