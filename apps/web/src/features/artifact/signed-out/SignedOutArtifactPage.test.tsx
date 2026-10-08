import { ApiError } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SignedOutArtifact } from "./SignedOutArtifact"
import { SignedOutArtifactPage } from "./SignedOutArtifactPage"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"

const Where = () => {
	const location = useLocation()
	const from = (location.state as { from?: string } | null)?.from ?? ""
	return <div data-testid="where">{`${location.pathname} from=${from}`}</div>
}

/** The frame's signed-out face at `at`, with no session in the cache: what a stranger's browser does. */
const renderSignedOut = (at: string) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<MemoryRouter initialEntries={[at]}>
					<Routes>
						<Route path="/artifacts/:artifactId" element={<SignedOutArtifact />} />
						<Route path="/projects" element={<SignedOutArtifact />} />
						<Route path="*" element={<Where />} />
					</Routes>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

afterEach(() => vi.restoreAllMocks())

describe("SignedOutArtifactPage", () => {
	it("reads a file open to anyone with the link signed out: its text, a Sign in button, and no session calls", async () => {
		const artifact = artifactFixture({
			access: "view",
			generalAccess: "anyone",
			orgDomain: null,
			visibleRevisionId: "r3",
		})
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifact)
		const text = vi
			.spyOn(apiClient.revisions, "text")
			.mockResolvedValue({ revisionId: "r3", mime: "text/markdown", text: "# Agenda\n\nNumbers first." })
		const me = vi.spyOn(apiClient.auth, "me")
		const grants = vi.spyOn(apiClient.grants, "list")

		renderSignedOut("/artifacts/a1?panel=comments")
		expect(await screen.findByRole("heading", { name: "Board pack" })).toBeInTheDocument()
		expect(await screen.findByText("Numbers first.")).toBeInTheDocument()
		expect(text).toHaveBeenCalledWith({ artifactId: "a1" })
		expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin")
		expect(screen.getByText("Shared by Ada Lovelace")).toBeInTheDocument()
		expect(me).not.toHaveBeenCalled()
		expect(grants).not.toHaveBeenCalled()
		expect(screen.queryByRole("button", { name: /share/i })).not.toBeInTheDocument()
	})

	it("frames an HTML body from its body token, sandboxed", async () => {
		const artifact = artifactFixture({ kind: "html", access: "view", generalAccess: "anyone", visibleRevisionId: "r3" })
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifact)
		const bodyToken = vi
			.spyOn(apiClient.revisions, "bodyToken")
			.mockResolvedValue({ revisionId: "r3", url: "https://uc.exagram.test/uc/t", expiresInSeconds: 300 })

		renderSignedOut("/artifacts/a1")
		const frame = await screen.findByTitle("Contents of Board pack")
		expect(frame).toHaveAttribute("src", "https://uc.exagram.test/uc/t")
		expect(frame).toHaveAttribute("sandbox", "allow-scripts")
		expect(bodyToken).toHaveBeenCalledWith({ artifactId: "a1" })
	})

	it("sends a refused address to sign in, to come back here afterwards", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(404, "Artifact unavailable"))
		renderSignedOut("/artifacts/a1?panel=history")
		await waitFor(() =>
			expect(screen.getByTestId("where")).toHaveTextContent("/signin from=/artifacts/a1?panel=history"),
		)
	})

	it("shows any other failure instead of bouncing", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(503, "Try again shortly"))
		renderSignedOut("/artifacts/a1")
		expect(await screen.findByRole("alert")).toHaveTextContent("Try again shortly")
		expect(screen.queryByTestId("where")).not.toBeInTheDocument()
	})

	it("sends every address that is not a file's to sign in", async () => {
		const get = vi.spyOn(apiClient.artifacts, "get")
		renderSignedOut("/projects?x=1")
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/signin from=/projects?x=1"))
		expect(get).not.toHaveBeenCalled()
	})

	it("renders the page itself with the file it is given", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifactFixture({ access: "view", generalAccess: "anyone" }))
		vi.spyOn(apiClient.revisions, "text").mockResolvedValue({ revisionId: "r3", mime: "text/markdown", text: "Hi" })
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<MemoryRouter initialEntries={["/artifacts/a1"]}>
					<SignedOutArtifactPage artifactId="a1" />
				</MemoryRouter>
			</QueryClientProvider>,
		)
		expect(await screen.findByRole("heading", { name: "Board pack" })).toBeInTheDocument()
	})

	it("asks a stranger for the password, then reads the file once it is right", async () => {
		const get = vi
			.spyOn(apiClient.artifacts, "get")
			.mockRejectedValueOnce(new ApiError(403, "Artifact unavailable", "PASSWORD_REQUIRED"))
			.mockResolvedValue(artifactFixture({ access: "view", generalAccess: "anyone", visibleRevisionId: "r3" }))
		vi.spyOn(apiClient.revisions, "text").mockResolvedValue({
			revisionId: "r3",
			mime: "text/markdown",
			text: "Numbers first.",
		})
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)

		renderSignedOut("/artifacts/a1")
		expect(await screen.findByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()
		expect(screen.queryByText("Board pack")).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument()
		expect(screen.queryByTestId("where")).not.toBeInTheDocument()

		await userEvent.setup().type(screen.getByLabelText("Password"), "right-one{Enter}")
		expect(await screen.findByText("Numbers first.")).toBeInTheDocument()
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "right-one" })
		expect(get).toHaveBeenCalledTimes(2)
		expect(screen.getByRole("heading", { name: "Board pack" })).toBeInTheDocument()
	})

	it("tells a stranger the link has expired instead of sending them to sign in", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(410, "Artifact unavailable", "ANYONE_EXPIRED"))
		renderSignedOut("/artifacts/a1")
		expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument()
		expect(screen.getByText("Ask the owner for a new one.")).toBeInTheDocument()
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
		expect(screen.queryByTestId("where")).not.toBeInTheDocument()
	})
})
