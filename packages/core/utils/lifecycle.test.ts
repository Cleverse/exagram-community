import { EventEmitter } from "node:events"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createLifecycle } from "./lifecycle"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("createLifecycle", () => {
	it("is ready initially", () => {
		const lifecycle = createLifecycle({
			timeoutSec: 30,
			close: () => Promise.resolve(),
			exit: vi.fn(),
			log: vi.fn(),
		})
		expect(lifecycle.isReady()).toBe(true)
	})

	it("flips isReady to false synchronously, before close is awaited", () => {
		const close = deferred<void>()
		const lifecycle = createLifecycle({
			timeoutSec: 30,
			close: () => close.promise,
			exit: vi.fn(),
			log: vi.fn(),
		})

		lifecycle.shutdown()

		// close() has not resolved yet, but isReady already flipped.
		expect(lifecycle.isReady()).toBe(false)
	})

	it("exits 0 once close resolves", async () => {
		const exit = vi.fn()
		const close = deferred<void>()
		const lifecycle = createLifecycle({ timeoutSec: 30, close: () => close.promise, exit, log: vi.fn() })

		lifecycle.shutdown()
		expect(exit).not.toHaveBeenCalled()

		close.resolve()
		await vi.advanceTimersByTimeAsync(0)

		expect(exit).toHaveBeenCalledExactlyOnceWith(0)
	})

	it("exits 1 after timeoutSec when close hangs", async () => {
		const exit = vi.fn()
		const log = vi.fn()
		const lifecycle = createLifecycle({
			timeoutSec: 30,
			close: () => new Promise(() => {}),
			exit,
			log,
		})

		lifecycle.shutdown()
		expect(exit).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(30_000)

		expect(exit).toHaveBeenCalledExactlyOnceWith(1)
		expect(log).toHaveBeenCalledWith("lifecycle:shutdown-timeout")
	})

	it("treats a second signal as a no-op", async () => {
		const exit = vi.fn()
		const close = vi.fn(() => Promise.resolve())
		const lifecycle = createLifecycle({ timeoutSec: 30, close, exit, log: vi.fn() })

		lifecycle.shutdown()
		lifecycle.shutdown()

		await vi.advanceTimersByTimeAsync(0)

		expect(exit).toHaveBeenCalledTimes(1)
		expect(close).toHaveBeenCalledTimes(1)
	})

	it("wires SIGTERM and SIGINT through install", () => {
		const exit = vi.fn()
		const close = vi.fn(() => Promise.resolve())
		const lifecycle = createLifecycle({ timeoutSec: 30, close, exit, log: vi.fn() })

		const proc = new EventEmitter() as unknown as NodeJS.Process
		lifecycle.install(proc)
		;(proc as unknown as EventEmitter).emit("SIGTERM")
		expect(lifecycle.isReady()).toBe(false)
		expect(close).toHaveBeenCalledTimes(1)
	})

	it("wires SIGINT too", () => {
		const exit = vi.fn()
		const close = vi.fn(() => Promise.resolve())
		const lifecycle = createLifecycle({ timeoutSec: 30, close, exit, log: vi.fn() })

		const proc = new EventEmitter() as unknown as NodeJS.Process
		lifecycle.install(proc)
		;(proc as unknown as EventEmitter).emit("SIGINT")
		expect(lifecycle.isReady()).toBe(false)
		expect(close).toHaveBeenCalledTimes(1)
	})
})
