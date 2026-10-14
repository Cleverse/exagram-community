import { type LiveEvent, type NotificationList } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type MacBridge, macBridge, macNotifies } from "./macBridge"
import { MacNotifier, NOTIFY_DEBOUNCE_MS } from "./MacNotifier"
import { loadState, saveState, stateKey } from "./notificationPlan"

import { QueryKeys } from "@/config/queryKeys"
import { LiveEventsProvider, type Subscribe } from "@/features/live/LiveEventsProvider"

const USER = "00000000-0000-4000-8000-000000000001"
const ART = "00000000-0000-4000-8000-0000000000a1"
const SERVER = "https://api.example.test"
const WORKSPACE = "00000000-0000-4000-8000-0000000000b1"
const KEY = stateKey(SERVER, USER, WORKSPACE)

/** One open stream the test pushes events into. */
const liveFeed = () => {
	const queue: LiveEvent[] = []
	let wake: (() => void) | null = null
	const subscribe: Subscribe = (signal) => {
		async function* iterate(): AsyncGenerator<LiveEvent> {
			while (!signal.aborted) {
				const next = queue.shift()
				if (next) yield next
				else await new Promise<void>((resolve) => (wake = resolve))
			}
		}
		return Promise.resolve(iterate())
	}
	return {
		subscribe,
		emit: (topic: LiveEvent["topic"]) => {
			queue.push({ topic, artifactId: topic === "resync" ? null : ART })
			wake?.()
			wake = null
		},
	}
}

const memoryStorage = () => {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
	} as unknown as Storage
}

type ListFn = (input?: { since?: Date; after?: string }) => Promise<NotificationList>

const answer = (
	items: NotificationList["items"] = [],
	serverTime = "2026-10-06T10:00:00.000Z",
	next: string | null = null,
): NotificationList => ({ items, serverTime, next }) as unknown as NotificationList

const comment = (id: string, createdAt: string) =>
	({
		id,
		kind: "comment",
		artifactId: ART,
		projectId: null,
		title: "Q3 plan",
		actorName: "Ann",
		createdAt,
	}) as unknown as NotificationList["items"][number]

const setup = ({
	list = vi.fn<ListFn>().mockResolvedValue(answer()),
	storage = memoryStorage(),
	bridge = { platform: "macos", bridgeVersion: 2, notify: vi.fn() } as MacBridge,
}: {
	list?: ReturnType<typeof vi.fn<ListFn>>
	storage?: Storage
	bridge?: MacBridge
} = {}) => {
	const feed = liveFeed()
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), { id: USER, workspaceId: WORKSPACE, name: "Me" })
	const client = { notifications: { list } } as unknown as Parameters<typeof MacNotifier>[0]["client"]
	render(
		<QueryClientProvider client={queryClient}>
			<LiveEventsProvider subscribe={feed.subscribe} random={() => 0} keepOpenWhenHidden={false}>
				<MacNotifier bridge={bridge} client={client} server={SERVER} storage={storage} />
			</LiveEventsProvider>
		</QueryClientProvider>,
	)
	return { feed, list, storage, notify: bridge.notify as ReturnType<typeof vi.fn> }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe("MacNotifier", () => {
	it("on a device's first run asks without since, keeps the server's clock, and posts nothing", async () => {
		const live = setup()
		await advance(NOTIFY_DEBOUNCE_MS - 1)
		expect(live.list).not.toHaveBeenCalled()
		await advance(1)
		expect(live.list).toHaveBeenCalledTimes(1)
		expect(live.list).toHaveBeenCalledWith()
		expect(loadState(live.storage, KEY)).toEqual({
			cursor: "2026-10-06T10:00:00.000Z",
			seen: [],
			floor: "2026-10-06T10:00:00.000Z",
		})
		expect(live.notify).not.toHaveBeenCalled()
	})

	it("keeps a cursor for each Workspace, so another Workspace's cursor does not hold this one's items back", async () => {
		const storage = memoryStorage()
		const other = { cursor: "2026-10-06T12:00:00.000Z", seen: [] }
		saveState(storage, stateKey(SERVER, USER, "00000000-0000-4000-8000-0000000000b2"), other)
		const live = setup({ storage })

		await advance(NOTIFY_DEBOUNCE_MS)

		expect(live.list).toHaveBeenCalledExactlyOnceWith()
		expect(loadState(storage, KEY)?.cursor).toBe("2026-10-06T10:00:00.000Z")
		expect(loadState(storage, stateKey(SERVER, USER, "00000000-0000-4000-8000-0000000000b2"))).toEqual(other)
	})

	it("on a relevant signal asks from two minutes behind the cursor and hands each new item to the app", async () => {
		const storage = memoryStorage()
		saveState(storage, KEY, { cursor: "2026-10-06T10:00:00.000Z", seen: [] })
		const list = vi
			.fn<ListFn>()
			.mockResolvedValueOnce(answer())
			.mockResolvedValueOnce(answer([comment("00000000-0000-4000-8000-0000000000c1", "2026-10-06T10:01:00.000Z")]))
		const live = setup({ list, storage })
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(list).toHaveBeenCalledWith({ since: new Date("2026-10-06T09:58:00.000Z") })

		live.feed.emit("comments")
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(list).toHaveBeenCalledTimes(2)
		expect(live.notify).toHaveBeenCalledWith({
			id: "comment:00000000-0000-4000-8000-0000000000c1",
			title: "Q3 plan",
			body: "Ann commented",
			path: `/artifacts/${ART}`,
		})
		expect(loadState(storage, KEY)?.cursor).toBe("2026-10-06T10:01:00.000Z")
	})

	it("coalesces a burst of signals into one request, and ignores topics that cannot mean a Notification", async () => {
		const live = setup()
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(live.list).toHaveBeenCalledTimes(1)

		live.feed.emit("current")
		live.feed.emit("ping")
		live.feed.emit("artifact")
		await advance(NOTIFY_DEBOUNCE_MS * 2)
		expect(live.list).toHaveBeenCalledTimes(1)

		for (const topic of ["accessRequests", "revisions", "reach", "comments", "resync"] as const) {
			live.feed.emit(topic)
			await advance(NOTIFY_DEBOUNCE_MS / 5)
		}
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(live.list).toHaveBeenCalledTimes(2)
	})

	it("keeps one request in flight; signals during it cause exactly one more after", async () => {
		let release: (value: NotificationList) => void = () => undefined
		const list = vi
			.fn<ListFn>()
			.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
			.mockResolvedValue(answer())
		const live = setup({ list })
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(list).toHaveBeenCalledTimes(1)

		live.feed.emit("comments")
		live.feed.emit("reach")
		await advance(NOTIFY_DEBOUNCE_MS * 3)
		expect(list).toHaveBeenCalledTimes(1)

		act(() => release(answer()))
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(list).toHaveBeenCalledTimes(2)
		await advance(NOTIFY_DEBOUNCE_MS * 3)
		expect(list).toHaveBeenCalledTimes(2)
	})

	it("keeps the cursor when a request fails, and asks again on the next signal", async () => {
		const storage = memoryStorage()
		saveState(storage, KEY, { cursor: "2026-10-06T10:00:00.000Z", seen: [] })
		const list = vi.fn<ListFn>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(answer())
		const live = setup({ list, storage })
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(loadState(storage, KEY)?.cursor).toBe("2026-10-06T10:00:00.000Z")
		live.feed.emit("revisions")
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(list).toHaveBeenCalledTimes(2)
	})

	it("reads on through full pages with after, plans over all of them, and moves the cursor past every page", async () => {
		const storage = memoryStorage()
		saveState(storage, KEY, { cursor: "2026-10-06T10:00:00.000Z", seen: [] })
		const list = vi
			.fn<ListFn>()
			.mockResolvedValueOnce(
				answer(
					[comment("00000000-0000-4000-8000-0000000000c1", "2026-10-06T10:01:00.000Z")],
					"2026-10-06T10:10:00.000Z",
					"p2",
				),
			)
			.mockResolvedValueOnce(
				answer([comment("00000000-0000-4000-8000-0000000000c2", "2026-10-06T10:02:00.000Z")], undefined, null),
			)
		const live = setup({ list, storage })
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(list.mock.calls).toEqual([[{ since: new Date("2026-10-06T09:58:00.000Z") }], [{ after: "p2" }]])
		expect(live.notify).toHaveBeenCalledTimes(2)
		expect(loadState(storage, KEY)?.cursor).toBe("2026-10-06T10:02:00.000Z")
	})

	it("reads at most five pages in one check, then summarises what they held", async () => {
		const storage = memoryStorage()
		saveState(storage, KEY, { cursor: "2026-10-06T10:00:00.000Z", seen: [] })
		let page = 0
		const list = vi.fn<ListFn>().mockImplementation(() => {
			page += 1
			const id = `00000000-0000-4000-8000-${String(page).padStart(12, "0")}`
			return Promise.resolve(answer([comment(id, `2026-10-06T10:0${page}:00.000Z`)], undefined, `p${page + 1}`))
		})
		const live = setup({ list, storage })
		await advance(NOTIFY_DEBOUNCE_MS)
		expect(list).toHaveBeenCalledTimes(5)
		expect(list.mock.calls.at(-1)).toEqual([{ after: "p5" }])
		expect(live.notify).toHaveBeenCalledTimes(1)
		expect(live.notify).toHaveBeenCalledWith(expect.objectContaining({ body: "5 new items in Activity" }))
		expect(loadState(storage, KEY)?.cursor).toBe("2026-10-06T10:05:00.000Z")
	})

	it("does nothing in an app whose bridge cannot notify", async () => {
		const live = setup({ bridge: { platform: "macos", bridgeVersion: 1 } })
		live.feed.emit("comments")
		await advance(NOTIFY_DEBOUNCE_MS * 2)
		expect(live.list).not.toHaveBeenCalled()
	})
})

describe("macBridge", () => {
	afterEach(() => {
		delete (window as { exagram?: unknown }).exagram
	})

	it("is null in a browser, and reads the app's version and notify", () => {
		expect(macBridge()).toBeNull()
		expect(macNotifies()).toBe(false)

		const notify = vi.fn()
		;(window as { exagram?: unknown }).exagram = Object.freeze({ platform: "macos", bridgeVersion: 2, notify })
		const bridge = macBridge()
		expect(bridge?.bridgeVersion).toBe(2)
		bridge?.notify?.({ id: "a", title: "t", body: "b", path: "/activity" })
		expect(notify).toHaveBeenCalledWith({ id: "a", title: "t", body: "b", path: "/activity" })
		expect(macNotifies()).toBe(true)
	})

	it("does not notify through a version 1 app, or an object of another shape", () => {
		;(window as { exagram?: unknown }).exagram = Object.freeze({ platform: "macos", bridgeVersion: 1 })
		expect(macBridge()?.notify).toBeUndefined()
		expect(macNotifies()).toBe(false)
		;(window as { exagram?: unknown }).exagram = { platform: "macos", bridgeVersion: "2", notify: () => undefined }
		expect(macBridge()).toBeNull()
	})
})
