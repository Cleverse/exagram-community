import { NO_CAPABILITIES } from "@exagram/api-client"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", async (importOriginal) => ({
	...(await importOriginal<typeof EnvModule>()),
	API_ORIGIN: "https://api.example.test",
}))

import { SignUpPage } from "./SignUpPage"
import { renderPage } from "./SignUpPage.harness"

import type * as EnvModule from "@/config/env"

import { apiClient } from "@/config/apiClient"
import { edition } from "@/edition/edition"
import { authProviders } from "@/test/authProviders"

describe("SignUpPage", () => {
	it("says sign-up is by invitation, with no form, when the install has closed it", () => {
		renderPage(<SignUpPage />, { signUp: false })
		expect(
			screen.getByText("Sign-up on this install is by invitation. Ask your Admin for an invite link."),
		).toBeInTheDocument()
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument()
	})

	it("tells a signed-in person that signing up makes a new account and signs them in as it", () => {
		renderPage(<SignUpPage />, { signedInAs: "person@example.com" })
		expect(
			screen.getByText(
				"You're signed in as person@example.com. Signing up here makes a new account and signs you in as it.",
			),
		).toBeInTheDocument()
	})

	it("says what signing up gives, on the password form and beside Google alike", () => {
		const { unmount } = renderPage(<SignUpPage />)
		expect(screen.getByText(edition.copy.signUpIntro)).toBeInTheDocument()
		unmount()
		renderPage(<SignUpPage />, { google: true })
		expect(screen.getByText(edition.copy.signUpIntro)).toBeInTheDocument()
	})

	it("signs up with name, email and password only, asking for no Workspace name", async () => {
		const signUp = vi.spyOn(apiClient.auth, "signUp").mockResolvedValueOnce({} as never)
		const user = userEvent.setup()
		renderPage(
			<Routes>
				<Route path="/signup" element={<SignUpPage />} />
				<Route path="/" element={<p>Library</p>} />
			</Routes>,
			{ initialEntries: ["/signup"] },
		)
		expect(screen.queryByLabelText(/workspace/i)).not.toBeInTheDocument()
		await user.type(screen.getByLabelText("Name", { exact: true }), "Person")
		await user.type(screen.getByLabelText("Email"), "person@example.test")
		await user.type(screen.getByLabelText("Password"), "longpassword123")
		await user.click(screen.getByRole("button", { name: "Create account" }))
		expect(await screen.findByText("Library")).toBeInTheDocument()
		expect(signUp).toHaveBeenCalledExactlyOnceWith({
			email: "person@example.test",
			name: "Person",
			password: "longpassword123",
		})
		signUp.mockRestore()
	})

	it("offers no password form when the sign-up options fail to load, and retries on request", async () => {
		const providers = vi
			.spyOn(apiClient.auth, "providers")
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(authProviders({ edition: "cloud", capabilities: { ...NO_CAPABILITIES, aiEdit: true } }))
		const user = userEvent.setup()
		renderPage(<SignUpPage />, { providersUnavailable: true })
		const retry = await screen.findByRole("button", { name: "Try again" })
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
		await user.click(retry)
		await waitFor(() => expect(providers).toHaveBeenCalledTimes(2))
		expect(await screen.findByLabelText("Password")).toBeInTheDocument()
		providers.mockRestore()
	})

	it("labels every field the sign-up flow fills", () => {
		renderPage(<SignUpPage />)
		expect(screen.getByLabelText("Name", { exact: true })).toBeInTheDocument()
		expect(screen.getByLabelText("Email")).toBeInTheDocument()
		expect(screen.getByLabelText("Password")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Use email and password instead" })).not.toBeInTheDocument()
	})

	it("offers no way to join an existing Workspace by its ID", () => {
		renderPage(<SignUpPage />)
		expect(screen.queryByLabelText("Workspace ID")).not.toBeInTheDocument()
		expect(screen.queryByRole("radio")).not.toBeInTheDocument()
	})

	it("starts Google sign-up without requiring a workspace choice", () => {
		renderPage(<SignUpPage />, { google: true })
		const url = new URL(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")!)
		expect(url.origin).toBe("https://api.example.test")
		expect(url.searchParams.has("workspaceName")).toBe(false)
		expect(url.searchParams.has("workspaceId")).toBe(false)
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()

		expect(screen.queryByRole("button", { name: "Use email and password instead" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument()
		expect(screen.queryByLabelText("Workspace name")).not.toBeInTheDocument()
	})

	it("shows each known Google error and hides unknown errors", () => {
		const cases = [
			["google_denied", "Google sign-in was cancelled."],
			["google_failed", "Google sign-in failed. Try again."],
			[
				"account_exists",
				"An account with that email already exists. Sign in with your password, then connect Google from the account menu.",
			],
			["google_no_account", "Google could not finish creating your account. Try again from Sign up."],
			["google_invalid_request", "Could not start Google sign-in. Check your details and try again."],
			["google_rate_limited", "Too many Google sign-in attempts. Wait a minute and try again."],
		] as const

		for (const [code, message] of cases) {
			const { unmount } = renderPage(<SignUpPage />, { initialEntries: [`/signup?error=${code}`] })
			expect(screen.getByRole("alert")).toHaveTextContent(message)
			unmount()
		}

		renderPage(<SignUpPage />, { initialEntries: ["/signup?error=unknown"] })
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("shows a new password error after a Google redirect error", async () => {
		const signUp = vi.spyOn(apiClient.auth, "signUp").mockRejectedValueOnce(new Error("Password signup failed."))
		const user = userEvent.setup()
		renderPage(<SignUpPage />, { initialEntries: ["/signup?error=google_no_account"] })
		await user.type(screen.getByLabelText("Name", { exact: true }), "Person")
		await user.type(screen.getByLabelText("Email"), "person@example.test")
		await user.type(screen.getByLabelText("Password"), "longpassword123")
		await user.click(screen.getByRole("button", { name: "Create account" }))
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Password signup failed."))
		signUp.mockRestore()
	})
})
