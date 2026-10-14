import { runInNewContext } from "node:vm"

import { describe, expect, it } from "vitest"

import { injectInlineShims } from "./inline-shims"

const run = (html: string) => injectInlineShims(Buffer.from(html, "latin1")).toString("latin1")
const SHIM_AT = /<script>\(function\(\)\{.*?\}\)\(\)<\/script>/

const split = (out: string) => {
	const match = SHIM_AT.exec(out)
	if (!match) throw new Error("no shim")
	return [out.slice(0, match.index), out.slice(match.index + match[0].length)] as const
}

describe("injectInlineShims", () => {
	it.each([
		["<!DOCTYPE html><html><head></head>", "<!DOCTYPE html>", "<html><head></head>"],
		["<!doctype html>\n<p>x</p>", "<!doctype html>", "\n<p>x</p>"],
		["\n  \t<!DOCTYPE html><html>", "\n  \t<!DOCTYPE html>", "<html>"],
		['<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">x', '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">', "x"],
		["\u00ef\u00bb\u00bf<!DOCTYPE html><p>", "\u00ef\u00bb\u00bf<!DOCTYPE html>", "<p>"],
		["\u00ef\u00bb\u00bf<html><head>", "\u00ef\u00bb\u00bf", "<html><head>"],
		["<html><head><title>x</title>", "", "<html><head><title>x</title>"],
		["<p>x</p>", "", "<p>x</p>"],
		["<!-- c --><!DOCTYPE html><html>", "", "<!-- c --><!DOCTYPE html><html>"],
		["<!DOCTYPE html", "", "<!DOCTYPE html"],
	])("inserts into %j", (input, expectedBefore, expectedAfter) => {
		const [before, after] = split(run(input))
		expect(before).toBe(expectedBefore)
		expect(after).toBe(expectedAfter)
	})

	it("ignores a doctype with no > in the prefix", () => {
		const input = `<!DOCTYPE ${"a".repeat(2000)}>x`
		const [before] = split(run(input))
		expect(before).toBe("")
	})

	it("installs memory storage only where the storage getter throws", () => {
		const script = SHIM_AT.exec(run("x"))?.[0].slice("<script>".length, -"</script>".length) ?? ""
		const working = { getItem: () => "real" }
		const window: Record<string, unknown> = { sessionStorage: working }
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			get: () => {
				throw new Error("SecurityError")
			},
		})
		runInNewContext(script, { window })
		const local = window.localStorage as Storage
		local.setItem("k", "1")
		expect(local.getItem("k")).toBe("1")
		expect(local.getItem("missing")).toBeNull()
		expect(local.length).toBe(1)
		expect(window.sessionStorage).toBe(working)
	})

	it("preserves non-UTF-8 bytes exactly around the insertion", () => {
		const head = Buffer.from("<!DOCTYPE html>")
		const tail = Buffer.from([0xff, 0xfe, 0x80, 0xc3, 0x28, ...Buffer.from("</head>")])
		const out = injectInlineShims(Buffer.concat([head, tail]))
		expect(out.subarray(0, head.length).equals(head)).toBe(true)
		expect(out.subarray(out.length - tail.length).equals(tail)).toBe(true)
	})

	it("is ASCII", () => {
		expect([...injectInlineShims(Buffer.from("x"))].every((b) => b < 0x80)).toBe(true)
	})

	describe("link shim", () => {
		const PAGE = "https://uc.exagram.test/uc/token"
		const scriptOf = () => SHIM_AT.exec(run("x"))?.[0].slice("<script>".length, -"</script>".length) ?? ""

		type Handler = (e: unknown) => void
		interface Setup {
			messages: unknown[]
			dispatch: (
				type: "click" | "auxclick",
				path: unknown[],
				init?: { button?: number; defaultPrevented?: boolean },
			) => { prevented: boolean }
			listeners: Record<string, Handler[]>
			location: { href: string; origin: string }
		}

		const setup = (framed = true): Setup => {
			const listeners: Record<string, Handler[]> = {}
			const messages: unknown[] = []
			const win: Record<string, unknown> = {
				addEventListener: (type: string, h: Handler) => (listeners[type] ??= []).push(h),
			}
			win.parent = framed ? { postMessage: (m: unknown, target: string) => messages.push([m, target]) } : win
			const location = { href: PAGE, origin: "null" }
			runInNewContext(scriptOf(), {
				window: win,
				document: { baseURI: PAGE },
				location,
				URL,
			})
			return {
				messages,
				listeners,
				location,
				dispatch: (type, path, init = {}) => {
					let prevented = init.defaultPrevented ?? false
					const e = {
						type,
						button: init.button ?? (type === "click" ? 0 : 1),
						get defaultPrevented() {
							return prevented
						},
						preventDefault: () => {
							prevented = true
						},
						composedPath: () => path,
					}
					for (const h of listeners[type] ?? []) h(e)
					return { prevented: prevented && !init.defaultPrevented }
				},
			}
		}

		const anchor = (attrs: Record<string, string>, localName = "a") => ({
			localName,
			getAttribute: (n: string) => attrs[n] ?? null,
			hasAttribute: (n: string) => n in attrs,
		})

		it("hands an external link to the parent and cancels navigation", () => {
			const s = setup()
			const { prevented } = s.dispatch("click", [
				{ localName: "span" },
				anchor({ href: "https://example.com/a?b=1#c" }),
			])
			expect(prevented).toBe(true)
			expect(s.messages).toEqual([[{ type: "exagram:open-link", url: "https://example.com/a?b=1#c" }, "*"]])
		})

		it("handles area links and a _blank target", () => {
			const s = setup()
			s.dispatch("click", [anchor({ href: "http://example.com/", target: "_blank" }, "area")])
			expect(s.messages).toHaveLength(1)
		})

		it("handles a middle click and ignores other buttons", () => {
			const s = setup()
			const a = anchor({ href: "https://example.com/" })
			expect(s.dispatch("auxclick", [a], { button: 1 }).prevented).toBe(true)
			expect(s.dispatch("auxclick", [a], { button: 2 }).prevented).toBe(false)
			expect(s.dispatch("click", [a], { button: 1 }).prevented).toBe(false)
			expect(s.dispatch("click", [a], { button: 2 }).prevented).toBe(false)
			expect(s.messages).toHaveLength(1)
		})

		it.each([
			["a fragment", { href: "#section" }],
			["an empty href", { href: "" }],
			["mailto", { href: "mailto:a@example.com" }],
			["javascript", { href: "javascript:alert(1)" }],
			["a download link", { href: "https://example.com/f.zip", download: "" }],
			["a named target", { href: "https://example.com/", target: "inner" }],
			["an unparseable url", { href: "http://" }],
			["an anchor without href", { name: "x" }],
		])("leaves %s to the browser", (_name, attrs) => {
			const s = setup()
			expect(s.dispatch("click", [anchor(attrs)]).prevented).toBe(false)
			expect(s.messages).toEqual([])
		})

		it("cancels a link to another path on this origin and applies its fragment", () => {
			const s = setup()
			expect(s.dispatch("click", [anchor({ href: "/index.html#topic-2" })]).prevented).toBe(true)
			expect(s.messages).toEqual([])
			expect(s.location.href).toBe(`${PAGE}#topic-2`)
		})

		it("cancels a link to another path without a fragment and leaves the hash", () => {
			const s = setup()
			expect(s.dispatch("click", [anchor({ href: "page2.html" })]).prevented).toBe(true)
			expect(s.messages).toEqual([])
			expect(s.location.href).toBe(PAGE)
		})

		it("leaves a fragment link within the document to the browser", () => {
			const s = setup()
			expect(s.dispatch("click", [anchor({ href: "#topic-2" })]).prevented).toBe(false)
			expect(s.messages).toEqual([])
			expect(s.location.href).toBe(PAGE)
		})

		it("cancels the same path with a different query", () => {
			const s = setup()
			expect(s.dispatch("click", [anchor({ href: "?a=1" })]).prevented).toBe(true)
			expect(s.messages).toEqual([])
		})

		it("cancels a middle click on a same-origin link without applying its fragment", () => {
			const s = setup()
			expect(s.dispatch("auxclick", [anchor({ href: "/index.html#topic-2" })], { button: 1 }).prevented).toBe(true)
			expect(s.messages).toEqual([])
			expect(s.location.href).toBe(PAGE)
		})

		it("ignores an event the page already cancelled", () => {
			const s = setup()
			s.dispatch("click", [anchor({ href: "https://example.com/" })], { defaultPrevented: true })
			expect(s.messages).toEqual([])
		})

		it("ignores clicks that are not on a link", () => {
			const s = setup()
			s.dispatch("click", [{ localName: "div" }, { localName: "body" }])
			expect(s.messages).toEqual([])
		})

		it("installs nothing when the document is not framed", () => {
			expect(setup(false).listeners).toEqual({})
		})

		it("registers in the bubble phase", () => {
			const s = setup()
			expect(Object.keys(s.listeners).sort()).toEqual(["auxclick", "click"])
		})
	})
})
