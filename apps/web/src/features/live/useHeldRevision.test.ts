import { type VisibleArtifact } from "@exagram/api-client"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useHeldRevision } from "./useHeldRevision"

const artifact = (id: string, visibleRevisionId: string | null, revisionSeq: number | null): VisibleArtifact =>
	({ id, visibleRevisionId, currentRevisionId: visibleRevisionId, revisionSeq }) as VisibleArtifact

const setup = (initial: VisibleArtifact, canSwap = true) =>
	renderHook(({ served, swap }) => useHeldRevision(served, swap), {
		initialProps: { served: initial, swap: canSwap },
	})

describe("useHeldRevision", () => {
	it("swaps a new Current Revision in for a reader on the latest one, outside Compare and Present", () => {
		const { result, rerender } = setup(artifact("a1", "r1", 1))
		rerender({ served: artifact("a1", "r2", 2), swap: true })
		expect(result.current.artifact.visibleRevisionId).toBe("r2")
		expect(result.current.artifact.revisionSeq).toBe(2)
		expect(result.current.newer).toBe(false)
	})

	it("keeps the Revision on show in Compare or Present, and View moves to the new one", () => {
		const { result, rerender } = setup(artifact("a1", "r1", 1), false)
		rerender({ served: artifact("a1", "r2", 2), swap: false })
		expect(result.current.artifact.visibleRevisionId).toBe("r1")
		expect(result.current.artifact.currentRevisionId).toBe("r1")
		expect(result.current.newer).toBe(true)

		// Leaving Present does not swap the body under the reader either.
		rerender({ served: artifact("a1", "r2", 2), swap: true })
		expect(result.current.artifact.visibleRevisionId).toBe("r1")
		expect(result.current.newer).toBe(true)

		act(() => result.current.view())
		expect(result.current.artifact.visibleRevisionId).toBe("r2")
		expect(result.current.newer).toBe(false)
	})

	it("a reader already behind the latest keeps their Revision when yet another one arrives", () => {
		const { result, rerender } = setup(artifact("a1", "r1", 1), false)
		rerender({ served: artifact("a1", "r2", 2), swap: false })
		rerender({ served: artifact("a1", "r3", 3), swap: true })
		expect(result.current.artifact.visibleRevisionId).toBe("r1")
		expect(result.current.newer).toBe(true)
		act(() => result.current.view())
		expect(result.current.artifact.visibleRevisionId).toBe("r3")
	})

	it("says nothing while the served Revision stays put, as for a pinned grantee", () => {
		const { result, rerender } = setup(artifact("a1", "r1", 1), false)
		rerender({ served: { ...artifact("a1", "r1", 1), title: "Renamed" }, swap: false })
		expect(result.current.newer).toBe(false)
		expect(result.current.artifact.title).toBe("Renamed")
	})

	it("starts over for another Artifact", () => {
		const { result, rerender } = setup(artifact("a1", "r1", 1), false)
		rerender({ served: artifact("a1", "r2", 2), swap: false })
		rerender({ served: artifact("b1", "s4", 4), swap: false })
		expect(result.current.artifact.visibleRevisionId).toBe("s4")
		expect(result.current.newer).toBe(false)
	})
})
