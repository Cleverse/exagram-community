import { ApiError } from "@exagram/api-client"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import SignedOutArtifactPageMobile from "./SignedOutArtifactPage.mobile"

import { apiClient } from "@/config/apiClient"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"
import { renderMobile } from "@/test/mobile"

const route = { path: "/artifacts/:artifactId", at: "/artifacts/a1" }

afterEach(() => vi.restoreAllMocks())

describe("SignedOutArtifactPage (mobile)", () => {
	it("reads a file open to anyone with the link signed out, with a Sign in button and no share actions", async () => {
		const artifact = artifactFixture({
			access: "view",
			generalAccess: "anyone",
			orgDomain: null,
			visibleRevisionId: "r3",
		})
		vi.spyOn(apiClient.artifacts, "get").mockResolvedValue(artifact)
		vi.spyOn(apiClient.revisions, "text").mockResolvedValue({
			revisionId: "r3",
			mime: "text/markdown",
			text: "Hello there",
		})
		renderMobile(<SignedOutArtifactPageMobile artifactId="a1" />, route)
		expect(await screen.findByRole("heading", { name: /Board pack/ })).toBeInTheDocument()
		expect(await screen.findByText("Hello there")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin")
		expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument()
	})

	it("sends a refused address to sign in", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(404, "Artifact unavailable"))
		renderMobile(<SignedOutArtifactPageMobile artifactId="a1" />, route)
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/signin"))
	})

	it("asks for the password, then reads the file once it is right", async () => {
		vi.spyOn(apiClient.artifacts, "get")
			.mockRejectedValueOnce(new ApiError(403, "Artifact unavailable", "PASSWORD_REQUIRED"))
			.mockResolvedValue(artifactFixture({ access: "view", generalAccess: "anyone", visibleRevisionId: "r3" }))
		vi.spyOn(apiClient.revisions, "text").mockResolvedValue({
			revisionId: "r3",
			mime: "text/markdown",
			text: "Hello there",
		})
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)
		renderMobile(<SignedOutArtifactPageMobile artifactId="a1" />, route)

		expect(await screen.findByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
		await userEvent.setup().type(screen.getByLabelText("Password"), "right-one{Enter}")
		expect(await screen.findByText("Hello there")).toBeInTheDocument()
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "right-one" })
	})

	it("tells the reader the link has expired instead of sending them to sign in", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(new ApiError(410, "Artifact unavailable", "ANYONE_EXPIRED"))
		renderMobile(<SignedOutArtifactPageMobile artifactId="a1" />, route)
		expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument()
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
	})
})
