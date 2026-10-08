import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createdProjectMessage, useProjectSettingsModel } from "./useProjectSettingsModel"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { projectFixture } from "@/features/artifact/sheets/sheetHarness"

const wrapper = ({ children }: { children: ReactNode }) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.projects.list(), [projectFixture()])
	return (
		<QueryClientProvider client={client}>
			<ToastProvider>{children}</ToastProvider>
		</QueryClientProvider>
	)
}

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe("useProjectSettingsModel", () => {
	it("starts from the Project's name and publish policy with the saved policy and switch", () => {
		const { result } = renderHook(() => useProjectSettingsModel("p1"), { wrapper })
		expect(result.current.initial).toEqual({ name: "Q4 planning", policy: "", overwrite: false, publish: "auto" })
	})

	it("writes only what changed, then reports back", async () => {
		const rename = vi.spyOn(apiClient.projects, "rename").mockResolvedValue(undefined as never)
		const setPublishPolicy = vi.spyOn(apiClient.projects, "setPublishPolicy").mockResolvedValue(undefined as never)
		const onSaved = vi.fn()
		const { result } = renderHook(() => useProjectSettingsModel("p1"), { wrapper })
		act(() =>
			result.current.save(
				{ name: " Q4 planning ", policy: " Cite sources. ", overwrite: true, publish: "manual" },
				onSaved,
			),
		)
		await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
		expect(rename).not.toHaveBeenCalled()
		expect(setPublishPolicy).toHaveBeenCalledWith({ projectId: "p1", publishPolicy: "manual" })
		expect(result.current.initial?.policy).toBe("Cite sources.")
		expect(result.current.initial?.overwrite).toBe(true)
	})

	it("has nothing to edit until the Project list holds the Project", () => {
		const { result } = renderHook(() => useProjectSettingsModel("unknown"), { wrapper })
		expect(result.current.initial).toBeNull()
	})
})

describe("createdProjectMessage", () => {
	it("reports the publish mode in a Team", () => {
		expect(createdProjectMessage("Notes", "manual", "team")).toBe(
			"Notes created — manual approval only, private until you invite someone.",
		)
	})

	it("reports no publish mode in a Personal Workspace, which has none", () => {
		expect(createdProjectMessage("Notes", "auto", "personal")).toBe("Notes created.")
	})
})
