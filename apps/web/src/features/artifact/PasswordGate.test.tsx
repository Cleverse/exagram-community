import { ApiError } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useArtifact } from "./hooks/useArtifact"
import { ExpiredNotice, GateScreen, PasswordGate, RecipientPreview } from "./PasswordGate"

import { ToastProvider } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"

const wrongPassword = () => new ApiError(403, "This file doesn't exist or you don't have access", "INCORRECT_PASSWORD")
const passwordRequired = () =>
	new ApiError(403, "This file doesn't exist or you don't have access", "PASSWORD_REQUIRED")

const renderGate = (
	ui: React.ReactNode,
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) => {
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>{ui}</ToastProvider>
		</QueryClientProvider>,
	)
	return client
}

/** Asks for the Artifact the way the page under the gate does, so an invalidation has a query to refetch. */
const Page = () => {
	const file = useArtifact("a1")
	return <div>{file.data ? `Reading ${file.data.title}` : <PasswordGate artifactId="a1" />}</div>
}

afterEach(() => vi.restoreAllMocks())

describe("PasswordGate", () => {
	it("shows a lock and a password field and nothing about the file", () => {
		renderGate(
			<GateScreen>
				<PasswordGate artifactId="a1" />
			</GateScreen>,
		)
		expect(screen.getByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()
		expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password")
		expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()
		// Every word on the page: no title, owner, kind or expiry reaches a reader who has not entered the password.
		expect(document.body).toHaveTextContent(
			/^ExagramEnter password to openOpenDon’t have the password\? Ask the person who sent you this link\.$/,
		)
	})

	it("says to enter the password when Open is pressed on an empty field, without asking the server", async () => {
		const unlock = vi.spyOn(apiClient.artifacts, "unlock")
		renderGate(<PasswordGate artifactId="a1" />)
		await userEvent.setup().click(screen.getByRole("button", { name: "Open" }))
		expect(screen.getByRole("alert")).toHaveTextContent("Enter the password.")
		expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true")
		expect(unlock).not.toHaveBeenCalled()
	})

	it("says the password is incorrect, and typing clears the error", async () => {
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockRejectedValue(wrongPassword())
		const user = userEvent.setup()
		renderGate(<PasswordGate artifactId="a1" />)
		await user.type(screen.getByLabelText("Password"), "nope{Enter}")
		expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password. Try again.")
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "nope" })

		await user.type(screen.getByLabelText("Password"), "x")
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "false")
	})

	it("shows a rate limit's own message", async () => {
		vi.spyOn(apiClient.artifacts, "unlock").mockRejectedValue(
			new ApiError(429, "Too many attempts. Wait a minute.", "TOO_MANY"),
		)
		const user = userEvent.setup()
		renderGate(<PasswordGate artifactId="a1" />)
		await user.type(screen.getByLabelText("Password"), "pw{Enter}")
		expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Wait a minute.")
	})

	it("opens the file in its place once the password is right, and says so", async () => {
		const get = vi
			.spyOn(apiClient.artifacts, "get")
			.mockRejectedValueOnce(passwordRequired())
			.mockResolvedValue(artifactFixture({ access: "view", generalAccess: "anyone" }))
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)
		const user = userEvent.setup()
		renderGate(<Page />)
		await user.type(await screen.findByLabelText("Password"), "right-one{Enter}")
		expect(await screen.findByText("Reading Board pack")).toBeInTheDocument()
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "right-one" })
		expect(get).toHaveBeenCalledTimes(2)
		expect(await screen.findByText("Unlocked.")).toBeInTheDocument()
	})

	it("says what to check when the password was right and the file still asks for it", async () => {
		vi.spyOn(apiClient.artifacts, "get").mockRejectedValue(passwordRequired())
		vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)
		const user = userEvent.setup()
		renderGate(<Page />)
		await user.type(await screen.findByLabelText("Password"), "right-one{Enter}")
		expect(await screen.findByRole("alert")).toHaveTextContent("Check that your browser allows cookies")
		expect(screen.getByRole("button", { name: "Open" })).toBeEnabled()
	})

	it("asks the page again when the password has been switched off since", async () => {
		const client = renderGate(<PasswordGate artifactId="a1" />)
		const invalidate = vi.spyOn(client, "invalidateQueries")
		vi.spyOn(apiClient.artifacts, "unlock").mockRejectedValue(
			new ApiError(404, "This file doesn't exist or you don't have access"),
		)
		await userEvent.setup().type(screen.getByLabelText("Password"), "pw{Enter}")
		await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.artifacts.get("a1") }))
	})
})

describe("ExpiredNotice", () => {
	it("tells the reader the link has expired and to ask the owner, with no password field", () => {
		renderGate(
			<GateScreen>
				<ExpiredNotice />
			</GateScreen>,
		)
		expect(screen.getByRole("heading", { name: "This link has expired" })).toBeInTheDocument()
		expect(screen.getByText("Ask the owner for a new one.")).toBeInTheDocument()
		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
	})
})

describe("RecipientPreview", () => {
	it("is the gate over the page, with the Owner's label and Exit, and a right password ends it", async () => {
		const unlock = vi.spyOn(apiClient.artifacts, "unlock").mockResolvedValue(undefined)
		const onExit = vi.fn()
		const user = userEvent.setup()
		renderGate(<RecipientPreview artifactId="a1" onExit={onExit} />)
		const preview = screen.getByRole("dialog", { name: "Recipient preview" })
		expect(preview).toHaveTextContent("Recipient preview")
		expect(screen.getByRole("heading", { name: "Enter password to open" })).toBeInTheDocument()

		await user.type(screen.getByLabelText("Password"), "right-one{Enter}")
		expect(unlock).toHaveBeenCalledWith({ artifactId: "a1", password: "right-one" })
		await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1))
		expect(await screen.findByText("Password works.")).toBeInTheDocument()
	})

	it("shows a wrong password as a recipient would see it", async () => {
		vi.spyOn(apiClient.artifacts, "unlock").mockRejectedValue(wrongPassword())
		const onExit = vi.fn()
		renderGate(<RecipientPreview artifactId="a1" onExit={onExit} />)
		await userEvent.setup().type(screen.getByLabelText("Password"), "nope{Enter}")
		expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password. Try again.")
		expect(onExit).not.toHaveBeenCalled()
	})

	it("leaves with Exit preview and with Escape, and Escape reaches nothing beneath it", async () => {
		const onExit = vi.fn()
		const beneath = vi.fn()
		document.addEventListener("keydown", beneath)
		const user = userEvent.setup()
		renderGate(<RecipientPreview artifactId="a1" onExit={onExit} />)
		await user.click(screen.getByRole("button", { name: "Exit preview" }))
		expect(onExit).toHaveBeenCalledTimes(1)
		await user.keyboard("{Escape}")
		expect(onExit).toHaveBeenCalledTimes(2)
		expect(beneath).not.toHaveBeenCalled()
		document.removeEventListener("keydown", beneath)
	})
})
