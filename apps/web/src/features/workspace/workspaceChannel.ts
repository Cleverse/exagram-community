const NAME = "exagram.workspace"

let channel: BroadcastChannel | null | undefined

/** A BroadcastChannel never hears its own posts, so one per page can announce and listen. */
const shared = (): BroadcastChannel | null => {
	if (channel !== undefined) return channel
	channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(NAME) : null
	// Node keeps a channel alive until closed; a browser has no `unref`.
	;(channel as { unref?: () => void } | null)?.unref?.()
	return channel
}

/** The tabs of one browser share a session cookie, so a switch in one moves them all. */
export const announceSwitch = () => shared()?.postMessage("switched")

export const onSwitchElsewhere = (onSwitched: () => void) => {
	const source = shared()
	source?.addEventListener("message", onSwitched)
	return () => source?.removeEventListener("message", onSwitched)
}
