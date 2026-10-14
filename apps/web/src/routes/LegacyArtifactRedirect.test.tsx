import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { describe, expect, it } from "vitest"

import {
	LegacyArtifactRedirect,
	LegacyPendingRedirect,
	LegacyPreviewRedirect,
	LegacyProjectRedirect,
	RedirectKeepingSearch,
} from "./LegacyArtifactRedirect"

const Where = () => {
	const location = useLocation()
	return <div data-testid="where">{`${location.pathname}${location.search}`}</div>
}

const renderAt = (entry: string) =>
	render(
		<MemoryRouter initialEntries={[entry]}>
			<Routes>
				<Route path="/shares/:legacyId" element={<LegacyArtifactRedirect />} />
				<Route path="/shares/projects/:legacyProjectId" element={<LegacyProjectRedirect />} />
				<Route path="/artifact/:legacyId" element={<LegacyArtifactRedirect />} />
				<Route path="/artifacts/:artifactId" element={<Where />} />
				<Route path="/projects/:projectId" element={<Where />} />
				<Route path="/pending" element={<LegacyPendingRedirect />} />
				<Route path="/pending/artifacts/:previewId" element={<LegacyPreviewRedirect />} />
				<Route path="/projects/:projectId/artifacts/:previewId" element={<LegacyPreviewRedirect />} />
				<Route path="/activity" element={<Where />} />
				<Route path="/security" element={<RedirectKeepingSearch to="/settings/organization" />} />
				<Route path="/settings/organization" element={<Where />} />
				<Route path="/activity/artifacts/:previewId" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	)

describe("LegacyArtifactRedirect", () => {
	it("sends /shares/:id to /artifacts/:id and keeps the query string", () => {
		renderAt("/shares/a1?expanded=1")
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1?expanded=1")
	})

	it("sends the singular /artifact/:id to /artifacts/:id", () => {
		renderAt("/artifact/a1?panel=history")
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1?panel=history")
	})

	it("sends a project Share link to the same project and keeps its query string", () => {
		renderAt("/shares/projects/p1?tab=members")
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1?tab=members")
	})

	it("sends /pending to /activity", () => {
		renderAt("/pending")
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/activity$/)
	})

	it("sends a /pending preview to the same preview on /activity, and an old full-view link to the page", () => {
		const { unmount } = renderAt("/pending/artifacts/a1")
		expect(screen.getByTestId("where")).toHaveTextContent("/activity?preview=a1")
		unmount()
		renderAt("/pending/artifacts/a1?expanded=1")
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
	})

	it("sends a preview's old path under a Project to ?preview on that Project", () => {
		renderAt("/projects/p1/artifacts/a1?panel=history")
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1?panel=history&preview=a1")
	})

	it("keeps the query string when a moved screen redirects", () => {
		renderAt("/security?from=mail")
		expect(screen.getByTestId("where")).toHaveTextContent("/settings/organization?from=mail")
	})
})
