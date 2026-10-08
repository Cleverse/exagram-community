import { ApiError } from "@exagram/api-client"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

type MutationOptions = {
	onError?: (error: ApiError) => void
	onSuccess?: () => void
}

const { mutate, toast } = vi.hoisted(() => ({
	mutate: vi.fn<(input: { revisionId: string; confirmPlaceholders?: boolean }, options: MutationOptions) => void>(),
	toast: vi.fn<(message: string) => void>(),
}))

vi.mock("@/components/Toast", () => ({ useToast: () => toast }))
vi.mock("./useApprove", () => ({ useApproveRevision: () => ({ isPending: false, mutate }) }))

import { useApproveWithConfirmation } from "./useApproveWithConfirmation"

const revision = { revisionId: "r1", authorConnectionId: "connection-1", placeholderTypes: ["EMAIL"] as "EMAIL"[] }

describe("useApproveWithConfirmation", () => {
	beforeEach(() => {
		mutate.mockReset()
		toast.mockReset()
	})

	it("opens confirmation for Connection placeholders and confirms with true", () => {
		const { result } = renderHook(() => useApproveWithConfirmation())

		act(() => result.current.requestApproval(revision))
		expect(mutate).not.toHaveBeenCalled()
		expect(result.current.confirming?.revisionId).toBe("r1")

		act(() => result.current.confirmApproval())
		expect(mutate.mock.calls[0]?.[0]).toEqual({ revisionId: "r1", confirmPlaceholders: true })
		expect(result.current.confirming).toBeNull()
	})

	it("reopens on a placeholder confirmation refusal and toasts other errors", () => {
		const { result } = renderHook(() => useApproveWithConfirmation())

		act(() => result.current.requestApproval({ revisionId: "r1" }))
		const firstCall = mutate.mock.calls[0]
		if (!firstCall?.[1].onError) throw new Error("Expected an approval error handler")
		const onError = firstCall[1].onError
		act(() => onError(new ApiError(409, "confirm required", "PLACEHOLDERS_NEED_CONFIRMATION")))
		expect(result.current.confirming?.revisionId).toBe("r1")

		mutate.mockReset()
		act(() => result.current.cancelConfirmation())
		act(() => result.current.requestApproval({ revisionId: "r1" }))
		const retryCall = mutate.mock.calls[0]
		if (!retryCall?.[1].onError) throw new Error("Expected an approval error handler")
		const retryOnError = retryCall[1].onError
		act(() => retryOnError(new ApiError(409, "still checking", "REDACTION_NOT_READY")))
		expect(toast).toHaveBeenCalledWith("Redaction is still being checked. Try approving again shortly.")

		act(() => retryOnError(new ApiError(500, "Nope")))
		expect(toast).toHaveBeenCalledWith("Nope")
	})
})
