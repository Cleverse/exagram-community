import { useIsMutating } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { saveScrollForReload } from "./scrollMemory"
import { ReloadCountdown, UpdateBanner } from "./UpdateNotices"
import {
	currentBuildId,
	currentRelease,
	isNewerBuildAvailable,
	onWebUpdateCheckRequest,
	parseWebVersion,
	WEB_DEPLOYED_RECHECK_MS,
	WEB_UPDATE_CHECK_INTERVAL_MS,
	markReloadForUpdate,
	takeReloadedForUpdate,
	reloadedToast,
	UPDATE_TOAST,
	WEB_UPDATE_FOCUS_THROTTLE_MS,
	WEB_UPDATE_COUNTDOWN_SECONDS,
	WEB_UPDATE_UPLOAD_SETTLE_MS,
	WEB_VERSION_PATH,
} from "./webVersion"

import { useToast } from "@/components/Toast"
import { UPLOAD_MUTATION_KEY } from "@/features/library/upload"

/** True while the reader is typing somewhere a reload would throw away. */
const isEditing = (): boolean => {
	const active = document.activeElement
	if (!(active instanceof HTMLElement)) return false
	return active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA"
}

/** Typing in a tab the reader can see; a hidden tab's half-typed field is not in front of anyone. */
const editingInView = () => document.visibilityState === "visible" && isEditing()

const reloadKeepingScroll = () => {
	saveScrollForReload()
	markReloadForUpdate()
	window.location.reload()
}

/**
 * Notices a deploy made after this tab loaded and reloads onto it, keeping the scroll position
 * (`scrollMemory.ts` puts it back after the load). It checks when the live feed says a build went live
 * (`webDeployed`), when the tab is shown again, and on a timer as the fallback for a missed hook or a
 * self-hosted install. It waits for every upload in flight to finish, even in a hidden tab, and while the
 * reader is typing in a field it waits until they leave it or the tab is hidden, so neither is lost.
 * A toast says why it is waiting. A visible tab then counts down `WEB_UPDATE_COUNTDOWN_SECONDS` with Reload now and
 * Cancel; Cancel leaves a banner with Reload until the reader takes it, and nothing reloads on its own after that.
 * The reloaded page says it is up to date.
 */
export const WebUpdateReloader = ({
	clientBuildId = currentBuildId(),
	reload = reloadKeepingScroll,
	release = currentRelease(),
}: {
	clientBuildId?: string | null
	reload?: () => void
	release?: string | null
}) => {
	const [updateAvailable, setUpdateAvailable] = useState(false)
	const uploading = useIsMutating({ mutationKey: UPLOAD_MUTATION_KEY }) > 0
	const uploadedSinceUpdate = useRef(false)
	const toldWaiting = useRef(false)
	// `waiting` until it is safe, then `countdown`; `dismissed` after Cancel, which leaves the banner.
	const [phase, setPhase] = useState<"waiting" | "countdown" | "dismissed">("waiting")
	const [secondsLeft, setSecondsLeft] = useState(WEB_UPDATE_COUNTDOWN_SECONDS)
	const toast = useToast()

	useEffect(() => {
		if (takeReloadedForUpdate()) toast(reloadedToast(release))
	}, [toast, release])

	useEffect(() => {
		if (clientBuildId === null || updateAvailable) return
		let disposed = false
		let controller: AbortController | null = null
		let lastCheck = 0

		const check = async () => {
			lastCheck = Date.now()
			controller?.abort()
			controller = new AbortController()
			try {
				// The query string backs up `no-store` against a cache that ignores it.
				const response = await fetch(`${WEB_VERSION_PATH}?_=${lastCheck}`, {
					cache: "no-store",
					signal: controller.signal,
				})
				if (!response.ok) return
				const serverBuildId = parseWebVersion(await response.json())
				if (!disposed && isNewerBuildAvailable(clientBuildId, serverBuildId)) setUpdateAvailable(true)
			} catch {
				// Offline, aborted, or not JSON: stay quiet, the next check retries.
			}
		}

		const onVisible = () => {
			if (document.visibilityState === "visible" && Date.now() - lastCheck >= WEB_UPDATE_FOCUS_THROTTLE_MS) {
				void check()
			}
		}

		let recheck: number | null = null
		const onDeployed = () => {
			void check()
			if (recheck !== null) window.clearTimeout(recheck)
			recheck = window.setTimeout(() => void check(), WEB_DEPLOYED_RECHECK_MS)
		}

		const interval = window.setInterval(() => void check(), WEB_UPDATE_CHECK_INTERVAL_MS)
		document.addEventListener("visibilitychange", onVisible)
		const stopRequests = onWebUpdateCheckRequest(onDeployed)
		return () => {
			disposed = true
			window.clearInterval(interval)
			if (recheck !== null) window.clearTimeout(recheck)
			document.removeEventListener("visibilitychange", onVisible)
			stopRequests()
			controller?.abort()
		}
	}, [clientBuildId, updateAvailable])

	useEffect(() => {
		if (!updateAvailable || phase === "dismissed") return
		const tellWaiting = (message: string) => {
			if (toldWaiting.current) return
			toldWaiting.current = true
			toast(message)
		}
		if (uploading) {
			uploadedSinceUpdate.current = true
			tellWaiting(UPDATE_TOAST.waitingForUpload)
			// An upload that starts during the countdown stops it; it starts again once the upload settles.
			if (phase === "countdown") setPhase("waiting")
			return
		}
		if (phase === "countdown") return
		let done = false
		const reloadWhenSafe = () => {
			if (done) return
			if (editingInView()) {
				tellWaiting(UPDATE_TOAST.waitingForTyping)
				return
			}
			done = true
			// Nobody sees a countdown in a hidden tab; the reloaded page tells them instead.
			if (document.visibilityState === "hidden") {
				reload()
				return
			}
			setSecondsLeft(WEB_UPDATE_COUNTDOWN_SECONDS)
			setPhase("countdown")
		}
		// `focusout` fires before focus moves on; look once the new target has settled.
		const onFocusOut = () => window.setTimeout(reloadWhenSafe, 0)
		const watch = () => {
			document.addEventListener("focusout", onFocusOut)
			document.addEventListener("visibilitychange", reloadWhenSafe)
			reloadWhenSafe()
		}
		const settle = uploadedSinceUpdate.current ? window.setTimeout(watch, WEB_UPDATE_UPLOAD_SETTLE_MS) : null
		if (settle === null) watch()
		return () => {
			done = true
			if (settle !== null) window.clearTimeout(settle)
			document.removeEventListener("focusout", onFocusOut)
			document.removeEventListener("visibilitychange", reloadWhenSafe)
		}
	}, [updateAvailable, uploading, phase, reload, toast])

	useEffect(() => {
		if (phase !== "countdown") return
		let left = WEB_UPDATE_COUNTDOWN_SECONDS
		const tick = window.setInterval(() => {
			left -= 1
			if (left > 0) {
				setSecondsLeft(left)
				return
			}
			window.clearInterval(tick)
			// Started typing during the countdown: wait for them to leave the field, then count again.
			if (editingInView()) setPhase("waiting")
			else reload()
		}, 1_000)
		return () => window.clearInterval(tick)
	}, [phase, reload])

	if (!updateAvailable) return null
	if (phase === "countdown") {
		return <ReloadCountdown seconds={secondsLeft} onReload={reload} onCancel={() => setPhase("dismissed")} />
	}
	if (phase === "dismissed") return <UpdateBanner uploading={uploading} onReload={reload} />
	return null
}
