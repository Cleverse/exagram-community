import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ARTIFACT = "11111111-1111-4111-8111-111111111111"

const api = vi.hoisted(() => ({
	create: vi.fn(),
	finalize: vi.fn(),
	get: vi.fn(),
	softDelete: vi.fn(),
	listPending: vi.fn(),
	revisionTicket: vi.fn(),
	revisionFinalize: vi.fn(),
	revisionList: vi.fn(),
}))

vi.mock("@/config/apiClient", () => ({
	apiClient: {
		artifacts: { create: api.create, finalize: api.finalize, get: api.get, softDelete: api.softDelete },
		approvals: { listPending: api.listPending },
		revisions: { createUploadTicket: api.revisionTicket, finalize: api.revisionFinalize, list: api.revisionList },
	},
}))

import { useUpload } from "./useUpload"

const ticket = {
	artifactId: ARTIFACT,
	storageKey: `artifacts/${ARTIFACT}/t1`,
	url: "https://storage.test/t1",
	expiresInSeconds: 900,
	requiredHeaders: {},
}
const input = { file: new File(["# hi"], "plan.md"), title: "plan", projectId: null, artifactId: null, note: null }

const render = () => {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return renderHook(() => useUpload(() => undefined), { wrapper })
}

const fetchMock = vi.fn()

describe("useUpload", () => {
	beforeEach(() => {
		for (const fn of Object.values(api)) fn.mockReset()
		api.create.mockResolvedValue({ artifact: { id: ARTIFACT }, ticket })
		api.finalize.mockResolvedValue({ id: "r1", status: "approved" })
		api.get.mockResolvedValue({ revisionSeq: null, visibleRevisionId: null })
		api.listPending.mockResolvedValue([])
		api.softDelete.mockResolvedValue(undefined)
		fetchMock.mockReset()
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => vi.unstubAllGlobals())

	it("reuses the Artifact it created when a failed PUT is retried", async () => {
		fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
		const { result } = render()

		await act(async () => {
			await expect(result.current.mutateAsync(input)).rejects.toThrow("did not reach storage")
		})
		await act(async () => {
			await expect(result.current.mutateAsync(input)).resolves.toMatchObject({ artifactId: ARTIFACT })
		})

		expect(api.create).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(api.finalize).toHaveBeenCalledTimes(1)
	})

	it("soft-deletes the empty Artifact when the person gives up, without reading its Revisions", async () => {
		fetchMock.mockResolvedValue({ ok: false })
		const { result } = render()
		await act(async () => {
			await expect(result.current.mutateAsync(input)).rejects.toThrow()
		})

		await act(() => result.current.discard())

		expect(api.get).toHaveBeenCalledWith({ artifactId: ARTIFACT })
		expect(api.listPending).toHaveBeenCalled()
		expect(api.softDelete).toHaveBeenCalledWith({ artifactId: ARTIFACT })
		expect(api.revisionList).not.toHaveBeenCalled()
	})

	it("discards nothing after a successful upload", async () => {
		fetchMock.mockResolvedValue({ ok: true })
		const { result } = render()
		await act(async () => {
			await result.current.mutateAsync(input)
		})

		await act(() => result.current.discard())

		expect(api.get).not.toHaveBeenCalled()
		expect(api.softDelete).not.toHaveBeenCalled()
	})
})
