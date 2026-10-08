import { ApiError, COMMUNITY_CAPABILITIES } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", async (importOriginal) => ({
	...(await importOriginal<typeof EnvModule>()),
	API_ORIGIN: "https://api.example.test",
}))

import { JoinPage } from "./JoinPage"

import type * as EnvModule from "@/config/env"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"

const TOKEN = "T".repeat(43)
const preview = { email: "invited@example.com", role: "member" as const, workspaceName: "Acme" }

const renderJoin = (options: { google?: boolean; search?: string; providersFail?: boolean } = {}) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	// An invite-only install that already has its Admin: sign-up is closed everywhere but here.
	if (!options.providersFail) {
		queryClient.setQueryData(QueryKeys.auth.providers(), {
			google: options.google ?? false,
			signUp: false,
			aiEdit: true,
			edition: "cloud",
			capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit: true },
		})
	}
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[`/join/${TOKEN}${options.search ?? ""}`]}>
				<Routes>
					<Route path="/join/:token" element={<JoinPage />} />
					<Route path="/" element={<p>All artifacts</p>} />
					<Route path="/join/pending" element={<p>Pending page</p>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

describe("JoinPage", () => {
	afterEach(() => vi.restoreAllMocks())

	it("signs up with the Invite's email, locked, and the token, on an install whose sign-up is closed", async () => {
		const previewInvite = vi.spyOn(apiClient.auth, "previewInvite").mockResolvedValue(preview)
		const signUp = vi.spyOn(apiClient.auth, "signUp").mockResolvedValue({} as never)
		const user = userEvent.setup()
		renderJoin()

		// Community's title shows while the Invite loads, so wait for the form before the title.
		const email = await screen.findByLabelText("Email")
		expect(screen.getByRole("heading", { name: edition.copy.joinTitle("Acme") })).toBeInTheDocument()
		expect(previewInvite).toHaveBeenCalledWith({ token: TOKEN })
		expect(email).toHaveValue("invited@example.com")
		expect(email).toHaveAttribute("readonly")
		await user.type(screen.getByLabelText("Name"), "Invited Person")
		await user.type(screen.getByLabelText("Password"), "correct horse battery")
		await user.click(screen.getByRole("button", { name: "Join" }))

		await waitFor(() =>
			expect(signUp).toHaveBeenCalledWith({
				email: "invited@example.com",
				name: "Invited Person",
				password: "correct horse battery",
				inviteToken: TOKEN,
			}),
		)
		expect(await screen.findByText("All artifacts")).toBeInTheDocument()
	})

	it("sends Google only the token when Google is on, and offers no password form", async () => {
		vi.spyOn(apiClient.auth, "previewInvite").mockResolvedValue(preview)
		renderJoin({ google: true })
		expect(await screen.findByRole("link", { name: "Continue with Google" })).toHaveAttribute(
			"href",
			`https://api.example.test/v1/auth/google/start?inviteToken=${TOKEN}`,
		)
		expect(screen.getByText("Continue with Google using invited@example.com.")).toBeInTheDocument()
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
	})

	it("says a dead Join Link is no longer valid", async () => {
		vi.spyOn(apiClient.auth, "previewInvite").mockRejectedValue(new ApiError(404, "This invite is no longer valid"))
		renderJoin()
		expect(await screen.findByRole("alert")).toHaveTextContent("This invite is no longer valid.")
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
	})

	it("shows a rate-limited preview's own message with a retry, not 'no longer valid', and recovers on retry", async () => {
		const previewInvite = vi
			.spyOn(apiClient.auth, "previewInvite")
			.mockRejectedValueOnce(new ApiError(429, "Link previews are limited to 30 calls per minute."))
			.mockResolvedValue(preview)
		const user = userEvent.setup()
		renderJoin()

		const alert = await screen.findByRole("alert")
		expect(alert).toHaveTextContent("Link previews are limited to 30 calls per minute.")
		expect(alert).not.toHaveTextContent("no longer valid")
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Try again" }))

		expect(await screen.findByRole("heading", { name: edition.copy.joinTitle("Acme") })).toBeInTheDocument()
		expect(previewInvite).toHaveBeenCalledTimes(2)
	})

	it("shows a retryable error, not the password form, when the providers query fails, and recovers on retry", async () => {
		vi.spyOn(apiClient.auth, "previewInvite").mockResolvedValue(preview)
		const providers = vi
			.spyOn(apiClient.auth, "providers")
			.mockRejectedValueOnce(new ApiError(503, "Service unavailable."))
			.mockResolvedValue({
				google: true,
				signUp: false,
				aiEdit: true,
				edition: "cloud",
				capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit: true },
			})
		const user = userEvent.setup()
		renderJoin({ providersFail: true })

		expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable.")
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Try again" }))

		expect(await screen.findByRole("link", { name: "Continue with Google" })).toBeInTheDocument()
		expect(providers).toHaveBeenCalledTimes(2)
	})

	it("offers no retry for a dead Join Link", async () => {
		vi.spyOn(apiClient.auth, "previewInvite").mockRejectedValue(new ApiError(404, "This invite is no longer valid"))
		renderJoin()

		await screen.findByRole("alert")
		expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
	})

	it("shows a failed Join sign-up's message and stays on the page", async () => {
		vi.spyOn(apiClient.auth, "previewInvite").mockResolvedValue(preview)
		vi.spyOn(apiClient.auth, "signUp").mockRejectedValue(new ApiError(429, "Sign-up is limited to 5 calls per minute."))
		const user = userEvent.setup()
		renderJoin()

		await user.type(await screen.findByLabelText("Name"), "Invited Person")
		await user.type(screen.getByLabelText("Password"), "correct horse battery")
		await user.click(screen.getByRole("button", { name: "Join" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Sign-up is limited to 5 calls per minute.")
		expect(screen.queryByText("All artifacts")).not.toBeInTheDocument()
	})

	it("lands on the pending page when a Member's Invite opens a Join Request", async () => {
		vi.spyOn(apiClient.auth, "previewInvite").mockResolvedValue(preview)
		vi.spyOn(apiClient.auth, "signUp").mockRejectedValue(
			new ApiError(403, "Waiting for an admin to approve you.", "JOIN_PENDING"),
		)
		const user = userEvent.setup()
		renderJoin()

		await user.type(await screen.findByLabelText("Name"), "Invited Person")
		await user.type(screen.getByLabelText("Password"), "correct horse battery")
		await user.click(screen.getByRole("button", { name: "Join" }))
		expect(await screen.findByText("Pending page")).toBeInTheDocument()
	})

	it("explains a Google account whose email is not the Invite's", async () => {
		vi.spyOn(apiClient.auth, "previewInvite").mockResolvedValue(preview)
		renderJoin({ google: true, search: "?error=google_invite_mismatch" })
		expect(await screen.findByRole("alert")).toHaveTextContent("This invite is for a different email address.")
	})
})
