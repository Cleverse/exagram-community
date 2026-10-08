import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Link } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSheet } from "./context"
import { indexSheets, type SheetLoader } from "./registry"
import { Sheet } from "./Sheet"
import { type SheetKind } from "./types"

import { recordingSheets, renderMobile } from "@/test/mobile"

const Opener = () => {
	const sheet = useSheet()
	return (
		<>
			<button type="button" onClick={() => sheet.open("file", { artifactId: "a1" })}>
				Open file
			</button>
			<button
				type="button"
				onClick={() => {
					sheet.open("file", { artifactId: "a1" })
					sheet.push("share", { target: { kind: "artifact", id: "a1" } })
				}}
			>
				Open share
			</button>
			<Link to="/elsewhere">Elsewhere</Link>
		</>
	)
}

afterEach(() => vi.restoreAllMocks())

describe("SheetProvider", () => {
	it("opens a drawer by kind with its params, titled by the drawer", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />)
		await user.click(screen.getByRole("button", { name: "Open file" }))
		const dialog = await screen.findByRole("dialog", { name: "file" })
		expect(dialog).toHaveTextContent('{"artifactId":"a1"}')
		expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()
	})

	it("steps into a sub-level with Back, and Back returns to the level before", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />)
		await user.click(screen.getByRole("button", { name: "Open share" }))
		await screen.findByRole("dialog", { name: "share" })
		await user.click(screen.getByRole("button", { name: "Back" }))
		expect(await screen.findByRole("dialog", { name: "file" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()
	})

	it("closes from ×, the scrim and Escape, and gives focus back to the opener", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />)
		const opener = screen.getByRole("button", { name: "Open file" })

		await user.click(opener)
		await user.click(await screen.findByRole("button", { name: "Close" }))
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(opener).toHaveFocus()

		await user.click(opener)
		await screen.findByRole("button", { name: "Close" })
		await user.click(screen.getByTestId("sheet-scrim"))
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

		await user.click(opener)
		await screen.findByRole("button", { name: "Close" })
		await user.keyboard("{Escape}")
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("plays the close animation before unmounting when motion is allowed", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		renderMobile(<Opener />, { reducedMotion: false })
		await user.click(screen.getByRole("button", { name: "Open file" }))
		await user.click(await screen.findByRole("button", { name: "Close" }))
		expect(screen.getByRole("dialog")).toBeInTheDocument()
		act(() => {
			vi.advanceTimersByTime(220)
		})
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		vi.useRealTimers()
	})

	it("closes when the drawer navigates to another screen", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />)
		await user.click(screen.getByRole("button", { name: "Open file" }))
		await screen.findByRole("dialog")
		await user.click(screen.getByRole("link", { name: "Elsewhere" }))
		expect(screen.getByTestId("where")).toHaveTextContent("/elsewhere")
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it("closes on the browser's Back and keeps the screen, from any level", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />, { at: "/?tab=mine" })
		await user.click(screen.getByRole("button", { name: "Open share" }))
		await screen.findByRole("dialog", { name: "share" })
		act(() => window.history.back())
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(screen.getByTestId("where")).toHaveTextContent("/?tab=mine")
		expect(screen.getByRole("button", { name: "Open share" })).toHaveFocus()
	})

	it("gives its history entry back when closed another way, so Back then leaves the screen", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />)
		const before = window.history.state as unknown
		await user.click(screen.getByRole("button", { name: "Open file" }))
		await screen.findByRole("dialog", { name: "file" })
		expect(window.history.state).not.toEqual(before)
		await user.click(screen.getByRole("button", { name: "Close" }))
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
		expect(window.history.state).toEqual(before)
	})

	it("closes when its header is dragged down past 90px, fading the scrim as it goes", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />)
		await user.click(screen.getByRole("button", { name: "Open file" }))
		const title = await screen.findByText("file")
		fireEvent.pointerDown(title, { clientY: 100, button: 0 })
		fireEvent.pointerMove(window, { clientY: 300 })
		expect(screen.getByRole("dialog")).toHaveStyle({ transform: "translateY(200px)" })
		expect(screen.getByTestId("sheet-scrim")).toHaveStyle({ opacity: "0.5" })
		fireEvent.pointerUp(window)
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("springs back when let go short of 90px", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		renderMobile(<Opener />, { reducedMotion: false })
		await user.click(screen.getByRole("button", { name: "Open file" }))
		const title = await screen.findByText("file")
		fireEvent.pointerDown(title, { clientY: 100, button: 0 })
		fireEvent.pointerMove(window, { clientY: 180 })
		act(() => {
			vi.advanceTimersByTime(1000)
		})
		fireEvent.pointerUp(window)
		const dialog = screen.getByRole("dialog")
		expect(dialog.style.transform).toBe("")
		expect(dialog.style.transition).toContain("260ms")
		expect(screen.getByTestId("sheet-scrim").style.opacity).toBe("")
		vi.useRealTimers()
	})

	it("closes on a quick flick short of 90px", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		renderMobile(<Opener />, { reducedMotion: false })
		await user.click(screen.getByRole("button", { name: "Open file" }))
		const title = await screen.findByText("file")
		fireEvent.pointerDown(title, { clientY: 100, button: 0 })
		act(() => {
			vi.advanceTimersByTime(80)
		})
		fireEvent.pointerMove(window, { clientY: 150 })
		fireEvent.pointerUp(window)
		expect(screen.getByRole("dialog")).toHaveStyle({ transform: "translateY(100%)" })
		act(() => {
			vi.advanceTimersByTime(200)
		})
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		vi.useRealTimers()
	})

	it("does not close on a 6px twitch, however fast", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		renderMobile(<Opener />, { reducedMotion: false })
		await user.click(screen.getByRole("button", { name: "Open file" }))
		const title = await screen.findByText("file")
		fireEvent.pointerDown(title, { clientY: 100, button: 0 })
		fireEvent.pointerMove(window, { clientY: 106 })
		fireEvent.pointerUp(window)
		expect(screen.getByRole("dialog").style.transform).toBe("")
		vi.useRealTimers()
	})

	it("slides out over 200ms after a long drag when motion is allowed", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		renderMobile(<Opener />, { reducedMotion: false })
		await user.click(screen.getByRole("button", { name: "Open file" }))
		const title = await screen.findByText("file")
		fireEvent.pointerDown(title, { clientY: 100, button: 0 })
		fireEvent.pointerMove(window, { clientY: 260 })
		fireEvent.pointerUp(window)
		expect(screen.getByRole("dialog")).toHaveStyle({ transform: "translateY(100%)" })
		act(() => {
			vi.advanceTimersByTime(200)
		})
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		vi.useRealTimers()
	})

	it("does not start a drag from a button in the header", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />)
		await user.click(screen.getByRole("button", { name: "Open share" }))
		const back = await screen.findByRole("button", { name: "Back" })
		fireEvent.pointerDown(back, { clientY: 100, button: 0 })
		fireEvent.pointerMove(window, { clientY: 400 })
		fireEvent.pointerUp(window)
		expect(screen.getByRole("dialog", { name: "share" }).style.transform).toBe("")
	})

	it("keeps Tab and Shift+Tab inside the open drawer", async () => {
		const user = userEvent.setup()
		const sheets = new Map<SheetKind, SheetLoader>([
			[
				"file",
				() =>
					Promise.resolve({
						default: (() => (
							<Sheet title="Spec">
								<button type="button">Pin</button>
								<button type="button">Delete</button>
							</Sheet>
						)) as never,
					}),
			],
		])
		renderMobile(<Opener />, { sheets })
		await user.click(screen.getByRole("button", { name: "Open file" }))
		await screen.findByRole("button", { name: "Pin" })
		await user.tab()
		expect(screen.getByRole("button", { name: "Close" })).toHaveFocus()
		await user.tab()
		await user.tab()
		expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus()
		await user.tab()
		expect(screen.getByRole("button", { name: "Close" })).toHaveFocus()
		await user.tab({ shift: true })
		expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus()
	})

	it("says a drawer is not available yet when no module provides its kind", async () => {
		const user = userEvent.setup()
		renderMobile(<Opener />, { sheets: new Map() })
		await user.click(screen.getByRole("button", { name: "Open file" }))
		expect(await screen.findByRole("dialog", { name: "Not available here yet" })).toBeInTheDocument()
	})
})

describe("indexSheets", () => {
	const load: SheetLoader = () => Promise.resolve({ default: () => null })

	it("keys each drawer module by the kind in its file name", () => {
		const index = indexSheets({
			"/src/features/artifact/sheets/file.sheet.mobile.tsx": load,
			"/src/features/grants/sheets/share.sheet.mobile.tsx": load,
		})
		expect([...index.keys()].sort()).toEqual<SheetKind[]>(["file", "share"])
	})

	it("refuses a file named for no kind, and two files for one kind", () => {
		expect(() => indexSheets({ "/src/features/x/sheets/nope.sheet.mobile.tsx": load })).toThrow(/names no drawer/)
		expect(() =>
			indexSheets({
				"/src/features/a/sheets/file.sheet.mobile.tsx": load,
				"/src/features/b/sheets/file.sheet.mobile.tsx": load,
			}),
		).toThrow(/Two drawers/)
	})

	it("covers every kind in the recording set used by screen tests", () => {
		expect(recordingSheets().size).toBeGreaterThan(0)
	})
})
