import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSwitchWorkspace } from "./useSwitchWorkspace"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useMe } from "@/features/auth/hooks/useMe"

const TEAM = "00000000-0000-4000-8000-0000000000a1"
const PERSONAL = "00000000-0000-4000-8000-0000000000a2"
const meIn = (workspaceId: string) => ({ id: "u1", workspaceId, workspaces: [] })

afterEach(() => vi.restoreAllMocks())

describe("useSwitchWorkspace", () => {
	it("keeps the switch's me when a me fetch that began before the switch answers after it", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		client.setQueryData(QueryKeys.auth.me(), meIn(TEAM))
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>
				<ToastProvider>{children}</ToastProvider>
			</QueryClientProvider>
		)
		let answerOld: (me: unknown) => void = () => undefined
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise((resolve) => (answerOld = resolve)) as never)
		vi.spyOn(apiClient.auth, "switchWorkspace").mockResolvedValue(meIn(PERSONAL) as never)
		const { result } = renderHook(() => ({ me: useMe(), switching: useSwitchWorkspace() }), { wrapper })

		await act(async () => {
			void client.invalidateQueries({ queryKey: QueryKeys.auth.me() })
			await new Promise((resolve) => setTimeout(resolve, 10))
		})
		await act(async () => {
			await result.current.switching.mutateAsync(PERSONAL)
		})
		await act(async () => {
			answerOld(meIn(TEAM))
			await new Promise((resolve) => setTimeout(resolve, 20))
		})

		expect(result.current.me.data?.workspaceId).toBe(PERSONAL)
	})
})
