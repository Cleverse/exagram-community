import { ApiError, type AuthProviders } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest"

vi.mock("@/config/env", async (importOriginal) => ({
	...(await importOriginal<typeof EnvModule>()),
	API_ORIGIN: "https://api.example.test",
}))

import { SignInPage } from "./SignInPage"

import type * as EnvModule from "@/config/env"
import type { InitialEntry } from "react-router"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { authProviders } from "@/test/authProviders"
import { asCommunityEmailSignIn, asCommunityMacApp, asCommunityProviders } from "@/test/edition"

const FILE_ID = "44444444-4444-4444-8444-444444444444"

const renderSignIn = (options: { providers?: Partial<AuthProviders>; initialEntries?: InitialEntry[] } = {}) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.providers(), authProviders(options.providers))
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter initialEntries={options.initialEntries ?? ["/signin"]}>
					<Routes>
						<Route path="/signin" element={<SignInPage />} />
						<Route path="/" element={<p>All artifacts</p>} />
						<Route path="/artifacts/:id" element={<p>File page</p>} />
						<Route path="/join/pending" element={<p>Pending page</p>} />
						<Route path="/join/declined" element={<p>Declined page</p>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		),
	}
}

const fromFile = (query = ""): InitialEntry => ({
	pathname: "/signin",
	state: { from: `/artifacts/${FILE_ID}${query}` },
})

describe("SignInPage", () => {
	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	describe("social sign-in", () => {
		it("shows Google with the configured API origin and no password toggle on an install without mail", () => {
			renderSignIn({ providers: { google: true } })
			expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
				"href",
				"https://api.example.test/v1/auth/google/start",
			)
			expect(screen.queryByRole("link", { name: "Continue with Apple" })).not.toBeInTheDocument()
			expect(screen.queryByRole("button", { name: /instead/ })).not.toBeInTheDocument()
		})

		it("hides Apple until the install offers it, then links its start route", () => {
			const { unmount } = renderSignIn({ providers: { google: true, apple: false } })
			expect(screen.queryByRole("link", { name: "Continue with Apple" })).not.toBeInTheDocument()
			unmount()
			renderSignIn({ providers: { google: true, apple: true } })
			expect(screen.getByRole("link", { name: "Continue with Apple" })).toHaveAttribute(
				"href",
				"https://api.example.test/v1/auth/apple/start",
			)
		})

		it("draws the OR divider only when a social button sits above the email block", () => {
			const { unmount } = renderSignIn()
			expect(screen.queryByText("OR")).not.toBeInTheDocument()
			unmount()
			const google = renderSignIn({ providers: { google: true } })
			expect(screen.getByText("OR")).toBeInTheDocument()
			google.unmount()
			renderSignIn({ providers: { apple: true } })
			expect(screen.getByText("OR")).toBeInTheDocument()
		})

		it("hides Google when the provider is unavailable", () => {
			renderSignIn()
			expect(screen.queryByRole("link", { name: "Continue with Google" })).not.toBeInTheDocument()
		})

		it("sends the file the guard remembered to Google as returnTo, without the query", () => {
			renderSignIn({ providers: { google: true }, initialEntries: [fromFile("?invited=1")] })
			expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
				"href",
				`https://api.example.test/v1/auth/google/start?returnTo=%2Fartifacts%2F${FILE_ID}`,
			)
		})

		it("sends the remembered file to Apple as returnTo too", () => {
			renderSignIn({ providers: { apple: true }, initialEntries: [fromFile()] })
			expect(screen.getByRole("link", { name: "Continue with Apple" })).toHaveAttribute(
				"href",
				`https://api.example.test/v1/auth/apple/start?returnTo=%2Fartifacts%2F${FILE_ID}`,
			)
		})

		it.each([
			["apple_denied", "Apple sign-in was cancelled."],
			["apple_no_email", "Apple did not share an email address. Try again and share your email or use Hide My Email."],
			[
				"apple_account_exists",
				"An account with that email already exists. Sign in another way, then connect Apple from the account menu.",
			],
			["apple_rate_limited", "Too many Apple sign-in attempts. Wait a minute and try again."],
		])("says what went wrong when Apple sends the person back with %s", (code, message) => {
			renderSignIn({ providers: { apple: true }, initialEntries: [`/signin?error=${code}`] })
			expect(screen.getByRole("alert")).toHaveTextContent(message)
		})
	})

	describe("the page around the card", () => {
		it("offers Create one only while the install takes sign-ups", () => {
			const { unmount } = renderSignIn()
			expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/signup")
			unmount()
			renderSignIn({ providers: { signUp: false } })
			expect(screen.queryByRole("link", { name: "Create one" })).not.toBeInTheDocument()
			expect(screen.queryByText(/No account yet/)).not.toBeInTheDocument()
		})

		it("offers no desktop app download or server footer where the edition ships no Mac app", () => {
			asCommunityMacApp()
			const { container } = renderSignIn({ providers: { google: true, emailCode: true } })
			expect(screen.queryByRole("link", { name: "Download desktop app" })).not.toBeInTheDocument()
			expect(container.querySelector("main")?.children).toHaveLength(1)
		})

		it("shows no server footer in a Mac app where the edition ships none", () => {
			asCommunityMacApp()
			;(window as { exagram?: unknown }).exagram = Object.freeze({
				platform: "macos",
				bridgeVersion: 4,
				chooseServer: vi.fn(),
			})
			onTestFinished(() => {
				delete (window as { exagram?: unknown }).exagram
			})
			renderSignIn()
			expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument()
		})

		it("names the page for screen readers with a heading that sighted people do not see", () => {
			renderSignIn({ providers: { google: true } })
			expect(screen.getByRole("heading", { name: "Sign in to Exagram" })).toHaveClass("sr-only")
		})

		it("shows the heading when only a password signs in, since no provider button heads the card", () => {
			asCommunityProviders()
			renderSignIn()
			expect(screen.getByRole("heading", { name: "Sign in to Exagram" })).not.toHaveClass("sr-only")
		})

		it.skipIf(edition.followsProviders)("keeps the heading hidden even when only a password signs in", () => {
			renderSignIn()
			expect(screen.getByRole("heading", { name: "Sign in to Exagram" })).toHaveClass("sr-only")
		})

		it("says how to get a reset link under the password form wherever the edition has words for it", () => {
			renderSignIn()
			const help = edition.copy.forgotPassword
			if (help === null) expect(screen.queryByText(/Forgot your password/)).not.toBeInTheDocument()
			else expect(screen.getByText(help)).toBeInTheDocument()
		})

		it("says who the invite was for when the remembered path came from an invite email", () => {
			renderSignIn({ providers: { google: true }, initialEntries: [fromFile("?invited=1")] })
			expect(screen.getByText(/You were invited to a file on Exagram/)).toBeInTheDocument()
		})

		it("shows no invite line without ?invited=1 or for a path that is not a file", () => {
			const { unmount } = renderSignIn({ providers: { google: true }, initialEntries: [fromFile()] })
			expect(screen.queryByText(/You were invited/)).not.toBeInTheDocument()
			unmount()
			renderSignIn({
				providers: { google: true },
				initialEntries: [{ pathname: "/signin", state: { from: "/settings?invited=1" } }],
			})
			expect(screen.queryByText(/You were invited/)).not.toBeInTheDocument()
			expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
				"href",
				"https://api.example.test/v1/auth/google/start",
			)
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
				const { unmount } = renderSignIn({ initialEntries: [`/signin?error=${code}`] })
				expect(screen.getByRole("alert")).toHaveTextContent(message)
				unmount()
			}

			renderSignIn({ initialEntries: ["/signin?error=unknown"] })
			expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		})
	})

	describe("password sign-in", () => {
		it("shows the password form directly, labelled, when the install has no mail", () => {
			renderSignIn({ providers: { google: true } })
			expect(screen.getByLabelText("Email")).toBeInTheDocument()
			expect(screen.getByLabelText("Password")).toBeInTheDocument()
			expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
			expect(screen.queryByRole("button", { name: "Continue with email" })).not.toBeInTheDocument()
		})

		it("returns to the remembered path, query included, after password sign-in", async () => {
			const user = userEvent.setup()
			const signIn = vi.spyOn(apiClient.auth, "signIn").mockResolvedValueOnce({} as never)
			renderSignIn({ initialEntries: [fromFile("?invited=1")] })
			await user.type(screen.getByLabelText("Email"), "a@example.com")
			await user.type(screen.getByLabelText("Password"), "password123")
			await user.click(screen.getByRole("button", { name: "Sign in" }))
			expect(await screen.findByText("File page")).toBeInTheDocument()
			expect(signIn).toHaveBeenCalledWith({ email: "a@example.com", password: "password123" })
		})

		it.each([
			["JOIN_PENDING", "Pending page"],
			["JOIN_DECLINED", "Declined page"],
		])("lands on the Join Request page when sign-in answers %s", async (code, page) => {
			const user = userEvent.setup()
			vi.spyOn(apiClient.auth, "signIn").mockRejectedValueOnce(new ApiError(403, "Not yet.", code))
			renderSignIn()
			await user.type(screen.getByLabelText("Email"), "friend@example.com")
			await user.type(screen.getByLabelText("Password"), "password123")
			await user.click(screen.getByRole("button", { name: "Sign in" }))
			expect(await screen.findByText(page)).toBeInTheDocument()
		})

		it("shows a new password error after a Google redirect error", async () => {
			vi.spyOn(apiClient.auth, "signIn").mockRejectedValueOnce(new Error("Password signin failed."))
			const user = userEvent.setup()
			renderSignIn({ initialEntries: ["/signin?error=google_failed"] })
			expect(screen.getByRole("alert")).toHaveTextContent("Google sign-in failed. Try again.")
			await user.type(screen.getByLabelText("Email"), "person@example.test")
			await user.type(screen.getByLabelText("Password"), "longpassword123")
			await user.click(screen.getByRole("button", { name: "Sign in" }))
			await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Password signin failed."))
		})
	})

	describe("without Email Sign-in", () => {
		it("shows the password form and no email code, even where the install sends mail", () => {
			asCommunityEmailSignIn()
			renderSignIn({ providers: { google: true, emailCode: true } })
			expect(screen.getByLabelText("Password")).toBeInTheDocument()
			expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
			expect(screen.queryByRole("button", { name: "Continue with email" })).not.toBeInTheDocument()
			expect(screen.queryByRole("button", { name: /instead/ })).not.toBeInTheDocument()
		})

		it("names no invite line for an emailed invite when Google and Apple are off", () => {
			asCommunityEmailSignIn()
			renderSignIn({
				providers: { emailCode: true },
				initialEntries: [{ pathname: "/signin", state: { from: `/projects/${FILE_ID}?invited=1` } }],
			})
			expect(screen.queryByText(/You were invited/)).not.toBeInTheDocument()
		})
	})
})
