/** Where the scroll snapshot taken just before an update reload waits for the new page. */
export const SCROLL_MEMORY_KEY = "exagram:update-scroll"

/** How long the reloaded page keeps trying to reach the saved offsets while its data loads. */
export const SCROLL_RESTORE_TIMEOUT_MS = 5_000

/** A snapshot older than this belongs to some other load and is dropped. */
const SNAPSHOT_MAX_AGE_MS = 60_000

type ScrollEntry = { path: string; top: number; left: number }
type ScrollSnapshot = { href: string; at: number; entries: ScrollEntry[] }

/**
 * Locates an element by its child indexes from `document.body`, e.g. "0/2/1". The app renders the same
 * tree for the same URL, so the path finds the same scroll container once the page has loaded again.
 */
export const elementPath = (element: Element): string | null => {
	const steps: number[] = []
	let node: Element = element
	while (node !== document.body) {
		const parent = node.parentElement
		if (!parent) return null
		steps.unshift(Array.prototype.indexOf.call(parent.children, node))
		node = parent
	}
	return steps.join("/")
}

export const elementAtPath = (path: string): Element | null => {
	let node: Element | undefined = document.body
	if (path === "") return node
	for (const step of path.split("/")) {
		node = node?.children[Number(step)]
		if (!node) return null
	}
	return node
}

/** Every scrolled element on the page, plus the document itself under the path "". */
export const captureScroll = (): ScrollEntry[] => {
	const entries: ScrollEntry[] = []
	const root = document.scrollingElement
	if (root && (root.scrollTop > 0 || root.scrollLeft > 0)) {
		entries.push({ path: "", top: root.scrollTop, left: root.scrollLeft })
	}
	for (const element of document.body.querySelectorAll("*")) {
		if (element.scrollTop <= 0 && element.scrollLeft <= 0) continue
		const path = elementPath(element)
		if (path !== null) entries.push({ path, top: element.scrollTop, left: element.scrollLeft })
	}
	return entries
}

/** Saves where this page is scrolled so the next load of the same URL can put it back. */
export const saveScrollForReload = (): void => {
	const snapshot: ScrollSnapshot = { href: window.location.href, at: Date.now(), entries: captureScroll() }
	try {
		sessionStorage.setItem(SCROLL_MEMORY_KEY, JSON.stringify(snapshot))
	} catch {
		// Storage full or blocked: the reload still happens, it just starts at the top.
	}
}

const takeSnapshot = (): ScrollSnapshot | null => {
	try {
		const raw = sessionStorage.getItem(SCROLL_MEMORY_KEY)
		sessionStorage.removeItem(SCROLL_MEMORY_KEY)
		if (!raw) return null
		const snapshot = JSON.parse(raw) as ScrollSnapshot
		if (snapshot.href !== window.location.href || Date.now() - snapshot.at > SNAPSHOT_MAX_AGE_MS) return null
		return Array.isArray(snapshot.entries) && snapshot.entries.length > 0 ? snapshot : null
	} catch {
		return null
	}
}

const scrollElement = (path: string): Element | null => (path === "" ? document.scrollingElement : elementAtPath(path))

/**
 * Puts back the offsets `saveScrollForReload` stored for this URL. The page fills in as its queries
 * resolve, so it retries on each DOM change until every offset is reached, the reader scrolls on their
 * own, or `SCROLL_RESTORE_TIMEOUT_MS` passes. Returns a stop function.
 */
export const restoreScrollAfterReload = (): (() => void) => {
	const snapshot = takeSnapshot()
	if (!snapshot) return () => {}
	let pending = snapshot.entries

	const apply = () => {
		pending = pending.filter((entry) => {
			const element = scrollElement(entry.path)
			if (!element) return true
			element.scrollTop = entry.top
			element.scrollLeft = entry.left
			// Not reached yet when the content is still too short; try again after the next change.
			return Math.abs(element.scrollTop - entry.top) > 1 || Math.abs(element.scrollLeft - entry.left) > 1
		})
		if (pending.length === 0) stop()
	}

	const observer = new MutationObserver(() => apply())
	const timeout = window.setTimeout(() => stop(), SCROLL_RESTORE_TIMEOUT_MS)
	const userEvents = ["wheel", "touchstart", "keydown", "mousedown"] as const
	const stop = () => {
		observer.disconnect()
		window.clearTimeout(timeout)
		for (const type of userEvents) window.removeEventListener(type, stop, true)
	}

	observer.observe(document.body, { childList: true, subtree: true })
	for (const type of userEvents) window.addEventListener(type, stop, { capture: true, passive: true })
	apply()
	return stop
}
