import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterAll, afterEach, vi } from "vitest"

afterEach(cleanup)

/*
 * Test files share one window per worker (`isolate: false` in vitest.config.ts). This file runs again before
 * every test file, so what follows records the window as the file found it and, once the file is done, puts back
 * what it changed: globals it redefined, listeners it left on `window`, storage, the address, attributes on
 * <html> and <body>, fake timers, and the app modules it loaded (so `vi.mock` in one file can't reach another).
 */

// Library globals set once per worker when a library first loads (React's act flag, React Router's version,
// zod's registry, React's `_reactListening…` mark): deleting one would leave the cached library without it.
const LIBRARY_GLOBAL = /^(__|_react|IS_REACT_)/

const snapshot = <T extends object>(target: T) => ({ target, descriptors: Object.getOwnPropertyDescriptors(target) })
const globals = [snapshot(globalThis), snapshot(navigator), snapshot(document), snapshot(document.documentElement)]

const putBack = ({ target, descriptors }: (typeof globals)[number]) => {
	const now = Object.getOwnPropertyDescriptors(target) as Record<string, PropertyDescriptor>
	const before = descriptors as Record<string, PropertyDescriptor>
	for (const key of Object.keys(now)) {
		const was = before[key]
		const is = now[key]!
		if (!was) {
			if (!LIBRARY_GLOBAL.test(key) && is.configurable) Reflect.deleteProperty(target, key)
		} else if (!Object.is(was.value, is.value) || was.get !== is.get || was.set !== is.set) {
			Object.defineProperty(target, key, was)
		}
	}
}

const attributesOf = (element: Element) => new Map([...element.attributes].map((a) => [a.name, a.value]))
const putAttributesBack = (element: Element, before: Map<string, string>) => {
	for (const { name } of [...element.attributes]) if (!before.has(name)) element.removeAttribute(name)
	for (const [name, value] of before) element.setAttribute(name, value)
}
const htmlAttributes = attributesOf(document.documentElement)
const bodyAttributes = attributesOf(document.body)
const startHref = window.location.href
const startTitle = document.title

// Listeners a module adds to `window` for the life of the page (the drawers' Back handling) would otherwise
// outlive their module and answer the next file's events.
type Listener = Parameters<typeof window.addEventListener>
const windowListeners: Listener[] = []
const addEventListener = window.addEventListener
const removeEventListener = window.removeEventListener
window.addEventListener = function (this: Window, ...args: Listener) {
	windowListeners.push(args)
	return addEventListener.apply(this, args)
} as typeof window.addEventListener

afterAll(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	window.addEventListener = addEventListener
	for (const args of windowListeners) removeEventListener.apply(window, args)
	for (const entry of globals) putBack(entry)
	localStorage.clear()
	sessionStorage.clear()
	window.history.replaceState(null, "", startHref)
	document.title = startTitle
	putAttributesBack(document.documentElement, htmlAttributes)
	putAttributesBack(document.body, bodyAttributes)
	vi.resetModules()
})
