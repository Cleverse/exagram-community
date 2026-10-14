import { ApiError } from "@exagram/api-client"
import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ArtifactPage } from "./ArtifactPage"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { clearSentRequests, recordSent, sentRequestOf } from "@/features/access-requests/sentRequests"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"
import { decision, feedOf } from "@/test/accessRequests"
import { testQueryClient } from "@/test/mobile"

vi.mock("@/features/library/PreviewPane", () => ({
	PreviewPane: ({ artifact, onClose }: { artifact: { title: string }; onClose: () => void }) => (
		<div>
			<h1>{artifact.title}</h1>
			<button type="button" onClick={onClose}>
				Back
			</button>
		</div>
	),
}))

const Where = () => {
	const location = useLocation()
	return <div data-testid="where">{`${location.pathname}${location.search}`}</div>
}

const renderPage = (returnTo?: string) => {
	const client = testQueryClient()
	client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [])
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<MemoryRouter initialEntries={[{ pathname: "/artifacts/a1", state: returnTo ? { returnTo } : null }]}>
					<Routes>
						<Route path="/artifacts/:artifactId" element={<ArtifactPage />} />
						<Route path="*" element={<Where />} />
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

const HOUR = 3_600_000

beforeEach(() => clearSentRequests())
afterEach(() => vi.restoreAllMocks())

describe("ArtifactPage", () => {
	it("loads an org file by id even when it is absent from the library", async () => {
		const get = vi
			.spyOn(apiClient.artifacts, "get")
			.mockResolvedValue(
				artifactFixture({ projectId: null, access: "view", generalAccess: "org", orgDomain: "northwind.example" }),
			)
		renderPage()
		expect(await screen.findByRole("heading", { name: "Board pack" })).toBeInTheDocument()
		expect(get).toHaveBeenCalledWith({ artifactId: "a1" })
		await userEvent.setup().click(screen.getByRole("button", { name: "Back" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/")
	})

	it("returns to a plain list when the file was never in that list", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(
			artifactFixture({ projectId: null, access: "view", generalAccess: "org", orgDomain: "northwind.example" }),
		)
		renderPage("/shared?preview=a1")
		await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/shared")
	})

	it("returns to the library when the file's project is unavailable", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(
			artifactFixture({ projectId: "p1", access: "view", generalAccess: "org", orgDomain: "northwind.example" }),
		)
		renderPage("/projects/p1?preview=a1")
		await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/")
	})

	it("uses the library for Back on a direct org link to an unavailable project", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(
			artifactFixture({ projectId: "p1", access: "view", generalAccess: "org", orgDomain: "northwind.example" }),
		)
		renderPage()
		await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/")
	})

	it("asks a signed-in reader for the password of a file open to Anyone with the link, then shows the file", async () => {
		vi.spyOn(apiClient.artifacts, "get")
			.mockRejectedValueOnce(new ApiError(403, "Artifact unavailable", "PASSWORD_REQUIRED"))
			.mockResolvedValue(artifactFixture({ projectId: null, access: "view", generalAccess: "anyone" }))
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)
		renderPage()

		expect(await screen.findByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: /available/ })).not.toBeInTheDocument()
		await userEvent.setup().type(screen.getByLabelText("Password"), "right-one{Enter}")
		expect(await screen.findByRole("heading", { name: "Board pack" })).toBeInTheDocument()
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "right-one" })
	})

	it("tells a signed-in reader the link has expired rather than that the file is missing", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(410, "Artifact unavailable", "ANYONE_EXPIRED"))
		renderPage()
		expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: /available/ })).not.toBeInTheDocument()
	})

	it("shows a plain refusal as the Request access card, which names nothing", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(404, "Artifact unavailable"))
		renderPage()
		expect(await screen.findByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(screen.getByText("Ask the owner for access to this file.")).toBeInTheDocument()
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
	})

	it("opens a file nobody asked for at once, asking the feed nothing", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifactFixture({ projectId: null, access: "view" }))
		const feed = vi.spyOn(apiClient.notifications, "list")
		renderPage()
		expect(await screen.findByRole("heading", { name: "Board pack" })).toBeInTheDocument()
		expect(feed).not.toHaveBeenCalled()
	})

	it("opens a file this browser asked for behind the Owner's approval, then shows it", async () => {
		recordSent("u1.w1", "a1", { at: Date.now() - HOUR, role: "view", note: "" })
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifactFixture({ projectId: null, access: "view" }))
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(
			feedOf([
				decision({ artifactId: "a1", outcome: "granted", title: "Board pack", actorName: "Grace", role: "view" }),
			]),
		)
		renderPage()
		expect(await screen.findByRole("heading", { name: "You now have access to “Board pack”" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()
		await userEvent.setup().click(screen.getByRole("button", { name: "Open" }))
		expect(await screen.findByRole("heading", { name: "Board pack" })).toBeInTheDocument()
	})

	it("opens a file reached some other way at once, and forgets the request", async () => {
		recordSent("u1.w1", "a1", { at: Date.now() - HOUR, role: "view", note: "" })
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifactFixture({ projectId: null, access: "view" }))
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(feedOf([]))
		renderPage()
		expect(await screen.findByRole("heading", { name: "Board pack" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: /You now have access to/ })).not.toBeInTheDocument()
		await waitFor(() => expect(sentRequestOf("u1.w1", "a1")).toBeUndefined())
	})
})
