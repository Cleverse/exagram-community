import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installUsercontentLinks } from "./usercontentLinks"

const ORIGIN = "http://localhost:3002"

const frame = (src: string) => {
	const el = document.createElement("iframe")
	// Setting `src` would make the DOM try to load it; only the property is read.
	Object.defineProperty(el, "src", { value: src })
	document.body.append(el)
	if (el.contentWindow === null) throw new Error("no contentWindow")
	return el.contentWindow
}

const send = (source: MessageEventSource | null, data: unknown) => {
	window.dispatchEvent(new MessageEvent("message", { source, data, origin: "null" }))
}

const good = { type: "exagram:open-link", url: "https://example.com/a?b=1" }

describe("installUsercontentLinks", () => {
	let open: ReturnType<typeof vi.fn>
	let uninstall: () => void

	beforeEach(() => {
		open = vi.fn()
		vi.stubGlobal("open", open)
		uninstall = installUsercontentLinks()
	})

	afterEach(() => {
		uninstall()
		document.body.innerHTML = ""
		vi.unstubAllGlobals()
	})

	it("opens an accepted link once in a new noopener tab", () => {
		send(frame(`${ORIGIN}/uc/token`), good)
		expect(open).toHaveBeenCalledTimes(1)
		expect(open).toHaveBeenCalledWith("https://example.com/a?b=1", "_blank", "noopener,noreferrer")
	})

	it("ignores a message from an iframe that is not on the usercontent origin", () => {
		send(frame("https://evil.example/uc/token"), good)
		expect(open).not.toHaveBeenCalled()
	})

	it("ignores a message from an unknown source", () => {
		frame(`${ORIGIN}/uc/token`)
		send(window, good)
		send(null, good)
		expect(open).not.toHaveBeenCalled()
	})

	it.each([
		["a wrong type", { type: "other", url: "https://example.com/" }],
		["a non-string url", { type: "exagram:open-link", url: 1 }],
		["a missing url", { type: "exagram:open-link" }],
		["a string payload", "https://example.com/"],
		["null", null],
		["an array", [good]],
		["a javascript url", { type: "exagram:open-link", url: "javascript:alert(1)" }],
		["a mailto url", { type: "exagram:open-link", url: "mailto:a@example.com" }],
		["a relative url", { type: "exagram:open-link", url: "/x" }],
		["a usercontent-origin url", { type: "exagram:open-link", url: `${ORIGIN}/uc/other` }],
	])("ignores %s", (_name, data) => {
		send(frame(`${ORIGIN}/uc/token`), data)
		expect(open).not.toHaveBeenCalled()
	})
})
