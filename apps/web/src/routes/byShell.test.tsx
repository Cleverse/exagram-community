import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ByShell, mobileScreenPath, resolveMobileScreen } from "./byShell"

import { currentShell, syncShellAttribute, useShell } from "@/components/mobile/shell"
import { mockViewport } from "@/test/mobile"

const Desktop = ({ scope }: { scope: string }) => <div>desktop {scope}</div>
const Mobile = ({ scope }: { scope: string }) => <div>mobile {scope}</div>

const modules = {
	[mobileScreenPath("library/LibraryScreen")]: () => Promise.resolve({ default: Mobile as never }),
}

afterEach(() => vi.restoreAllMocks())

describe("useShell", () => {
	it("reads the breakpoint and follows the window across it", () => {
		const viewport = mockViewport(1280)
		const Probe = () => <div>{useShell()}</div>
		render(<Probe />)
		expect(screen.getByText("desktop")).toBeInTheDocument()
		act(() => viewport.resize(390))
		expect(screen.getByText("mobile")).toBeInTheDocument()
	})

	it("keeps data-shell on <html> in step, so the desktop minimum width stays off a phone", () => {
		const viewport = mockViewport(390)
		const stop = syncShellAttribute()
		expect(document.documentElement.dataset.shell).toBe("mobile")
		viewport.resize(1024)
		expect(document.documentElement.dataset.shell).toBe("desktop")
		expect(currentShell()).toBe("desktop")
		stop()
	})
})

describe("ByShell", () => {
	it("finds a mobile screen by its <area>/<Name>, and nothing for a screen with no file", () => {
		expect(resolveMobileScreen("library/LibraryScreen", modules)).not.toBeNull()
		expect(resolveMobileScreen("project/ProjectPage", modules)).toBeNull()
	})

	it("draws the desktop screen on a desktop window", () => {
		mockViewport(1280)
		render(<ByShell desktop={Desktop} mobile="library/LibraryScreen" props={{ scope: "all" }} modules={modules} />)
		expect(screen.getByText("desktop all")).toBeInTheDocument()
	})

	it("draws the mobile screen with the same props on a phone", async () => {
		mockViewport(390)
		render(<ByShell desktop={Desktop} mobile="library/LibraryScreen" props={{ scope: "mine" }} modules={modules} />)
		expect(await screen.findByText("mobile mine")).toBeInTheDocument()
	})

	it("keeps the desktop screen on a phone until the mobile file exists", () => {
		mockViewport(390)
		render(<ByShell desktop={Desktop} mobile="project/ProjectPage" props={{ scope: "p" }} modules={modules} />)
		expect(screen.getByText("desktop p")).toBeInTheDocument()
	})
})
