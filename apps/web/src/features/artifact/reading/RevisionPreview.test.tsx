import { type Revision, type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { RevisionPreview } from "./RevisionPreview"

import { QueryKeys } from "@/config/queryKeys"

const subject = (
	kind: VisibleArtifact["kind"],
): Pick<VisibleArtifact, "id" | "kind" | "title" | "visibleRevisionId"> => ({
	id: "a1",
	kind,
	title: "Spec",
	visibleRevisionId: "r2",
})

const renderPreview = (kind: VisibleArtifact["kind"]) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.revisions.bodyToken("a1", "r2"), {
		revisionId: "r2",
		url: "https://usercontent.example/uc/body-token",
		expiresInSeconds: 300,
	})
	const revision: Pick<Revision, "id" | "seq"> = { id: "r2", seq: 2 }
	return render(
		<QueryClientProvider client={queryClient}>
			<RevisionPreview artifact={subject(kind)} revision={revision} />
		</QueryClientProvider>,
	)
}

describe("RevisionPreview", () => {
	it("keeps the loading overlay over an HTML frame until it loads", () => {
		renderPreview("html")
		const frame = screen.getByTitle("Contents of Spec v2")
		expect(frame).toHaveAttribute("sandbox", "allow-scripts")
		expect(screen.getByText("Loading preview…")).toBeInTheDocument()

		fireEvent.load(frame)
		expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument()
	})

	it.each(["load", "error"] as const)("keeps the loading overlay over an image until it fires %s", (event) => {
		renderPreview("image")
		expect(screen.getByText("Loading preview…")).toBeInTheDocument()

		fireEvent[event](screen.getByRole("img", { name: "Spec" }))
		expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument()
	})
})
