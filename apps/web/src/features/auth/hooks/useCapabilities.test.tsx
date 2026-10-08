import { COMMUNITY_CAPABILITIES } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useCapabilities } from "./useCapabilities"

import type { ReactNode } from "react"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

const CLOUD = {
	google: false,
	signUp: true,
	aiEdit: false,
	edition: "cloud",
	capabilities: { ...COMMUNITY_CAPABILITIES, redaction: true },
}

const setup = (seed?: unknown) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	if (seed !== undefined) queryClient.setQueryData(QueryKeys.auth.providers(), seed)
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return { queryClient, wrapper }
}

afterEach(() => vi.restoreAllMocks())

describe("useCapabilities", () => {
	it("is all false while loading and on error", async () => {
		const providers = vi.spyOn(apiClient.auth, "providers").mockRejectedValue(new Error("404"))
		const { result } = renderHook(() => useCapabilities(), { wrapper: setup().wrapper })
		expect(result.current).toEqual(COMMUNITY_CAPABILITIES)
		await waitFor(() => expect(providers).toHaveBeenCalled())
		expect(result.current).toEqual(COMMUNITY_CAPABILITIES)
	})

	// Cloud's web and api deploy separately (docs/cloud-deploy.md:11-12): a new web can meet an api from before Task 1.3.
	it("is all false when an older api sends no capabilities (P43)", () => {
		const { result } = renderHook(() => useCapabilities(), {
			wrapper: setup({ google: false, signUp: true, aiEdit: true }).wrapper,
		})
		expect(result.current).toEqual(COMMUNITY_CAPABILITIES)
	})

	it("passes through what the server declares", () => {
		const { result } = renderHook(() => useCapabilities(), { wrapper: setup(CLOUD).wrapper })
		expect(result.current.redaction).toBe(true)
	})

	it("is all false after a failed refetch, though the last answer stays cached (P40)", async () => {
		vi.spyOn(apiClient.auth, "providers")
			.mockResolvedValueOnce(CLOUD as never)
			.mockRejectedValue(new Error("503"))
		const { queryClient, wrapper } = setup()
		const { result } = renderHook(() => useCapabilities(), { wrapper })
		await waitFor(() => expect(result.current.redaction).toBe(true))
		await act(() => queryClient.refetchQueries({ queryKey: QueryKeys.auth.providers() }))
		await waitFor(() => expect(result.current).toEqual(COMMUNITY_CAPABILITIES))
		expect(queryClient.getQueryData(QueryKeys.auth.providers())).toEqual(CLOUD)
	})
})
