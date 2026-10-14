/** One system notification for the Mac app to post through the bridge's `notify`. */
export type MacNotice = { id: string; title: string; body: string; path: string }

/** `window.exagram` as the Mac app publishes it. */
export type MacBridge = {
	platform: "macos"
	bridgeVersion: number
	/** Present from bridge version 2. */
	notify?: (notice: MacNotice) => void
	/** Present from bridge version 4. */
	chooseServer?: () => void
}

/** The first bridge version that understands `notify`. */
export const NOTIFY_BRIDGE_VERSION = 2

/**
 * The Mac app's bridge, or `null` in a browser. Read field by field: the object is the app's, but a page must not
 * assume a shape an older or newer app may not have.
 */
export const macBridge = (): MacBridge | null => {
	const raw = (window as { exagram?: unknown }).exagram
	if (typeof raw !== "object" || raw === null) return null
	const { platform, bridgeVersion, notify, chooseServer } = raw as Record<string, unknown>
	if (platform !== "macos" || typeof bridgeVersion !== "number") return null
	return {
		platform,
		bridgeVersion,
		notify: typeof notify === "function" ? (notice) => void notify.call(raw, notice) : undefined,
		chooseServer: typeof chooseServer === "function" ? () => void chooseServer.call(raw) : undefined,
	}
}

/** The first bridge version whose app opens `window.open` of an Exagram URL as a tab. */
export const TABS_BRIDGE_VERSION = 3

/** Whether the page runs in a Mac app with tabs, where opening a file gives it a tab of its own. */
export const macTabs = (bridge: MacBridge | null = macBridge()): boolean =>
	bridge !== null && bridge.bridgeVersion >= TABS_BRIDGE_VERSION

/** Whether the page runs in a Mac app that posts Notifications. */
export const macNotifies = (bridge: MacBridge | null = macBridge()): boolean =>
	bridge !== null && bridge.bridgeVersion >= NOTIFY_BRIDGE_VERSION && bridge.notify !== undefined
