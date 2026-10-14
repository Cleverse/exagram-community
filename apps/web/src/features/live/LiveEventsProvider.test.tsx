import { ApiError, type LiveEvent } from "@exagram/api-client"
import { QueryClient, QueryClientProvider, QueryObserver, type QueryKey } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	HIDDEN_GRACE_MS,
	LIBRARY_DEBOUNCE_MS,
	LiveEventsProvider,
	QUIET_MARGIN_MS,
	retryDelay,
	RETRY_MAX_MS,
	STABLE_MS,
	STALL_MS,
	type Subscribe,
	useLiveEvent,
	useLiveStatus,
} from "./LiveEventsProvider"

const A = "00000000-0000-4000-8000-00000000000a"
const ev = (topic: LiveEvent["topic"], artifactId: string | null = A): LiveEvent => ({ topic, artifactId })
/** An opening `resync` from a workspace that has not changed since long before this page began loading. */
const QUIET_OPENING: LiveEvent = { topic: "resync", artifactId: null, quietMs: 1_000_000_000 }

/** One fake SSE stream: `emit` pushes an event, `end` closes it as the server or the LB would. */
const fakeStream = (signal: AbortSignal) => {
	const queue: LiveEvent[] = []
	let ended = false
	let wake: (() => void) | null = null
	const nudge = () => {
		wake?.()
		wake = null
	}
	signal.addEventListener("abort", nudge)
	async function* iterate(): AsyncGenerator<LiveEvent> {
		for (;;) {
			if (signal.aborted) throw new DOMException("aborted", "AbortError")
			const next = queue.shift()
			if (next) {
				yield next
				continue
			}
			if (ended) return
			await new Promise<void>((resolve) => (wake = resolve))
		}
	}
	return {
		signal,
		iterable: iterate(),
		emit: (event: LiveEvent) => {
			queue.push(event)
			nudge()
		},
		end: () => {
			ended = true
			nudge()
		},
	}
}

type Stream = ReturnType<typeof fakeStream>

let hidden = false
const setHidden = (next: boolean) => {
	hidden = next
	document.dispatchEvent(new Event("visibilitychange"))
}

const Status = () => <span data-testid="status">{useLiveStatus()}</span>

const setup = (subscribe?: Subscribe, keepOpenWhenHidden = false) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const invalidate = vi.spyOn(queryClient, "invalidateQueries")
	const streams: Stream[] = []
	const fake: Subscribe =
		subscribe ??
		((signal) => {
			const stream = fakeStream(signal)
			streams.push(stream)
			return Promise.resolve(stream.iterable)
		})
	const subscribeSpy = vi.fn(fake)
	const heard: LiveEvent[] = []
	const Listener = () => {
		useLiveEvent((event) => heard.push(event))
		return null
	}
	render(
		<QueryClientProvider client={queryClient}>
			<LiveEventsProvider subscribe={subscribeSpy} random={() => 0} keepOpenWhenHidden={keepOpenWhenHidden}>
				<Status />
				<Listener />
			</LiveEventsProvider>
		</QueryClientProvider>,
	)
	const keys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey as QueryKey)
	const count = (key: QueryKey) =>
		keys().filter((candidate) => JSON.stringify(candidate) === JSON.stringify(key)).length
	return { queryClient, invalidate, streams, subscribe: subscribeSpy, heard, keys, count }
}

/** Lets the provider's loop and React catch up with what the fake stream did. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0))

beforeEach(() => {
	vi.useFakeTimers()
	hidden = false
	Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe("LiveEventsProvider", () => {
	it("invalidates the keys each topic names, and tells listeners after", async () => {
		const live = setup()
		await settle()
		expect(live.subscribe).toHaveBeenCalledTimes(1)

		live.streams[0]?.emit(ev("comments"))
		await settle()
		expect(live.keys()).toEqual([["comments", "list", A]])
		expect(screen.getByTestId("status")).toHaveTextContent("live")
		expect(live.heard).toEqual([ev("comments")])

		live.invalidate.mockClear()
		live.streams[0]?.emit(ev("current"))
		await settle()
		expect(live.keys()).toEqual([
			["artifacts", "get", A],
			["revisions", "list", A],
			["revisions", "text", A],
			["revisions", "bodyToken", A],
			["revisions", "previewToken", A],
			["artifacts", "list"],
		])
	})

	it("never refetches a body someone is reading; a cached one nobody shows is marked stale", async () => {
		const live = setup()
		const onScreen: QueryKey = ["revisions", "text", A, "r1"]
		const cached: QueryKey = ["revisions", "text", A, "r0"]
		const read = vi.fn(() => Promise.resolve({ revisionId: "r1" }))
		live.queryClient.setQueryData(cached, { revisionId: "r0" })
		const observer = new QueryObserver(live.queryClient, { queryKey: onScreen, queryFn: read, staleTime: 0 })
		const unsubscribe = observer.subscribe(() => undefined)
		await settle()
		expect(read).toHaveBeenCalledTimes(1)

		live.streams[0]?.emit(ev("current"))
		await settle()
		expect(read).toHaveBeenCalledTimes(1)
		expect(live.queryClient.getQueryState(onScreen)?.isInvalidated).toBe(false)
		expect(live.queryClient.getQueryState(cached)?.isInvalidated).toBe(true)
		unsubscribe()
	})

	it("refetches the Library at most once a second, however many events arrive", async () => {
		const live = setup()
		await settle()
		for (let index = 0; index < 20; index += 1) live.streams[0]?.emit(ev("artifact"))
		await settle()
		// The first goes at once; the rest wait for the window.
		expect(live.count(["artifacts", "list"])).toBe(1)
		expect(live.count(["artifacts", "get", A])).toBe(20)

		await act(() => vi.advanceTimersByTimeAsync(LIBRARY_DEBOUNCE_MS - 1))
		expect(live.count(["artifacts", "list"])).toBe(1)
		await act(() => vi.advanceTimersByTimeAsync(1))
		expect(live.count(["artifacts", "list"])).toBe(2)
		expect(live.count(["artifacts", "search"])).toBe(2)

		await act(() => vi.advanceTimersByTimeAsync(LIBRARY_DEBOUNCE_MS * 5))
		expect(live.count(["artifacts", "list"])).toBe(2)
	})

	it("ignores the very first stream's opening resync when the workspace has been quiet since before the page loaded", async () => {
		const live = setup()
		await settle()
		live.streams[0]?.emit(QUIET_OPENING)
		await settle()
		expect(live.keys()).toEqual([])
		expect(screen.getByTestId("status")).toHaveTextContent("live")
	})

	it("honours the first stream's opening resync when it carries no quietMs (an api that does not send it)", async () => {
		const live = setup()
		await settle()
		live.streams[0]?.emit(ev("resync", null))
		await settle()
		expect(live.keys()).toEqual(
			expect.arrayContaining([
				["artifacts", "get"],
				["approvals", "pending"],
			]),
		)
	})

	it("honours the first stream's opening resync when the quiet began after the page started loading", async () => {
		vi.spyOn(performance, "now").mockReturnValue(5_000)
		const live = setup()
		await settle()
		// Quiet for 7 s on a page loading for 5 s: inside the 2 s margin, so a change may have landed mid-load.
		live.streams[0]?.emit({ topic: "resync", artifactId: null, quietMs: 5_000 + QUIET_MARGIN_MS })
		await settle()
		expect(live.keys()).toEqual(
			expect.arrayContaining([
				["artifacts", "get"],
				["approvals", "pending"],
			]),
		)
	})

	it("skips the first stream's opening resync once the quiet predates the page load by more than the margin", async () => {
		vi.spyOn(performance, "now").mockReturnValue(5_000)
		const live = setup()
		await settle()
		live.streams[0]?.emit({ topic: "resync", artifactId: null, quietMs: 5_000 + QUIET_MARGIN_MS + 1 })
		await settle()
		expect(live.keys()).toEqual([])
		// Skipped outright, as the quiet opening above is: listeners do not hear it either.
		expect(live.heard).toEqual([])
	})

	it("honours a later resync on that same first stream (a mid-stream LISTEN reconnect)", async () => {
		const live = setup()
		await settle()
		live.streams[0]?.emit(QUIET_OPENING)
		await settle()
		expect(live.keys()).toEqual([])

		live.streams[0]?.emit(ev("resync", null))
		await settle()
		expect(live.keys()).toEqual(
			expect.arrayContaining([
				["artifacts", "get"],
				["revisions", "list"],
				["approvals", "pending"],
				["comments", "list"],
				["grants", "access"],
			]),
		)
	})

	it("honours the resync on the first connect after a failed attempt", async () => {
		let calls = 0
		const streams: Stream[] = []
		const subscribe: Subscribe = (signal) => {
			calls += 1
			if (calls === 1) return Promise.reject(new ApiError(503, "unavailable"))
			const stream = fakeStream(signal)
			streams.push(stream)
			return Promise.resolve(stream.iterable)
		}
		const live = setup(subscribe)
		await settle()
		expect(live.subscribe).toHaveBeenCalledTimes(1)

		await act(() => vi.advanceTimersByTimeAsync(retryDelay(0, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(2)

		// However quiet the workspace, the gap means this opening resync counts.
		streams[0]?.emit(QUIET_OPENING)
		await settle()
		expect(live.keys()).toEqual(
			expect.arrayContaining([
				["artifacts", "get"],
				["revisions", "list"],
			]),
		)
	})

	it("reconnects when the stream ends and resyncs every live key", async () => {
		const live = setup()
		await settle()
		live.streams[0]?.emit(QUIET_OPENING)
		await settle()
		// The very first stream's opening resync is not invalidated (already covered above).
		expect(live.keys()).toEqual([])
		live.streams[0]?.end()
		await settle()
		expect(screen.getByTestId("status")).toHaveTextContent("down")

		await act(() => vi.advanceTimersByTimeAsync(retryDelay(0, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(2)
		live.invalidate.mockClear()
		live.streams[1]?.emit(ev("resync", null))
		await settle()
		expect(live.keys()).toEqual(
			expect.arrayContaining([
				["artifacts", "get"],
				["revisions", "list"],
				["approvals", "pending"],
				["comments", "list"],
				["grants", "access"],
			]),
		)
		expect(screen.getByTestId("status")).toHaveTextContent("live")
	})

	it("backs off 1 s, 2 s, 4 s … up to 30 s while the stream is unavailable", async () => {
		const live = setup(() => Promise.reject(new ApiError(503, "unavailable")))
		await settle()
		expect(live.subscribe).toHaveBeenCalledTimes(1)
		for (const [attempt, total] of [
			[0, 2],
			[1, 3],
			[2, 4],
		] as const) {
			await act(() => vi.advanceTimersByTimeAsync(retryDelay(attempt, () => 0) - 1))
			expect(live.subscribe).toHaveBeenCalledTimes(total - 1)
			await act(() => vi.advanceTimersByTimeAsync(1))
			expect(live.subscribe).toHaveBeenCalledTimes(total)
		}
		expect(retryDelay(10, () => 1)).toBe(RETRY_MAX_MS)
		expect(retryDelay(0, () => 1)).toBe(1_300)
		expect(screen.getByTestId("status")).toHaveTextContent("down")
	})

	it("over the cap (429) it waits the longest before asking again, and stays silent", async () => {
		const live = setup(() => Promise.reject(new ApiError(429, "too many")))
		await settle()
		await act(() => vi.advanceTimersByTimeAsync(RETRY_MAX_MS - 1))
		expect(live.subscribe).toHaveBeenCalledTimes(1)
		await act(() => vi.advanceTimersByTimeAsync(1))
		expect(live.subscribe).toHaveBeenCalledTimes(2)
		expect(screen.getByTestId("status")).toHaveTextContent("down")
	})

	it("closes the stream once the tab has been hidden 30 s, holds none while hidden, and reopens when shown", async () => {
		const live = setup()
		await settle()
		live.streams[0]?.emit(QUIET_OPENING)
		await settle()

		act(() => setHidden(true))
		await act(() => vi.advanceTimersByTimeAsync(HIDDEN_GRACE_MS - 1))
		expect(live.streams[0]?.signal.aborted).toBe(false)
		await act(() => vi.advanceTimersByTimeAsync(1))
		expect(live.streams[0]?.signal.aborted).toBe(true)
		expect(screen.getByTestId("status")).toHaveTextContent("down")
		await act(() => vi.advanceTimersByTimeAsync(RETRY_MAX_MS * 2))
		expect(live.subscribe).toHaveBeenCalledTimes(1)

		act(() => setHidden(false))
		await settle()
		expect(live.subscribe).toHaveBeenCalledTimes(2)
		expect(live.streams[1]?.signal.aborted).toBe(false)
		// The gap means this stream's opening resync counts, however quiet the workspace.
		live.streams[1]?.emit(QUIET_OPENING)
		await settle()
		expect(live.count(["approvals", "pending"])).toBe(1)
	})

	it("inside a Mac app that notifies, keeps the stream open while hidden, and reconnects while hidden", async () => {
		const live = setup(undefined, true)
		await settle()
		live.streams[0]?.emit(QUIET_OPENING)
		await settle()

		act(() => setHidden(true))
		// Past the grace, with the server's pings keeping the stall timer quiet.
		for (let step = 0; step < 4; step += 1) {
			await act(() => vi.advanceTimersByTimeAsync(HIDDEN_GRACE_MS))
			live.streams[0]?.emit(ev("ping", null))
			await settle()
		}
		expect(live.streams[0]?.signal.aborted).toBe(false)
		expect(screen.getByTestId("status")).toHaveTextContent("live")
		expect(live.subscribe).toHaveBeenCalledTimes(1)

		// A stream the server ends while the window is closed comes back after the usual backoff, still hidden.
		live.streams[0]?.end()
		await settle()
		expect(screen.getByTestId("status")).toHaveTextContent("down")
		await act(() => vi.advanceTimersByTimeAsync(retryDelay(0, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(2)
		expect(live.streams[1]?.signal.aborted).toBe(false)
	})

	it("opens its stream while hidden inside a Mac app that notifies (the window closed at launch)", async () => {
		hidden = true
		const live = setup(undefined, true)
		await settle()
		expect(live.subscribe).toHaveBeenCalledTimes(1)
		expect(live.streams[0]?.signal.aborted).toBe(false)
	})

	it("keeps the stream through a quick switch away, with no reconnect and no resync", async () => {
		const live = setup()
		await settle()
		live.streams[0]?.emit(QUIET_OPENING)
		await settle()

		act(() => setHidden(true))
		await act(() => vi.advanceTimersByTimeAsync(HIDDEN_GRACE_MS / 2))
		act(() => setHidden(false))
		await act(() => vi.advanceTimersByTimeAsync(HIDDEN_GRACE_MS))
		expect(live.streams[0]?.signal.aborted).toBe(false)
		expect(live.subscribe).toHaveBeenCalledTimes(1)
		expect(live.keys()).toEqual([])
	})

	it("drops a stream silent for 60 s (a ping keeps it), goes down, and reconnects", async () => {
		const live = setup()
		await settle()
		live.streams[0]?.emit(QUIET_OPENING)
		await settle()
		await act(() => vi.advanceTimersByTimeAsync(STALL_MS - 10_000))
		live.streams[0]?.emit(ev("ping", null))
		await settle()
		// A ping invalidates nothing, but proves the stream alive.
		expect(live.keys()).toEqual([])
		expect(screen.getByTestId("status")).toHaveTextContent("live")

		await act(() => vi.advanceTimersByTimeAsync(STALL_MS - 1))
		expect(live.streams[0]?.signal.aborted).toBe(false)
		await act(() => vi.advanceTimersByTimeAsync(1))
		expect(live.streams[0]?.signal.aborted).toBe(true)
		expect(screen.getByTestId("status")).toHaveTextContent("down")

		await act(() => vi.advanceTimersByTimeAsync(retryDelay(0, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(2)
	})

	it("keeps backing off when streams open with resync and end at once, as a draining api's do", async () => {
		const live = setup()
		await settle()
		const drain = async (index: number) => {
			live.streams[index]?.emit(ev("resync", null))
			live.streams[index]?.end()
			await settle()
		}
		await drain(0)
		for (const [attempt, total] of [
			[0, 2],
			[1, 3],
			[2, 4],
		] as const) {
			await act(() => vi.advanceTimersByTimeAsync(retryDelay(attempt, () => 0) - 1))
			expect(live.subscribe).toHaveBeenCalledTimes(total - 1)
			await act(() => vi.advanceTimersByTimeAsync(1))
			expect(live.subscribe).toHaveBeenCalledTimes(total)
			await drain(total - 1)
		}
	})

	it("resets the backoff after a real event, or a stream that stayed open 10 s", async () => {
		const live = setup()
		await settle()
		// Two quick failures push the wait up to 2 s.
		live.streams[0]?.end()
		await settle()
		await act(() => vi.advanceTimersByTimeAsync(retryDelay(0, () => 0)))
		live.streams[1]?.end()
		await settle()
		await act(() => vi.advanceTimersByTimeAsync(retryDelay(1, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(3)

		// A real event: the next wait is back to 1 s.
		live.streams[2]?.emit(ev("comments"))
		live.streams[2]?.end()
		await settle()
		await act(() => vi.advanceTimersByTimeAsync(retryDelay(0, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(4)

		// Fail once more (wait now 2 s), then stay open 10 s with no real event: back to 1 s.
		live.streams[3]?.end()
		await settle()
		await act(() => vi.advanceTimersByTimeAsync(retryDelay(1, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(5)
		await act(() => vi.advanceTimersByTimeAsync(STABLE_MS))
		live.streams[4]?.end()
		await settle()
		await act(() => vi.advanceTimersByTimeAsync(retryDelay(0, () => 0)))
		expect(live.subscribe).toHaveBeenCalledTimes(6)
	})

	it("debounces the approvals inbox and redacted text too; one Artifact's keys go at once", async () => {
		const live = setup()
		await settle()
		for (let index = 0; index < 10; index += 1) {
			live.streams[0]?.emit(ev("revisions"))
			live.streams[0]?.emit(ev("redaction"))
		}
		await settle()
		expect(live.count(["revisions", "list", A])).toBe(10)
		expect(live.count(["redaction", "artifact", A])).toBe(10)
		expect(live.count(["approvals", "pending"])).toBe(1)
		expect(live.count(["redaction", "redactedText"])).toBe(0)

		await act(() => vi.advanceTimersByTimeAsync(LIBRARY_DEBOUNCE_MS))
		expect(live.count(["approvals", "pending"])).toBe(2)
		expect(live.count(["redaction", "redactedText"])).toBe(1)
	})
})
