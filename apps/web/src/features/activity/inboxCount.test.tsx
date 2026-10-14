import { type AccessRequest, type PendingRevision, type VisibleArtifact } from "@exagram/api-client"
import { act, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InboxBell } from "./InboxBell"
import { markSeen } from "./lastSeen"

import { QueryKeys } from "@/config/queryKeys"
import { stateScopeOf } from "@/features/workspace/stateScope"
import { ME, renderMobile } from "@/test/mobile"

const HOUR = 3_600_000

const artifact = (over: Partial<VisibleArtifact>): VisibleArtifact =>
	({
		id: "a1",
		ownerId: "u2",
		ownerName: "Grace Hopper",
		projectId: null,
		kind: "doc",
		title: "Spec",
		visibleRevisionId: "r1",
		access: "view",
		revisionSeq: 2,
		updatedAt: new Date(Date.now() - HOUR),
		sharedWithNames: [],
		...over,
	}) as VisibleArtifact

const pending = (over: Partial<PendingRevision> = {}): PendingRevision =>
	({
		revisionId: "rev9",
		artifactId: "a9",
		seq: 2,
		ownerId: "u1",
		isApprover: true,
		authorUserId: "u2",
		authorConnectionId: null,
		authorName: "Grace Hopper",
		createdAt: new Date(Date.now() - HOUR),
		title: "Draft",
		kind: "doc",
		...over,
	}) as PendingRevision

const request = (over: Partial<AccessRequest> = {}): AccessRequest => ({
	id: "q1",
	artifactId: "a1",
	artifactTitle: "Spec",
	requesterId: "u3",
	requesterEmail: "grace@example.com",
	requesterName: "Grace Hopper",
	role: "view",
	note: null,
	createdAt: new Date(Date.now() - HOUR),
	...over,
})

const renderBell = (artifacts: VisibleArtifact[], queue: PendingRevision[] = [], requests: AccessRequest[] = []) =>
	renderMobile(<InboxBell />, {
		seed: (client) => {
			client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), artifacts)
			client.setQueryData(QueryKeys.approvals.pending(), queue)
			client.setQueryData(QueryKeys.accessRequests.list(), requests)
		},
	})

describe("the bell's count", () => {
	beforeEach(() => markSeen(stateScopeOf(ME), 0))
	afterEach(() => vi.restoreAllMocks())

	it("adds others' updates from the last day to the approvals waiting on this person", () => {
		renderBell(
			[
				artifact({ id: "a1" }),
				// Someone else's, but two days old: read by now.
				artifact({ id: "a2", updatedAt: new Date(Date.now() - 48 * HOUR) }),
				// This person's own publish is never news to them.
				artifact({ id: "a3", ownerId: "u1", ownerName: "Ada Lovelace", access: "owner" }),
			],
			[pending(), pending({ revisionId: "rev8", ownerId: "u3", isApprover: false })],
		)
		expect(screen.getByRole("button", { name: "Activity, 2 new" })).toBeInTheDocument()
	})

	it("drops the updates once Activity has been seen, keeping the approvals", () => {
		renderBell([artifact({})], [pending()])
		expect(screen.getByRole("button", { name: "Activity, 2 new" })).toBeInTheDocument()
		act(() => markSeen(stateScopeOf(ME)))
		expect(screen.getByRole("button", { name: "Activity, 1 new" })).toBeInTheDocument()
	})

	it("counts only what the server says this person approves, not what their ownerId suggests", () => {
		renderBell(
			[],
			[
				// The reader owns the file but it sits in someone's folder: they are its Author, not the Approver.
				pending({ revisionId: "rev1", ownerId: "u1", isApprover: false }),
				// Someone else's file in the reader's folder: the reader approves it.
				pending({ revisionId: "rev2", ownerId: "u2", isApprover: true }),
			],
		)
		expect(screen.getByRole("button", { name: "Activity, 1 new" })).toBeInTheDocument()
	})

	it("counts each open Access Request on this person's files, which seeing Activity does not clear", () => {
		renderBell([], [pending()], [request(), request({ id: "q2", requesterName: "Alan Turing" })])
		expect(screen.getByRole("button", { name: "Activity, 3 new" })).toBeInTheDocument()
		act(() => markSeen(stateScopeOf(ME)))
		expect(screen.getByRole("button", { name: "Activity, 3 new" })).toBeInTheDocument()
	})

	it("still clears when the browser refuses storage", () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked")
		})
		renderBell([artifact({})])
		expect(screen.getByRole("button", { name: "Activity, 1 new" })).toBeInTheDocument()
		act(() => markSeen(stateScopeOf(ME)))
		expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument()
	})
})
