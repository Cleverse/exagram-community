import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { describe, expect, it } from "vitest"

import { ProjectPage } from "./ProjectPage"

import { LegacyPreviewRedirect } from "@/routes/LegacyArtifactRedirect"
import { testQueryClient } from "@/test/mobile"

const Where = () => {
	const location = useLocation()
	return <div data-testid="where">{`${location.pathname}${location.search}`}</div>
}

describe("ProjectPage legacy preview", () => {
	it("opens the artifact page when the legacy project is unavailable", async () => {
		const client = testQueryClient()
		render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/projects/p1/artifacts/org-file"]}>
					<Routes>
						<Route path="/projects/:projectId/artifacts/:previewId" element={<LegacyPreviewRedirect />} />
						<Route path="/projects/:projectId" element={<ProjectPage />} />
						<Route path="/artifacts/:artifactId" element={<Where />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		)
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/org-file"))
	})
})
