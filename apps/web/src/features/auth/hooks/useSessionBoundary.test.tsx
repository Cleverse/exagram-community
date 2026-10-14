import { ApiError } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useMe } from "./useMe"
import { useSessionBoundary } from "./useSignIn"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { forgetAtSessionBoundary } from "@/features/auth/sessionMemory"

afterEach(() => vi.restoreAllMocks())

describe("useSessionBoundary", () => {
	it("leaves no earlier person's me standing when the new session's me cannot be read", async () => {
		vi.spyOn(apiClient.auth, "me").mockRejectedValue(new ApiError(503, "Not signed in"))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		client.setQueryData(QueryKeys.auth.me(), { id: "earlier-person" })
		client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), ["earlier person's file"])
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		)
		const { result } = renderHook(() => ({ me: useMe(), crossed: useSessionBoundary() }), { wrapper })

		result.current.crossed()

		await waitFor(() => expect(result.current.me.isError).toBe(true))
		expect(result.current.me.data).toBeUndefined()
		expect(client.getQueryData(QueryKeys.artifacts.list({ scope: "all" }))).toBeUndefined()
	})

	it("tells what keeps state in memory for the person to forget it", () => {
		const forget = vi.fn()
		forgetAtSessionBoundary(forget)
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => undefined))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		)
		const { result } = renderHook(() => useSessionBoundary(), { wrapper })

		result.current()

		expect(forget).toHaveBeenCalledOnce()
	})
})
