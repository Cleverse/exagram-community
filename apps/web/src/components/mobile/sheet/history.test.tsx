import { QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createBrowserRouter, Link, RouterProvider, useNavigate } from "react-router"
import { beforeEach, describe, expect, it } from "vitest"

import { useSheet } from "./context"
import { type SheetLoader } from "./registry"
import { Sheet } from "./Sheet"
import { SheetProvider } from "./SheetProvider"
import { type SheetKind } from "./types"

import { mockViewport, testQueryClient, Where } from "@/test/mobile"

/** A drawer that navigates, as File actions → Open does. */
const sheets = new Map<SheetKind, SheetLoader>([
	[
		"file",
		() =>
			Promise.resolve({
				default: (() => (
					<Sheet title="Spec">
						<Link to="/artifacts/a1">Open</Link>
					</Sheet>
				)) as never,
			}),
	],
	[
		"project",
		() =>
			Promise.resolve({
				default: (() => {
					const sheet = useSheet()
					const navigate = useNavigate()
					return (
						<Sheet title="Project">
							{/* As deleting the file or Project on screen does: leave it without keeping it in history. */}
							<button type="button" onClick={() => sheet.closeThen(() => void navigate("/", { replace: true }))}>
								Delete
							</button>
						</Sheet>
					)
				}) as never,
			}),
	],
])

const Screen = () => {
	const sheet = useSheet()
	return (
		<>
			<button type="button" onClick={() => sheet.open("file", { artifactId: "a1" })}>
				More
			</button>
			<button type="button" onClick={() => sheet.open("project", { projectId: "p1" })}>
				Project actions
			</button>
			<Link to="/projects/p1">Go to project</Link>
			<Where />
		</>
	)
}

/** The real browser router, so drawer entries and screen entries share `window.history` as they do in the app. */
const renderInBrowserRouter = () => {
	mockViewport(390)
	const router = createBrowserRouter([
		{
			element: (
				<SheetProvider sheets={sheets}>
					<Screen />
				</SheetProvider>
			),
			children: [{ path: "*", element: null }],
		},
	])
	return render(
		<QueryClientProvider client={testQueryClient()}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	window.history.replaceState(null, "", "/")
})

describe("drawer history entries", () => {
	it("Back closes the drawer and stays on the screen", async () => {
		const user = userEvent.setup()
		renderInBrowserRouter()
		await user.click(screen.getByRole("button", { name: "More" }))
		await screen.findByRole("dialog", { name: "Spec" })
		act(() => window.history.back())
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/)
	})

	it("after a drawer navigates, Back returns to the screen it opened on in one step, and Forward comes back", async () => {
		const user = userEvent.setup()
		renderInBrowserRouter()
		await user.click(screen.getByRole("button", { name: "More" }))
		await user.click(await screen.findByRole("link", { name: "Open" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1")
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

		act(() => window.history.back())
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		// The drawer's leftover entry was stepped over, not left as a second Back that changes nothing.
		expect(window.history.state).not.toHaveProperty("mobileLayer")

		act(() => window.history.forward())
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/artifacts/a1"))
	})

	it("a drawer that leaves with a replace lands on the screen's entry, so Back skips the screen it left", async () => {
		window.history.replaceState(null, "", "/activity")
		const user = userEvent.setup()
		renderInBrowserRouter()
		await user.click(screen.getByRole("link", { name: "Go to project" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/projects/p1")
		await user.click(screen.getByRole("button", { name: "Project actions" }))
		await user.click(await screen.findByRole("button", { name: "Delete" }))
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/))
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		act(() => window.history.back())
		await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/activity"))
	})
})
