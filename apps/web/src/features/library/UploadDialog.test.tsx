import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

const { discard } = vi.hoisted(() => ({ discard: vi.fn(() => Promise.resolve(undefined)) }))

vi.mock("@/components/Toast", () => ({ useToast: () => vi.fn() }))
vi.mock("@/features/library/hooks/useUpload", () => ({
	useUpload: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, discard }),
}))

import { UploadDialog } from "./UploadDialog"

describe("UploadDialog", () => {
	it("discards a failed upload's empty Artifact when the person cancels", async () => {
		const onClose = vi.fn()
		render(<UploadDialog projectId={null} onClose={onClose} />)

		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))

		expect(discard).toHaveBeenCalledTimes(1)
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})
