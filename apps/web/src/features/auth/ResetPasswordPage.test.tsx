import { ApiError } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ResetPasswordPage } from "./ResetPasswordPage"

import { apiClient } from "@/config/apiClient"
import { edition } from "@/edition/edition"

const TOKEN = "R".repeat(43)

const renderReset = () => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[`/reset/${TOKEN}`]}>
				<Routes>
					<Route path="/reset/:token" element={<ResetPasswordPage />} />
					<Route path="/" element={<p>All artifacts</p>} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

describe("ResetPasswordPage", () => {
	afterEach(() => vi.restoreAllMocks())

	it("sets a new password for the link's account, locked email shown, then lands signed in on All artifacts", async () => {
		const preview = vi
			.spyOn(apiClient.auth, "previewResetLink")
			.mockResolvedValue({ email: "member@example.com", workspaceName: "Acme" })
		const reset = vi.spyOn(apiClient.auth, "resetPassword").mockResolvedValue({} as never)
		const user = userEvent.setup()
		renderReset()

		expect(await screen.findByText(edition.copy.resetLine("Acme"))).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument()
		expect(preview).toHaveBeenCalledWith({ token: TOKEN })
		const email = screen.getByLabelText("Email")
		expect(email).toHaveValue("member@example.com")
		expect(email).toHaveAttribute("readonly")
		expect(screen.getByLabelText("New password")).toHaveAttribute("minLength", "12")
		await user.type(screen.getByLabelText("New password"), "correct horse battery")
		await user.click(screen.getByRole("button", { name: "Set password" }))

		await waitFor(() => expect(reset).toHaveBeenCalledWith({ token: TOKEN, password: "correct horse battery" }))
		expect(await screen.findByText("All artifacts")).toBeInTheDocument()
	})

	it("says a dead link is no longer valid, with no form", async () => {
		vi.spyOn(apiClient.auth, "previewResetLink").mockRejectedValue(
			new ApiError(404, "This reset link is no longer valid"),
		)
		renderReset()

		expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is no longer valid.")
		expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin")
	})

	it("shows a rate-limited preview's own message with a retry, not 'no longer valid', and recovers on retry", async () => {
		const preview = vi
			.spyOn(apiClient.auth, "previewResetLink")
			.mockRejectedValueOnce(new ApiError(429, "Link previews are limited to 30 calls per minute."))
			.mockResolvedValue({ email: "member@example.com", workspaceName: "Acme" })
		const user = userEvent.setup()
		renderReset()

		const alert = await screen.findByRole("alert")
		expect(alert).toHaveTextContent("Link previews are limited to 30 calls per minute.")
		expect(alert).not.toHaveTextContent("no longer valid")
		expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Try again" }))

		expect(await screen.findByLabelText("New password")).toBeInTheDocument()
		expect(preview).toHaveBeenCalledTimes(2)
	})

	it("offers no retry for a dead link", async () => {
		vi.spyOn(apiClient.auth, "previewResetLink").mockRejectedValue(
			new ApiError(404, "This reset link is no longer valid"),
		)
		renderReset()

		await screen.findByRole("alert")
		expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
	})

	it("shows a failed reset and stays on the page", async () => {
		vi.spyOn(apiClient.auth, "previewResetLink").mockResolvedValue({
			email: "member@example.com",
			workspaceName: "Acme",
		})
		vi.spyOn(apiClient.auth, "resetPassword").mockRejectedValue(new Error("Could not set the new password"))
		const user = userEvent.setup()
		renderReset()

		await user.type(await screen.findByLabelText("New password"), "correct horse battery")
		await user.click(screen.getByRole("button", { name: "Set password" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not set the new password")
		expect(screen.queryByText("All artifacts")).not.toBeInTheDocument()
	})
})
