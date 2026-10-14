import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render as renderBare, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WebUpdateReloader } from "./WebUpdateReloader"
import {
	isNewerBuildAvailable,
	markReloadForUpdate,
	parseWebVersion,
	requestWebUpdateCheck,
	UPDATE_NOTICE,
	UPDATE_TOAST,
	WEB_DEPLOYED_RECHECK_MS,
	WEB_UPDATE_CHECK_INTERVAL_MS,
	WEB_UPDATE_COUNTDOWN_SECONDS,
	WEB_UPDATE_UPLOAD_SETTLE_MS,
} from "./webVersion"

import type { ReactElement } from "react"

import { ToastProvider } from "@/components/Toast"
import { UPLOAD_MUTATION_KEY } from "@/features/library/upload"

let client = new QueryClient()
const render = (ui: ReactElement) =>
	renderBare(
		<QueryClientProvider client={client}>
			<ToastProvider>{ui}</ToastProvider>
		</QueryClientProvider>,
	)

/** The current toast's text, or null when none shows. */
const toastText = () => screen.queryByRole("status")?.textContent ?? null

/** The update card (countdown or banner), or null. */
const notice = () => screen.queryByRole("region", { name: "Exagram update" })

/** Advances by `ms` inside `act`, letting promises and timers settle. */
const advance = async (ms: number) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

/** Runs the whole countdown. */
const pastCountdown = () => advance(WEB_UPDATE_COUNTDOWN_SECONDS * 1_000)

/** Starts an upload-keyed mutation in `client`; it runs until the returned function is called. */
const startUpload = async () => {
	let finish = () => {}
	const done = new Promise<void>((resolve) => {
		finish = resolve
	})
	await act(async () => {
		void client
			.getMutationCache()
			.build(client, { mutationKey: UPLOAD_MUTATION_KEY, mutationFn: () => done })
			.execute(undefined)
		await vi.advanceTimersByTimeAsync(0)
	})
	return async () => {
		await act(async () => {
			finish()
			await vi.advanceTimersByTimeAsync(0)
		})
	}
}

const serve = (body: unknown) =>
	vi.fn(() => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 })))

/** Runs the interval and lets the fetch and `response.json()` settle. */
const tick = () => advance(WEB_UPDATE_CHECK_INTERVAL_MS)

describe("webVersion", () => {
	it("reads the id out of version.json and nothing else", () => {
		expect(parseWebVersion({ buildId: " abc " })).toBe("abc")
		expect(parseWebVersion({ buildId: "" })).toBeNull()
		expect(parseWebVersion([])).toBeNull()
		expect(parseWebVersion(null)).toBeNull()
	})

	it("only counts two real, different ids as newer", () => {
		expect(isNewerBuildAvailable("a", "b")).toBe(true)
		expect(isNewerBuildAvailable("a", "a")).toBe(false)
		expect(isNewerBuildAvailable(null, "b")).toBe(false)
		expect(isNewerBuildAvailable("a", null)).toBe(false)
	})
})

describe("WebUpdateReloader", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		client = new QueryClient()
		sessionStorage.clear()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		document.body.innerHTML = ""
	})

	it("counts down once the served build differs, then reloads", async () => {
		const fetchMock = serve({ buildId: "new" })
		vi.stubGlobal("fetch", fetchMock)
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		expect(notice()).toBeNull()

		await tick()

		expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/version\.json\?_=\d+$/), expect.anything())
		expect(notice()?.textContent).toContain(UPDATE_NOTICE.countdown(WEB_UPDATE_COUNTDOWN_SECONDS))
		await advance(3_000)
		expect(notice()?.textContent).toContain(UPDATE_NOTICE.countdown(WEB_UPDATE_COUNTDOWN_SECONDS - 3))
		expect(reload).not.toHaveBeenCalled()

		await pastCountdown()
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("reloads at once on Reload now", async () => {
		vi.stubGlobal("fetch", serve({ buildId: "new" }))
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		await tick()

		fireEvent.click(screen.getByRole("button", { name: "Reload now" }))
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("on Cancel, keeps a banner instead and never reloads on its own", async () => {
		vi.stubGlobal("fetch", serve({ buildId: "new" }))
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		await tick()

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(notice()?.textContent).toContain(UPDATE_NOTICE.banner)

		// Still there a long while later, hidden and shown again included.
		await advance(WEB_UPDATE_CHECK_INTERVAL_MS * 3)
		await act(async () => {
			vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
			document.dispatchEvent(new Event("visibilitychange"))
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(reload).not.toHaveBeenCalled()
		expect(notice()?.textContent).toContain(UPDATE_NOTICE.banner)

		fireEvent.click(screen.getByRole("button", { name: "Reload" }))
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("holds the banner's Reload while an upload is in flight", async () => {
		vi.stubGlobal("fetch", serve({ buildId: "new" }))
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		await tick()
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

		const finish = await startUpload()
		expect(notice()?.textContent).toContain(UPDATE_NOTICE.bannerUploading)
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reload" }).disabled).toBe(true)

		await finish()
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "Reload" }).disabled).toBe(false)
		expect(reload).not.toHaveBeenCalled()
	})

	it("stays put when the build is the same or the answer is not version.json", async () => {
		const reload = vi.fn()
		vi.stubGlobal("fetch", serve({ buildId: "old" }))
		const { unmount } = render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		await tick()
		unmount()

		vi.stubGlobal("fetch", serve("<!doctype html><html></html>"))
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		await tick()
		expect(notice()).toBeNull()
		expect(reload).not.toHaveBeenCalled()
	})

	it("checks at once when the live feed reports a deploy, and again once the edges have caught up", async () => {
		// The first answer is an edge still on the old build; the recheck sees the new one.
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ buildId: "old" })))
			.mockResolvedValue(new Response(JSON.stringify({ buildId: "new" })))
		vi.stubGlobal("fetch", fetchMock)
		render(<WebUpdateReloader clientBuildId="old" reload={vi.fn()} />)

		await act(async () => {
			requestWebUpdateCheck()
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(notice()).toBeNull()

		await advance(WEB_DEPLOYED_RECHECK_MS)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(notice()).not.toBeNull()
	})

	it("never polls without a build id of its own", async () => {
		const fetchMock = serve({ buildId: "new" })
		vi.stubGlobal("fetch", fetchMock)
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId={null} reload={reload} />)
		await tick()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(reload).not.toHaveBeenCalled()
	})

	it("waits while the reader is typing and counts down once they leave the field", async () => {
		vi.stubGlobal("fetch", serve({ buildId: "new" }))
		const field = document.createElement("textarea")
		document.body.append(field)
		field.focus()
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)

		await tick()
		expect(toastText()).toBe(UPDATE_TOAST.waitingForTyping)
		expect(notice()).toBeNull()

		await act(async () => {
			field.blur()
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(notice()).not.toBeNull()
		await pastCountdown()
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("holds the reload when the reader starts typing during the countdown", async () => {
		vi.stubGlobal("fetch", serve({ buildId: "new" }))
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		await tick()

		const field = document.createElement("input")
		document.body.append(field)
		field.focus()
		await pastCountdown()
		expect(reload).not.toHaveBeenCalled()
		expect(notice()).toBeNull()

		await act(async () => {
			field.blur()
			await vi.advanceTimersByTimeAsync(0)
		})
		await pastCountdown()
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("waits for an upload in flight, even in a hidden tab, and reloads once it has settled", async () => {
		vi.stubGlobal("fetch", serve({ buildId: "new" }))
		const reload = vi.fn()
		const finish = await startUpload()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)

		await tick()
		expect(toastText()).toBe(UPDATE_TOAST.waitingForUpload)
		await act(async () => {
			vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
			document.dispatchEvent(new Event("visibilitychange"))
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(reload).not.toHaveBeenCalled()

		await finish()
		expect(reload).not.toHaveBeenCalled()

		await advance(WEB_UPDATE_UPLOAD_SETTLE_MS)
		// Hidden: nobody would see a countdown, so it reloads without one.
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("stops the countdown when an upload starts, and counts again once it settles", async () => {
		vi.stubGlobal("fetch", serve({ buildId: "new" }))
		const reload = vi.fn()
		render(<WebUpdateReloader clientBuildId="old" reload={reload} />)
		await tick()
		expect(notice()).not.toBeNull()

		const finish = await startUpload()
		expect(notice()).toBeNull()
		await pastCountdown()
		expect(reload).not.toHaveBeenCalled()

		await finish()
		await advance(WEB_UPDATE_UPLOAD_SETTLE_MS)
		expect(notice()?.textContent).toContain(UPDATE_NOTICE.countdown(WEB_UPDATE_COUNTDOWN_SECONDS))
		await pastCountdown()
		expect(reload).toHaveBeenCalledTimes(1)
	})

	it("says it is up to date, naming the release, once after an update reload", () => {
		markReloadForUpdate()
		const { unmount } = render(<WebUpdateReloader clientBuildId="old" reload={vi.fn()} release="0.4.0" />)
		expect(toastText()).toBe(`${UPDATE_TOAST.reloaded} — v0.4.0`)
		unmount()

		render(<WebUpdateReloader clientBuildId="old" reload={vi.fn()} release="0.4.0" />)
		expect(toastText()).toBeNull()
	})

	it("leaves the release out when the build has none", () => {
		markReloadForUpdate()
		render(<WebUpdateReloader clientBuildId="old" reload={vi.fn()} release={null} />)
		expect(toastText()).toBe(UPDATE_TOAST.reloaded)
	})
})
