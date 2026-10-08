import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReadingBody } from "./ReadingBody"

import { useRevisionText } from "@/features/artifact/hooks/useArtifact"

vi.mock("@/features/artifact/hooks/useArtifact", () => ({ useRevisionText: vi.fn() }))

const artifact = {
	id: "11111111-1111-4111-8111-111111111111",
	kind: "doc",
	visibleRevisionId: "22222222-2222-4222-8222-222222222222",
	title: "Rows",
}

describe("ReadingBody", () => {
	beforeEach(() => {
		vi.mocked(useRevisionText).mockReturnValue({
			data: { revisionId: artifact.visibleRevisionId, mime: "text/csv", text: "name,age\nAda,37" },
			isPending: false,
			isError: false,
		} as never)
	})

	it("renders CSV as literal text", () => {
		const { container } = render(<ReadingBody artifact={artifact as never} zoom={100} />)

		expect(container.querySelector("pre")?.textContent).toBe("name,age\nAda,37")
		expect(container.querySelector("table")).toBeNull()
	})

	it("renders legacy JSON and chat HTML as escaped source", () => {
		for (const [kind, mime, body] of [
			["doc", "application/json", '{"html":"<script>alert(1)</script>"}'],
			["chat", "text/html", "<script>alert(1)</script>"],
		]) {
			vi.mocked(useRevisionText).mockReturnValue({
				data: { revisionId: artifact.visibleRevisionId, mime, text: body },
				isPending: false,
				isError: false,
			} as never)
			const { container, unmount } = render(<ReadingBody artifact={{ ...artifact, kind } as never} zoom={100} />)
			expect(container.querySelector("pre")?.textContent).toBe(body)
			expect(container.querySelector("script")).toBeNull()
			unmount()
		}
	})

	it("hides cached text when a pinned reader resolves to another revision", () => {
		vi.mocked(useRevisionText).mockReturnValue({
			data: { revisionId: "33333333-3333-4333-8333-333333333333", mime: "text/plain", text: "newer secret" },
			isPending: false,
			isError: false,
		} as never)
		const { container } = render(<ReadingBody artifact={artifact as never} zoom={100} />)
		expect(container.textContent).toContain("This version changed")
		expect(container.textContent).not.toContain("newer secret")
	})
})
