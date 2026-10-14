import {
	type Grant,
	type GrantRole,
	type GroupSuggestion,
	type InviteSuggestion,
	type WorkspaceKind,
} from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { chipKey, inviteToast, isFullEmail, NOT_AN_EMAIL, useInvitePicker } from "./useInvitePicker"

import { apiClient } from "@/config/apiClient"
import { type InviteInput } from "@/features/grants/hooks/useGrants"
import { groupGrant, personGrant } from "@/test/grants"

const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
		{children}
	</QueryClientProvider>
)

const grace: InviteSuggestion = { id: "u2", name: "Grace Hopper", email: "grace@acme.test", pending: false }
const alan: InviteSuggestion = { id: "u3", name: "Alan Turing", email: "alan@acme.test", pending: false }
const design: GroupSuggestion = { id: "grp-design", name: "Design team", memberCount: 3 }
const ops: GroupSuggestion = { id: "grp-ops", name: "Operations", memberCount: 1 }

const base = { artifactId: "a1", projectId: null, pinnedRevisionId: null, createdAt: new Date("2026-09-01T00:00:00Z") }

const created = (email: string, extra: Partial<Grant> = {}): Grant =>
	personGrant({
		...base,
		id: `g-${email}`,
		granteeId: `u-${email}`,
		granteeEmail: email,
		granteeName: email,
		granteePending: false,
		role: "collaborate",
		...extra,
	})

const createdGroup = (group: GroupSuggestion): Grant =>
	groupGrant(group, { ...base, id: `g-${group.id}`, role: "collaborate" })

const answer = (input: InviteInput) =>
	Promise.resolve(
		"groupId" in input
			? createdGroup({ id: input.groupId, name: "A group", memberCount: 1 })
			: created(input.granteeEmail),
	)

const renderPicker = ({
	people = [],
	groups = [],
	create = vi.fn(answer),
	defaultPinnedRevisionId,
	defaultRole = "collaborate",
	ceiling = "edit",
	kind = "team",
}: {
	people?: InviteSuggestion[]
	groups?: GroupSuggestion[]
	create?: (input: InviteInput) => Promise<Grant>
	defaultPinnedRevisionId?: string | null
	/** null, not undefined, which would take the "collaborate" default. */
	defaultRole?: GrantRole | null
	ceiling?: "edit" | "collaborate" | null
	kind?: WorkspaceKind
} = {}) => {
	const suggestions = vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue({ people, groups })
	const hook = renderHook(
		(known: { defaultRole: GrantRole | null }) =>
			useInvitePicker({
				target: { artifactId: "a1" },
				ceiling,
				kind,
				defaultRole: known.defaultRole ?? undefined,
				defaultPinnedRevisionId,
				create,
			}),
		{ wrapper, initialProps: { defaultRole } },
	)
	return { ...hook, create, suggestions }
}

afterEach(() => vi.restoreAllMocks())

describe("isFullEmail", () => {
	it("accepts a whole address and nothing less", () => {
		expect(isFullEmail(" grace@acme.test ")).toBe(true)
		expect(isFullEmail("grace")).toBe(false)
		expect(isFullEmail("grace@")).toBe(false)
		expect(isFullEmail("grace@acme")).toBe(false)
	})
})

describe("useInvitePicker", () => {
	it("offers a full address that matches nobody as a new invitee, and Enter adds it without touching it", async () => {
		const { result } = renderPicker()
		act(() => result.current.setText("new@elsewhere.test"))
		await waitFor(() => expect(result.current.newEmail).toBe("new@elsewhere.test"))
		act(() => expect(result.current.enter()).toBeNull())
		expect(result.current.chips).toEqual([
			{ kind: "person", email: "new@elsewhere.test", name: "new@elsewhere.test", isNew: true },
		])
		expect(result.current.text).toBe("")
	})

	it("refuses text that is neither a person, a Group nor a full address, and never appends a domain", async () => {
		const { result, suggestions } = renderPicker({ people: [grace], groups: [design] })
		act(() => result.current.setText("hello"))
		await waitFor(() => expect(suggestions).toHaveBeenCalledWith(expect.objectContaining({ q: "hello" })))
		expect(result.current.newEmail).toBeNull()
		let error: string | null = null
		act(() => {
			error = result.current.enter()
		})
		expect(error).toBe(NOT_AN_EMAIL)
		expect(result.current.chips).toEqual([])
		expect(result.current.text).toBe("hello")
	})

	it("Enter picks the first person the text matches", async () => {
		const { result } = renderPicker({ people: [grace, alan] })
		await waitFor(() => expect(result.current.candidates).toHaveLength(2))
		act(() => result.current.setText("alan"))
		await waitFor(() => expect(result.current.candidates.map((c) => c.email)).toEqual(["alan@acme.test"]))
		act(() => expect(result.current.enter()).toBeNull())
		expect(result.current.chips).toEqual([
			{ kind: "person", email: "alan@acme.test", name: "Alan Turing", isNew: false },
		])
		expect(result.current.newEmail).toBeNull()
	})

	it("lists people already invited by email first", async () => {
		const pending = { id: "u4", name: "ada@new.test", email: "ada@new.test", pending: true }
		const { result } = renderPicker({ people: [grace, pending] })
		await waitFor(() =>
			expect(result.current.candidates.map((c) => c.email)).toEqual(["ada@new.test", "grace@acme.test"]),
		)
		act(() => result.current.toggle(pending))
		expect(result.current.chips[0]).toMatchObject({ email: "ada@new.test", isNew: true })
		expect(result.current.candidates[0]?.selected).toBe(true)
	})

	it("Backspace on an empty input takes the last chip back out, and does nothing while there is text", async () => {
		const { result } = renderPicker({ people: [grace, alan] })
		await waitFor(() => expect(result.current.candidates).toHaveLength(2))
		act(() => result.current.toggle(grace))
		act(() => result.current.toggle(alan))
		act(() => result.current.setText("x"))
		act(() => expect(result.current.backspace()).toBe(false))
		expect(result.current.chips).toHaveLength(2)
		act(() => result.current.setText(""))
		act(() => expect(result.current.backspace()).toBe(true))
		expect(result.current.chips.map(chipKey)).toEqual(["grace@acme.test"])
	})

	it("can submit only once someone is picked", async () => {
		const { result } = renderPicker({ people: [grace] })
		expect(result.current.canSubmit).toBe(false)
		await waitFor(() => expect(result.current.candidates).toHaveLength(1))
		act(() => result.current.toggle(grace))
		expect(result.current.canSubmit).toBe(true)
	})

	it("makes one Grant per chip; a failure keeps its chip and error while the rest go through", async () => {
		const create = vi.fn((input: InviteInput) =>
			"granteeEmail" in input && input.granteeEmail === "alan@acme.test"
				? Promise.reject(new Error("Already has access"))
				: answer(input),
		)
		const { result } = renderPicker({ people: [grace, alan], create })
		await waitFor(() => expect(result.current.candidates).toHaveLength(2))
		act(() => result.current.toggle(grace))
		act(() => result.current.toggle(alan))
		let outcome: Awaited<ReturnType<typeof result.current.submit>> | undefined
		await act(async () => {
			outcome = await result.current.submit()
		})
		expect(outcome?.created.map((grant) => grant.granteeEmail)).toEqual(["grace@acme.test"])
		expect(outcome?.failed).toEqual([
			{ key: "alan@acme.test", label: "alan@acme.test", kind: "person", error: "Already has access" },
		])
		expect(result.current.chips.map(chipKey)).toEqual(["alan@acme.test"])
		expect(result.current.failures).toEqual({ "alan@acme.test": "Already has access" })
	})

	it("invites a Member and a new address alike, at the Team's default role", async () => {
		const { result, create } = renderPicker({ people: [grace] })
		await waitFor(() => expect(result.current.candidates).toHaveLength(1))
		act(() => result.current.toggle(grace))
		act(() => result.current.setText("new@elsewhere.test"))
		await waitFor(() => expect(result.current.newEmail).toBe("new@elsewhere.test"))
		act(() => result.current.addNewEmail())
		await act(async () => {
			await result.current.submit()
		})
		expect(create).toHaveBeenNthCalledWith(1, { granteeEmail: "grace@acme.test", role: "collaborate" })
		expect(create).toHaveBeenNthCalledWith(2, { granteeEmail: "new@elsewhere.test", role: "collaborate" })
	})

	it("sends a pin only when the pin select shows", async () => {
		const hidden = renderPicker({ people: [grace] })
		expect(hidden.result.current.showPin).toBe(false)
		await waitFor(() => expect(hidden.result.current.candidates).toHaveLength(1))
		act(() => hidden.result.current.toggle(grace))
		await act(async () => {
			await hidden.result.current.submit()
		})
		expect(hidden.create).toHaveBeenCalledWith({ granteeEmail: "grace@acme.test", role: "collaborate" })
		hidden.unmount()

		const shown = renderPicker({ people: [grace], defaultPinnedRevisionId: "r1" })
		expect(shown.result.current.showPin).toBe(true)
		expect(shown.result.current.pinnedRevisionId).toBe("r1")
		await waitFor(() => expect(shown.result.current.candidates).toHaveLength(1))
		act(() => shown.result.current.toggle(grace))
		act(() => shown.result.current.setPinnedRevisionId(null))
		await act(async () => {
			await shown.result.current.submit()
		})
		expect(shown.create).toHaveBeenCalledWith({
			granteeEmail: "grace@acme.test",
			role: "collaborate",
			pinnedRevisionId: null,
		})
	})

	it("reset discards the chips and the text", async () => {
		const { result } = renderPicker({ people: [grace] })
		await waitFor(() => expect(result.current.candidates).toHaveLength(1))
		act(() => result.current.toggle(grace))
		act(() => result.current.setText("al"))
		act(() => result.current.reset())
		expect(result.current.chips).toEqual([])
		expect(result.current.text).toBe("")
	})
})

describe("useInvitePicker with Groups", () => {
	it("lists the Groups the text matches, so the dialog can draw them above the people", async () => {
		const { result } = renderPicker({ people: [grace], groups: [design, ops] })
		await waitFor(() => expect(result.current.groups).toHaveLength(2))
		act(() => result.current.setText("des"))
		await waitFor(() => expect(result.current.groups.map((group) => group.name)).toEqual(["Design team"]))
		expect(result.current.candidates).toEqual([])
	})

	it("Enter picks a matching Group before a matching person", async () => {
		const designer = { id: "u7", name: "Desmond Ng", email: "desmond@acme.test", pending: false }
		const { result } = renderPicker({ people: [designer], groups: [design] })
		await waitFor(() => expect(result.current.groups).toHaveLength(1))
		act(() => result.current.setText("des"))
		await waitFor(() => expect(result.current.candidates).toHaveLength(1))
		act(() => expect(result.current.enter()).toBeNull())
		expect(result.current.chips).toEqual([{ kind: "group", id: "grp-design", name: "Design team", memberCount: 3 }])
		expect(result.current.text).toBe("")
	})

	it("toggles a Group in and out, ticking its row while it is a chip", async () => {
		const { result } = renderPicker({ groups: [design] })
		await waitFor(() => expect(result.current.groups).toHaveLength(1))
		act(() => result.current.toggleGroup(design))
		expect(result.current.groups[0]?.selected).toBe(true)
		expect(result.current.chips.map(chipKey)).toEqual(["group:grp-design"])
		act(() => result.current.toggleGroup(design))
		expect(result.current.groups[0]?.selected).toBe(false)
		expect(result.current.chips).toEqual([])
	})

	it("makes a Group Grant from a Group chip, by id and never by email, beside the person Grants", async () => {
		const { result, create } = renderPicker({ people: [grace], groups: [design] })
		await waitFor(() => expect(result.current.groups).toHaveLength(1))
		act(() => result.current.toggleGroup(design))
		act(() => result.current.toggle(grace))
		await act(async () => {
			await result.current.submit()
		})
		expect(create).toHaveBeenNthCalledWith(1, { groupId: "grp-design", role: "collaborate" })
		expect(create).toHaveBeenNthCalledWith(2, { granteeEmail: "grace@acme.test", role: "collaborate" })
		expect(result.current.chips).toEqual([])
	})

	it("keeps a refused Group's chip with the server's sentence, named by the Group", async () => {
		const create = vi.fn((input: InviteInput) =>
			"groupId" in input ? Promise.reject(new Error("Not found")) : answer(input),
		)
		const { result } = renderPicker({ people: [grace], groups: [design], create })
		await waitFor(() => expect(result.current.groups).toHaveLength(1))
		act(() => result.current.toggleGroup(design))
		act(() => result.current.toggle(grace))
		let outcome: Awaited<ReturnType<typeof result.current.submit>> | undefined
		await act(async () => {
			outcome = await result.current.submit()
		})
		expect(outcome?.failed).toEqual([
			{ key: "group:grp-design", label: "Design team", kind: "group", error: "Not found" },
		])
		expect(result.current.chips.map(chipKey)).toEqual(["group:grp-design"])
		expect(result.current.failures).toEqual({ "group:grp-design": "Not found" })
	})
})

describe("the starting role", () => {
	it("is the Team's default share role", () => {
		expect(renderPicker({ defaultRole: "edit" }).result.current.role).toBe("edit")
		expect(renderPicker({ defaultRole: "view" }).result.current.role).toBe("view")
	})

	it("is Viewer until the default is known, whatever role the Team would have set", () => {
		const { result } = renderPicker({ defaultRole: null })
		expect(result.current.options).toEqual(["view", "collaborate", "edit"])
		expect(result.current.role).toBe("view")
	})

	it("moves to the default once it loads, while the sharer has not picked a role", () => {
		const { result, rerender } = renderPicker({ defaultRole: null })
		expect(result.current.role).toBe("view")
		rerender({ defaultRole: "edit" })
		expect(result.current.role).toBe("edit")
	})

	it("stays where the sharer put it when the default loads after", () => {
		const { result, rerender } = renderPicker({ defaultRole: null })
		act(() => result.current.setRole("collaborate"))
		rerender({ defaultRole: "edit" })
		expect(result.current.role).toBe("collaborate")
	})

	it("is clamped to the strongest role the caller may hand out", () => {
		const { result } = renderPicker({ defaultRole: "edit", ceiling: "collaborate" })
		expect(result.current.options).toEqual(["view", "collaborate"])
		expect(result.current.role).toBe("collaborate")
	})

	it("keeps what the sharer picked over the default", () => {
		const { result } = renderPicker({ defaultRole: "edit" })
		act(() => result.current.setRole("view"))
		expect(result.current.role).toBe("view")
	})

	it("is Viewer in a Personal Workspace, which has no Team default to read", () => {
		const { result } = renderPicker({ kind: "personal", defaultRole: "edit" })
		expect(result.current.options).toEqual(["view", "edit"])
		expect(result.current.role).toBe("view")
	})
})

describe("inviteToast", () => {
	it("tells the sharer to send the link to someone not in the workspace yet", () => {
		const one = created("a@new.test", { granteePending: true })
		const two = created("b@new.test", { granteePending: true })
		expect(inviteToast([one])).toBe("Shared · send a@new.test the link.")
		expect(inviteToast([one, two])).toBe("Shared · send them the link.")
	})

	it("keeps the count of people and Groups when only some of those picked are not in the workspace yet", () => {
		const one = created("a@new.test", { granteePending: true })
		const two = created("b@new.test", { granteePending: true })
		expect(inviteToast([one, created("grace@acme.test")])).toBe("Shared with 2 people · send a@new.test the link.")
		expect(inviteToast([one, two, created("grace@acme.test")])).toBe(
			"Shared with 3 people · send the new people the link.",
		)
		expect(inviteToast([one, createdGroup(design)])).toBe(
			"Shared with 1 person and 1 group · send a@new.test the link.",
		)
		expect(inviteToast([one, two, createdGroup(design)])).toBe(
			"Shared with 2 people and 1 group · send the new people the link.",
		)
	})

	it("counts Members who can open it now", () => {
		expect(inviteToast([created("grace@acme.test")])).toBe("Shared with 1 person · 1 can open it.")
		expect(inviteToast([created("grace@acme.test"), created("alan@acme.test")])).toBe(
			"Shared with 2 people · 2 can open it.",
		)
	})

	it("counts people and Groups apart, and everyone a Group reaches among those who can open it", () => {
		const people = [created("grace@acme.test"), created("alan@acme.test")]
		expect(inviteToast([...people, createdGroup(design)])).toBe(
			"Shared with 2 people and 1 group · up to 5 can open it.",
		)
		expect(inviteToast([createdGroup(design), createdGroup({ ...ops, memberCount: 4 })])).toBe(
			"Shared with 2 groups · up to 7 can open it.",
		)
		expect(inviteToast([created("grace@acme.test"), createdGroup(ops)])).toBe(
			"Shared with 1 person and 1 group · up to 2 can open it.",
		)
	})
})
