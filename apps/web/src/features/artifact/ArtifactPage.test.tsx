import { ApiError } from "@exagram/api-client"
import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ArtifactPage } from "./ArtifactPage"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"
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

	it("keeps a plain refusal as the not-found page", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(404, "Artifact unavailable"))
		renderPage()
		expect(await screen.findByRole("heading", { name: "This file isn't available" })).toBeInTheDocument()
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
	})
})
