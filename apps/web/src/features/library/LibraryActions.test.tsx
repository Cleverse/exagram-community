import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { LibraryActionsProvider } from "@/features/library/LibraryActions"
import { paneFrame, SEARCH_LAYER } from "@/features/library/paneLayout"
import { useRegisterSearch } from "@/features/library/useLibraryActions"

const renderAt = (path: string, children: React.ReactNode = null) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.projects.list(), [])
	queryClient.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [])
	queryClient.setQueryData(QueryKeys.auth.me(), { id: "u1" })
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<MemoryRouter initialEntries={[path]}>
					<LibraryActionsProvider>{children}</LibraryActionsProvider>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

const ListSearch = ({ onOpen }: { onOpen: () => void }) => {
	useRegisterSearch(onOpen)
	return null
}

describe("LibraryActionsProvider shortcuts", () => {
	afterEach(() => vi.restoreAllMocks())

	it("opens search across everything on ⌘K or Ctrl+P where no list has its own", () => {
		renderAt("/activity")
		const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true })
		act(() => void document.dispatchEvent(event))
		expect(event.defaultPrevented).toBe(true)
		expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument()

		fireEvent.keyDown(document, { key: "Escape" })
		expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull()
		fireEvent.keyDown(document, { key: "p", ctrlKey: true })
		expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument()
	})

	it("opens search for the Mac app's new-tab button, which presses ⌘K and reads whether it was taken", () => {
		renderAt("/activity")
		// The event apps/macos `Bridge.searchShortcutJS` dispatches.
		const press = () =>
			new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true, cancelable: true })
		const first = press()
		act(() => void document.dispatchEvent(first))
		expect(first.defaultPrevented).toBe(true)
		expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument()
		// Pressed again with search already up: still taken, so the app does not open a stray tab.
		const again = press()
		act(() => void document.dispatchEvent(again))
		expect(again.defaultPrevented).toBe(true)
		expect(screen.getAllByRole("dialog", { name: "Search" })).toHaveLength(1)
	})

	it("draws search over an Artifact's full view, and leaves Present alone", () => {
		renderAt("/artifacts/a1", <div data-presenting />)
		fireEvent.keyDown(document, { key: "k", metaKey: true })
		expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull()

		cleanup()
		renderAt("/artifacts/a1")
		fireEvent.keyDown(document, { key: "k", metaKey: true })
		const scrim = screen.getByRole("dialog", { name: "Search" }).parentElement
		expect(Number(scrim?.style.zIndex)).toBe(SEARCH_LAYER)
		expect(SEARCH_LAYER).toBeGreaterThan(Number(paneFrame(true).zIndex))
		expect(SEARCH_LAYER).toBeLessThan(300)
	})

	it("hands the shortcut to the list's own search when one is registered", () => {
		const onOpen = vi.fn()
		renderAt("/", <ListSearch onOpen={onOpen} />)
		fireEvent.keyDown(document, { key: "p", metaKey: true })
		expect(onOpen).toHaveBeenCalledOnce()
		expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull()
	})

	it("copies the page's address on ⌘L", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
		renderAt("/activity")
		fireEvent.keyDown(document, { key: "l", metaKey: true })
		expect(writeText).toHaveBeenCalledWith(window.location.href)
		await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Link copied"))
	})
})
