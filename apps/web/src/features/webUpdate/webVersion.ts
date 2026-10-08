/** How often an open tab asks whether a deploy has replaced it. */
export const WEB_UPDATE_CHECK_INTERVAL_MS = 5 * 60_000

/** Returning to the tab checks too, but no more often than this. */
export const WEB_UPDATE_FOCUS_THROTTLE_MS = 60_000

/**
 * After a `webDeployed` event the tab checks at once and again this much later: Cloudflare can report a
 * deploy before every edge serves the new `version.json`.
 */
export const WEB_DEPLOYED_RECHECK_MS = 30_000

/**
 * After the last upload ends, how long to wait before reloading: a multi-file drop uploads one file at a
 * time, and the next one starts a moment after the previous finishes.
 */
export const WEB_UPDATE_UPLOAD_SETTLE_MS = 2_000

/** How many seconds a visible tab counts down, with Cancel, before it reloads onto an update. */
export const WEB_UPDATE_COUNTDOWN_SECONDS = 10

/** What the tab says while an update waits, and once it has reloaded. */
export const UPDATE_TOAST = {
	waitingForUpload: "Exagram has been updated — it will reload when your upload finishes",
	waitingForTyping: "Exagram has been updated — it will reload when you finish typing",
	reloaded: "Exagram is up to date",
} as const

/** The countdown before an update reload, and the banner that stays once it is cancelled. */
export const UPDATE_NOTICE = {
	countdown: (seconds: number) => `Exagram has been updated — reloading in ${seconds}s`,
	banner: "Exagram has been updated. Reload to get the latest.",
	bannerUploading: "Exagram has been updated. Reload once your upload finishes.",
} as const

/** The toast after an update reload, naming the release the tab now runs when the build knows it. */
export const reloadedToast = (release: string | null): string =>
	release === null ? UPDATE_TOAST.reloaded : `${UPDATE_TOAST.reloaded} — v${release}`

/** Set just before an update reload, so the new page can say it was updated. */
const UPDATED_MARKER_KEY = "exagram:updated"

export const markReloadForUpdate = (): void => {
	try {
		sessionStorage.setItem(UPDATED_MARKER_KEY, "1")
	} catch {
		// Storage blocked: the reload still happens, without the toast afterwards.
	}
}

/** True once after an update reload; reading it clears it. */
export const takeReloadedForUpdate = (): boolean => {
	try {
		const marked = sessionStorage.getItem(UPDATED_MARKER_KEY) !== null
		sessionStorage.removeItem(UPDATED_MARKER_KEY)
		return marked
	} catch {
		return false
	}
}

/** The file `vite.config.ts` writes next to `index.html` on every build; the SPA fallback answers it in dev. */
export const WEB_VERSION_PATH = "/version.json"

declare const __WEB_BUILD_ID__: string | undefined
declare const __WEB_RELEASE__: string | undefined

/** The web release (`apps/web/package.json`'s `version`) baked in by `vite.config.ts`, or null without one. */
export const currentRelease = (): string | null =>
	typeof __WEB_RELEASE__ === "string" ? normalizeBuildId(__WEB_RELEASE__) : null

/**
 * The build this bundle came from, baked in by `vite.config.ts`'s `define`. Null outside a build (dev,
 * tests), where there is no `version.json` to compare against.
 */
export const currentBuildId = (): string | null =>
	typeof __WEB_BUILD_ID__ === "string" ? normalizeBuildId(__WEB_BUILD_ID__) : null

export const normalizeBuildId = (value: unknown): string | null => {
	if (typeof value !== "string") return null
	return value.trim() || null
}

/** Reads `{ buildId }` out of `version.json`; anything else (the SPA's index.html, junk) is null. */
export const parseWebVersion = (value: unknown): string | null => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null
	return normalizeBuildId((value as { buildId?: unknown }).buildId)
}

const checkRequests = new Set<() => void>()

/**
 * Asks the mounted `WebUpdateReloader` to check now. The reloader sits above the router so signed-out pages
 * get it too, which puts it outside `LiveEventsProvider`; the live feed reaches it through here.
 */
export const requestWebUpdateCheck = (): void => {
	for (const listener of checkRequests) listener()
}

export const onWebUpdateCheckRequest = (listener: () => void): (() => void) => {
	checkRequests.add(listener)
	return () => {
		checkRequests.delete(listener)
	}
}

/** Only a real, different id on both sides counts: a missing one never reloads. */
export const isNewerBuildAvailable = (client: string | null, server: string | null): boolean =>
	client !== null && server !== null && client !== server
