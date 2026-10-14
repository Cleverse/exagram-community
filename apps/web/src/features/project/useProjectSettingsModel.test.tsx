import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, screen, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createdProjectMessage, useProjectSettingsModel } from "./useProjectSettingsModel"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { projectFixture } from "@/features/artifact/sheets/sheetHarness"
import { sessionIn } from "@/test/workspaces"

const wrapperIn =
	(kind: "personal" | "team") =>
	({ children }: { children: ReactNode }) => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
		client.setQueryData(QueryKeys.projects.list(), [projectFixture()])
		client.setQueryData(QueryKeys.auth.me(), { id: "u1", ...sessionIn(kind, "w1") })
		return (
			<QueryClientProvider client={client}>
				<ToastProvider>{children}</ToastProvider>
			</QueryClientProvider>
		)
	}
const wrapper = wrapperIn("team")

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

	const savedToast = async (kind: "personal" | "team") => {
		const { result } = renderHook(() => useProjectSettingsModel("p1"), { wrapper: wrapperIn(kind) })
		act(() => result.current.save({ name: "Q4 planning", policy: "", overwrite: false, publish: "auto" }, vi.fn()))
		return (await screen.findByRole("status")).textContent
	}

	it("says a Team folder's save applies to the next request", async () => {
		expect(await savedToast("team")).toBe("Settings saved — applies to the next request.")
	})

	it.skipIf(!edition.projectRules)(
		"says a Personal folder's save applies to the next request where it has rules",
		async () => {
			expect(await savedToast("personal")).toBe("Settings saved — applies to the next request.")
		},
	)

	it.skipIf(edition.projectRules)("says only that a Personal folder saved where it has no rules to show", async () => {
		expect(await savedToast("personal")).toBe("Settings saved.")
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
