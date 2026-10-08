import { ApiError, COMMUNITY_CAPABILITIES } from "@exagram/api-client"
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", async (importOriginal) => ({
	...(await importOriginal<typeof EnvModule>()),
	API_ORIGIN: "https://api.example.test",
}))

import { SignInPage } from "./SignInPage"
import { SignUpPage } from "./SignUpPage"
import { renderPage } from "./SignUpPage.harness"

import type * as EnvModule from "@/config/env"

import { apiClient } from "@/config/apiClient"
import { edition } from "@/edition/edition"

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

	it("tells a signed-in person that creating an organization signs them in as a new account", () => {
		renderPage(<SignUpPage />, { signedInAs: "person@example.com" })
		expect(
			screen.getByText(
				"You're signed in as person@example.com. Creating an organization here signs you in as a new account.",
			),
		).toBeInTheDocument()
	})

	it("offers no password form when the sign-up options fail to load, and retries on request", async () => {
		const providers = vi
			.spyOn(apiClient.auth, "providers")
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({
				google: false,
				signUp: true,
				aiEdit: true,
				edition: "cloud",
				capabilities: { ...COMMUNITY_CAPABILITIES, aiEdit: true },
			})
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

	it("asks for a Workspace name only when the edition has Workspace fields", () => {
		renderPage(<SignUpPage />)
		expect(screen.queryByLabelText("Workspace name") !== null).toBe(edition.SignUpWorkspaceFields !== null)
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
		if (edition.SignUpWorkspaceFields) await user.type(screen.getByLabelText("Workspace name"), "Acme")
		await user.click(screen.getByRole("button", { name: "Create account" }))
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Password signup failed."))
		signUp.mockRestore()
	})
})

describe("SignInPage", () => {
	it("offers Create one only while the install takes sign-ups", () => {
		const { unmount } = renderPage(<SignInPage />)
		expect(screen.getByRole("link", { name: "Create one" })).toBeInTheDocument()
		unmount()
		renderPage(<SignInPage />, { signUp: false })
		expect(screen.queryByRole("link", { name: "Create one" })).not.toBeInTheDocument()
		expect(screen.queryByText(/No account yet/)).not.toBeInTheDocument()
	})

	it("labels the credentials and names the submit button", () => {
		renderPage(<SignInPage />)
		expect(screen.getByLabelText("Email")).toBeInTheDocument()
		expect(screen.getByLabelText("Password")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
	})

	it("shows Google with the configured API origin", () => {
		renderPage(<SignInPage />, { google: true })
		expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
			"href",
			"https://api.example.test/v1/auth/google/start",
		)
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
	})

	it("sends the file the guard remembered to Google as returnTo, without the query", () => {
		const id = "44444444-4444-4444-8444-444444444444"
		renderPage(<SignInPage />, {
			google: true,
			initialEntries: [{ pathname: "/signin", state: { from: `/artifacts/${id}?invited=1` } }],
		})
		expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
			"href",
			`https://api.example.test/v1/auth/google/start?returnTo=%2Fartifacts%2F${id}`,
		)
	})

	it("says who the invite was for when the remembered path came from an invite email", () => {
		const id = "44444444-4444-4444-8444-444444444444"
		const { unmount } = renderPage(<SignInPage />, {
			google: true,
			initialEntries: [{ pathname: "/signin", state: { from: `/projects/${id}?invited=1` } }],
		})
		expect(
			screen.getByText(
				"You were invited to a project on Exagram. Sign in with Google using the address the invite was sent to.",
			),
		).toBeInTheDocument()
		unmount()
		renderPage(<SignInPage />, {
			google: true,
			initialEntries: [{ pathname: "/signin", state: { from: `/artifacts/${id}?invited=1` } }],
		})
		expect(screen.getByText(/You were invited to a file on Exagram/)).toBeInTheDocument()
	})

	it("shows no invite line without ?invited=1 and passes no returnTo for other routes", () => {
		const id = "44444444-4444-4444-8444-444444444444"
		renderPage(<SignInPage />, {
			google: true,
			initialEntries: [{ pathname: "/signin", state: { from: `/artifacts/${id}` } }],
		})
		expect(screen.queryByText(/You were invited/)).not.toBeInTheDocument()
		cleanup()
		renderPage(<SignInPage />, {
			google: true,
			initialEntries: [{ pathname: "/signin", state: { from: "/settings?invited=1" } }],
		})
		expect(screen.queryByText(/You were invited/)).not.toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
			"href",
			"https://api.example.test/v1/auth/google/start",
		)
	})

	it("returns to the remembered path, query included, after password sign-in", async () => {
		const user = userEvent.setup()
		const id = "44444444-4444-4444-8444-444444444444"
		const signIn = vi.spyOn(apiClient.auth, "signIn").mockResolvedValueOnce({} as never)
		renderPage(
			<Routes>
				<Route path="/signin" element={<SignInPage />} />
				<Route path="/artifacts/:id" element={<div>File page</div>} />
			</Routes>,
			{ initialEntries: [{ pathname: "/signin", state: { from: `/artifacts/${id}?invited=1` } }] },
		)
		await user.type(screen.getByLabelText("Email"), "a@example.com")
		await user.type(screen.getByLabelText("Password"), "password123")
		await user.click(screen.getByRole("button", { name: "Sign in" }))
		expect(await screen.findByText("File page")).toBeInTheDocument()
		signIn.mockRestore()
	})

	it("lands on the Join Request page when sign-in answers JOIN_PENDING", async () => {
		const user = userEvent.setup()
		const signIn = vi
			.spyOn(apiClient.auth, "signIn")
			.mockRejectedValueOnce(new ApiError(403, "Waiting for an admin to approve you.", "JOIN_PENDING"))
		renderPage(
			<Routes>
				<Route path="/signin" element={<SignInPage />} />
				<Route path="/join/pending" element={<div>Pending page</div>} />
			</Routes>,
			{ initialEntries: ["/signin"] },
		)
		await user.type(screen.getByLabelText("Email"), "friend@example.com")
		await user.type(screen.getByLabelText("Password"), "password123")
		await user.click(screen.getByRole("button", { name: "Sign in" }))
		expect(await screen.findByText("Pending page")).toBeInTheDocument()
		signIn.mockRestore()
	})

	it("reveals password sign-in for an existing unlinked account", async () => {
		const user = userEvent.setup()
		renderPage(<SignInPage />, { google: true })
		await user.click(screen.getByRole("button", { name: "Use email and password" }))
		expect(screen.getByLabelText("Email")).toBeInTheDocument()
		expect(screen.getByLabelText("Password")).toBeInTheDocument()
	})

	it("reveals password sign-in after an account conflict", () => {
		renderPage(<SignInPage />, { google: true, initialEntries: ["/signin?error=account_exists"] })
		expect(screen.getByLabelText("Password")).toBeInTheDocument()
	})

	it("hides Google when the provider is unavailable", () => {
		renderPage(<SignInPage />)
		expect(screen.queryByRole("link", { name: "Continue with Google" })).not.toBeInTheDocument()
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
			const { unmount } = renderPage(<SignInPage />, { initialEntries: [`/signin?error=${code}`] })
			expect(screen.getByRole("alert")).toHaveTextContent(message)
			unmount()
		}

		renderPage(<SignInPage />, { initialEntries: ["/signin?error=unknown"] })
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("shows a new password error after a Google redirect error", async () => {
		const signIn = vi.spyOn(apiClient.auth, "signIn").mockRejectedValueOnce(new Error("Password signin failed."))
		const user = userEvent.setup()
		renderPage(<SignInPage />, { initialEntries: ["/signin?error=account_exists"] })
		await user.type(screen.getByLabelText("Email"), "person@example.test")
		await user.type(screen.getByLabelText("Password"), "longpassword123")
		await user.click(screen.getByRole("button", { name: "Sign in" }))
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Password signin failed."))
		signIn.mockRestore()
	})
})
