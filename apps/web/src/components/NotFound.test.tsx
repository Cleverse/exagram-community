import { ACCESS_REQUEST_NOTE_MAX } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NotFound } from "./NotFound"

import { apiClient } from "@/config/apiClient"
import { REQUEST_SENT } from "@/features/access-requests/RequestAccess"

const A = "00000000-0000-4000-8000-00000000000a"

const renderNotFound = (props: Parameters<typeof NotFound>[0]) =>
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<MemoryRouter>
				<NotFound {...props} />
			</MemoryRouter>
		</QueryClientProvider>,
	)

afterEach(() => vi.restoreAllMocks())

describe("NotFound", () => {
	it("offers Request access on a refused file without asking the server anything", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch")
		const create = vi.spyOn(apiClient.accessRequests, "create")
		renderNotFound({ what: "file", artifactId: A })
		expect(screen.getByRole("heading", { name: "This file isn't available" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument()
		expect(create).not.toHaveBeenCalled()
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("offers nothing to request on a page that is not a file", () => {
		renderNotFound({ what: "folder" })
		expect(screen.queryByRole("button", { name: "Request access" })).not.toBeInTheDocument()
	})

	it("sends the note and then says only that the request was sent", async () => {
		const create = vi.spyOn(apiClient.accessRequests, "create").mockResolvedValue({ sent: true })
		renderNotFound({ what: "file", artifactId: A })
		await userEvent.click(screen.getByRole("button", { name: "Request access" }))
		await userEvent.type(screen.getByRole("textbox", { name: "Note for the owner" }), "  For the Q3 review  ")
		await userEvent.click(screen.getByRole("button", { name: "Send request" }))
		expect(create).toHaveBeenCalledWith({ artifactId: A, note: "For the Q3 review" })
		expect(await screen.findByRole("status")).toHaveTextContent(REQUEST_SENT)
		expect(screen.queryByRole("button", { name: "Request access" })).not.toBeInTheDocument()
	})

	it("sends no note when none was written", async () => {
		const create = vi.spyOn(apiClient.accessRequests, "create").mockResolvedValue({ sent: true })
		renderNotFound({ what: "file", artifactId: A })
		await userEvent.click(screen.getByRole("button", { name: "Request access" }))
		await userEvent.click(screen.getByRole("button", { name: "Send request" }))
		expect(create).toHaveBeenCalledWith({ artifactId: A })
		expect(await screen.findByText(REQUEST_SENT)).toBeInTheDocument()
	})

	it("stops the note at the server's limit", async () => {
		renderNotFound({ what: "file", artifactId: A })
		await userEvent.click(screen.getByRole("button", { name: "Request access" }))
		const note = screen.getByRole("textbox", { name: "Note for the owner" })
		expect(note).toHaveAttribute("maxLength", String(ACCESS_REQUEST_NOTE_MAX))
		expect(note).toHaveAttribute("placeholder", "Add a note for the owner (optional)")
		await userEvent.click(note)
		await userEvent.paste("x".repeat(ACCESS_REQUEST_NOTE_MAX + 5))
		expect(note).toHaveValue("x".repeat(ACCESS_REQUEST_NOTE_MAX))
		expect(screen.getByText(`${ACCESS_REQUEST_NOTE_MAX}/${ACCESS_REQUEST_NOTE_MAX}`)).toBeInTheDocument()
	})
})
