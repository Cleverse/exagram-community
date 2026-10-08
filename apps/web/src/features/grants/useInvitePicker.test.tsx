import { type Grant, type InviteSuggestion, type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { inviteToast, isFullEmail, NOT_AN_EMAIL, useInvitePicker } from "./useInvitePicker"

import { apiClient } from "@/config/apiClient"
import { type InviteInput } from "@/features/grants/hooks/useGrants"

const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
		{children}
	</QueryClientProvider>
)

const grace: InviteSuggestion = { id: "u2", name: "Grace Hopper", email: "grace@acme.test", pending: false }
const alan: InviteSuggestion = { id: "u3", name: "Alan Turing", email: "alan@acme.test", pending: false }

const created = (email: string, extra: Partial<Grant> = {}) =>
	({ id: `g-${email}`, granteeEmail: email, granteePending: false, ...extra }) as Grant

const renderPicker = ({
	people = [],
	create = vi.fn((input: InviteInput) => Promise.resolve(created(input.granteeEmail))),
	defaultPinnedRevisionId,
	ceiling = "edit",
	kind = "team",
}: {
	people?: InviteSuggestion[]
	create?: (input: InviteInput) => Promise<Grant>
	defaultPinnedRevisionId?: string | null
	ceiling?: "edit" | "collaborate" | null
	kind?: WorkspaceKind
} = {}) => {
	const suggestions = vi.spyOn(apiClient.grants, "suggestions").mockResolvedValue(people)
	const hook = renderHook(
		() => useInvitePicker({ target: { artifactId: "a1" }, ceiling, kind, defaultPinnedRevisionId, create }),
		{ wrapper },
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
		expect(result.current.chips).toEqual([{ email: "new@elsewhere.test", name: "new@elsewhere.test", isNew: true }])
		expect(result.current.text).toBe("")
	})

	it("refuses text that is neither a person nor a full address, and never appends a domain", async () => {
		const { result, suggestions } = renderPicker()
		act(() => result.current.setText("grace"))
		await waitFor(() => expect(suggestions).toHaveBeenCalledWith(expect.objectContaining({ q: "grace" })))
		expect(result.current.newEmail).toBeNull()
		let error: string | null = null
		act(() => {
			error = result.current.enter()
		})
		expect(error).toBe(NOT_AN_EMAIL)
		expect(result.current.chips).toEqual([])
		expect(result.current.text).toBe("grace")
	})

	it("Enter picks the first person the text matches", async () => {
		const { result } = renderPicker({ people: [grace, alan] })
		await waitFor(() => expect(result.current.candidates).toHaveLength(2))
		act(() => result.current.setText("alan"))
		await waitFor(() => expect(result.current.candidates.map((c) => c.email)).toEqual(["alan@acme.test"]))
		act(() => expect(result.current.enter()).toBeNull())
		expect(result.current.chips).toEqual([{ email: "alan@acme.test", name: "Alan Turing", isNew: false }])
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
		expect(result.current.chips.map((chip) => chip.email)).toEqual(["grace@acme.test"])
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
			input.granteeEmail === "alan@acme.test"
				? Promise.reject(new Error("Already has access"))
				: Promise.resolve(created(input.granteeEmail)),
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
		expect(outcome?.failed).toEqual([{ email: "alan@acme.test", error: "Already has access" }])
		expect(result.current.chips.map((chip) => chip.email)).toEqual(["alan@acme.test"])
		expect(result.current.failures).toEqual({ "alan@acme.test": "Already has access" })
	})

	it("invites a Member and a new address alike, as Collaborator by default", async () => {
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

	it("offers a Collaborator no stronger role than their own", () => {
		const { result } = renderPicker({ ceiling: "collaborate" })
		expect(result.current.options).toEqual(["view", "collaborate"])
		expect(result.current.role).toBe("collaborate")
	})
})

describe("inviteToast", () => {
	it("tells the sharer to send the link to someone not in the workspace yet", () => {
		const one = created("a@new.test", { granteePending: true })
		const two = created("b@new.test", { granteePending: true })
		expect(inviteToast([one])).toBe("Shared · send a@new.test the link.")
		expect(inviteToast([one, two, created("grace@acme.test")])).toBe("Shared · send them the link.")
	})

	it("counts Members who can open it now", () => {
		expect(inviteToast([created("grace@acme.test")])).toBe("Shared with 1 person · 1 can open it.")
		expect(inviteToast([created("grace@acme.test"), created("alan@acme.test")])).toBe(
			"Shared with 2 people · 2 can open it.",
		)
	})
})
