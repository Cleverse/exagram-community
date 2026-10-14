import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearSentRequests, forgetSent, recordSent, sentRequestOf, useSentRequest } from "./sentRequests"

import { QueryKeys } from "@/config/queryKeys"
import { forgetSessionMemory } from "@/features/auth/sessionMemory"
import { sessionIn } from "@/test/workspaces"

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const request = { at: 1_000, role: "view", note: "" } as const

const storageKey = (scope: string) => `exagram.accessRequests.sent.${scope}`

beforeEach(() => clearSentRequests())
afterEach(() => vi.restoreAllMocks())

describe("sentRequests", () => {
	it("remembers a request in this browser's storage, per person and Workspace", () => {
		recordSent("u1.w1", A, { at: 5, role: "edit", note: "Please" })
		expect(sentRequestOf("u1.w1", A)).toEqual({ at: 5, role: "edit", note: "Please" })
		expect(sentRequestOf("u2.w1", A)).toBeUndefined()
		expect(sentRequestOf("u1.w2", A)).toBeUndefined()
		expect(JSON.parse(window.localStorage.getItem(storageKey("u1.w1")) ?? "")).toEqual({
			[A]: { at: 5, role: "edit", note: "Please" },
		})
	})

	it("reads back what an earlier page load stored", () => {
		window.localStorage.setItem(storageKey("u1.w1"), JSON.stringify({ [A]: request }))
		forgetSessionMemory()
		expect(sentRequestOf("u1.w1", A)).toEqual(request)
	})

	it("starts empty from storage that holds anything else", () => {
		window.localStorage.setItem(storageKey("u1.w1"), JSON.stringify({ [A]: { at: "yesterday" } }))
		forgetSessionMemory()
		expect(sentRequestOf("u1.w1", A)).toBeUndefined()
		window.localStorage.setItem(storageKey("u1.w1"), "{not json")
		forgetSessionMemory()
		expect(sentRequestOf("u1.w1", A)).toBeUndefined()
	})

	it("keeps the entries that parse when one does not", () => {
		window.localStorage.setItem(
			storageKey("u1.w1"),
			JSON.stringify({ [A]: request, [B]: { at: "yesterday" }, "not-an-object": 3 }),
		)
		forgetSessionMemory()
		expect(sentRequestOf("u1.w1", A)).toEqual(request)
		expect(sentRequestOf("u1.w1", B)).toBeUndefined()
	})

	it("adds to what another tab recorded since this one last looked, not over it", () => {
		recordSent("u1.w1", A, request)
		window.localStorage.setItem(storageKey("u1.w1"), JSON.stringify({ [A]: request, [B]: { ...request, at: 2_000 } }))
		recordSent("u1.w1", "file-c", { ...request, at: 3_000 })
		const stored = JSON.parse(window.localStorage.getItem(storageKey("u1.w1")) ?? "{}") as Record<string, unknown>
		expect(Object.keys(stored).sort()).toEqual([A, B, "file-c"].sort())
	})

	it("tells a mounted screen when another tab changes the memory", () => {
		const client = new QueryClient()
		client.setQueryData(QueryKeys.auth.me(), { id: "u1", ...sessionIn("team", "w1") })
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		)
		const { result } = renderHook(() => useSentRequest(A), { wrapper })
		expect(result.current).toBeUndefined()
		window.localStorage.setItem(storageKey("u1.w1"), JSON.stringify({ [A]: request }))
		act(() => {
			window.dispatchEvent(new StorageEvent("storage", { key: storageKey("u1.w1") }))
		})
		expect(result.current).toEqual(request)
	})

	it("forgets one file's request and keeps the rest", () => {
		recordSent("u1.w1", A, request)
		recordSent("u1.w1", B, request)
		forgetSent("u1.w1", A)
		expect(sentRequestOf("u1.w1", A)).toBeUndefined()
		expect(sentRequestOf("u1.w1", B)).toEqual(request)
	})

	it("keeps the newest fifty", () => {
		for (let at = 1; at <= 51; at += 1) recordSent("u1.w1", `file-${at}`, { ...request, at })
		expect(sentRequestOf("u1.w1", "file-1")).toBeUndefined()
		expect(sentRequestOf("u1.w1", "file-2")).toBeDefined()
		expect(sentRequestOf("u1.w1", "file-51")).toBeDefined()
	})

	it("still remembers for this tab when storage is off", () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("denied", "SecurityError")
		})
		recordSent("u1.w1", A, request)
		expect(sentRequestOf("u1.w1", A)).toEqual(request)
	})

	it("forgets what it holds in memory at a session boundary, leaving the next person nothing to read", () => {
		recordSent("u1.w1", A, request)
		window.localStorage.removeItem(storageKey("u1.w1"))
		forgetSessionMemory()
		expect(sentRequestOf("u1.w1", A)).toBeUndefined()
	})

	it("tells a mounted screen when the request is recorded and forgotten", () => {
		const client = new QueryClient()
		client.setQueryData(QueryKeys.auth.me(), { id: "u1", ...sessionIn("team", "w1") })
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		)
		const { result } = renderHook(() => useSentRequest(A), { wrapper })
		expect(result.current).toBeUndefined()
		act(() => recordSent("u1.w1", A, request))
		expect(result.current).toEqual(request)
		act(() => forgetSent("u1.w1", A))
		expect(result.current).toBeUndefined()
	})
})
