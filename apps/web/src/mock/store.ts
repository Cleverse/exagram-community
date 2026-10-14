import { useCallback, useSyncExternalStore } from "react"

/**
 * localStorage-backed state for the parts of the design the API has no field for (project
 * settings, client settings, the security switches). One `storage` event feed plus an in-tab
 * listener list, so every `useLocalStore` with the same key re-renders together.
 */

const PREFIX = "exagram.mock."

const listeners = new Set<() => void>()
const cache = new Map<string, string | null>()

const emit = () => {
	for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	if (listeners.size === 1) window.addEventListener("storage", onStorage)
	return () => {
		listeners.delete(listener)
		if (listeners.size === 0) window.removeEventListener("storage", onStorage)
	}
}

const onStorage = (event: StorageEvent) => {
	if (event.key === null || event.key.startsWith(PREFIX)) {
		cache.clear()
		emit()
	}
}

/** Cached so `getSnapshot` returns a stable string identity between writes. */
const readRaw = (key: string): string | null => {
	if (cache.has(key)) return cache.get(key) ?? null
	let raw: string | null = null
	try {
		raw = window.localStorage.getItem(PREFIX + key)
	} catch {
		raw = null
	}
	cache.set(key, raw)
	return raw
}

/** Parsed values are memoised per raw string so a re-render hands back the same object. */
const parsedCache = new Map<string, { raw: string; value: unknown }>()

const parse = <T>(key: string, raw: string, fallback: T): T => {
	const hit = parsedCache.get(key)
	if (hit && hit.raw === raw) return hit.value as T
	try {
		const value = JSON.parse(raw) as T
		parsedCache.set(key, { raw, value })
		return value
	} catch {
		return fallback
	}
}

export const readMock = <T>(key: string, fallback: T): T => {
	const raw = readRaw(key)
	return raw === null ? fallback : parse(key, raw, fallback)
}

export const writeMock = <T>(key: string, value: T): void => {
	const raw = JSON.stringify(value)
	try {
		window.localStorage.setItem(PREFIX + key, raw)
	} catch {
		// Private-mode quota failures leave the in-memory cache authoritative for this tab.
	}
	cache.set(key, raw)
	emit()
}

export const clearMock = (key: string): void => {
	try {
		window.localStorage.removeItem(PREFIX + key)
	} catch {
		// See writeMock.
	}
	cache.delete(key)
	emit()
}

export const useLocalStore = <T>(key: string, initial: T): [T, (next: T | ((current: T) => T)) => void] => {
	const value = useSyncExternalStore(
		subscribe,
		() => readRaw(key),
		() => null,
	)

	const parsed = value === null ? initial : parse(key, value, initial)

	const set = useCallback(
		(next: T | ((current: T) => T)) => {
			const current = readMock(key, initial)
			writeMock(key, typeof next === "function" ? (next as (current: T) => T)(current) : next)
		},
		// `initial` is a fresh literal on most call sites; only the key identifies the slot.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[key],
	)

	return [parsed, set]
}
