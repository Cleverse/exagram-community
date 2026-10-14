import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RequestAccess } from "./RequestAccess"
import { clearSentRequests, recordSent, useSentRequest } from "./sentRequests"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ARTIFACT, decision, feedOf, OTHER_ARTIFACT, renderAsMember, SCOPE } from "@/test/accessRequests"

const HOUR = 3_600_000

const create = () => vi.spyOn(apiClient.accessRequests, "create").mockResolvedValue({ sent: true })

const SentProbe = () => <output aria-label="remembered">{String(useSentRequest(ARTIFACT)?.at ?? "")}</output>

const listFeed = () => vi.spyOn(apiClient.notifications, "list")
let feed: ReturnType<typeof listFeed>

beforeEach(() => {
	clearSentRequests()
	feed = listFeed().mockResolvedValue(feedOf([]))
})
afterEach(() => vi.restoreAllMocks())

describe("RequestAccess", () => {
	it("asks the server nothing until the member sends a request", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch")
		const send = create()
		const cancel = vi.spyOn(apiClient.accessRequests, "cancel")
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		expect(screen.getByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(send).not.toHaveBeenCalled()
		expect(cancel).not.toHaveBeenCalled()
		expect(feed).not.toHaveBeenCalled()
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("sends the role and the message, says only that it was sent, and remembers it", async () => {
		const send = create()
		renderAsMember(
			<>
				<RequestAccess artifactId={ARTIFACT} />
				<SentProbe />
			</>,
		)
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Access needed" }), "collaborate")
		await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "  For the Q3 review  ")
		await userEvent.click(screen.getByRole("button", { name: "Request access" }))
		expect(send).toHaveBeenCalledWith({ artifactId: ARTIFACT, role: "collaborate", note: "For the Q3 review" })
		expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument()
		expect(Number(screen.getByLabelText("remembered").textContent)).toBeGreaterThan(0)
	})

	it("sends no note when none was written, at Viewer by default", async () => {
		const send = create()
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		await userEvent.click(screen.getByRole("button", { name: "Request access" }))
		expect(send).toHaveBeenCalledWith({ artifactId: ARTIFACT, role: "view" })
		expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument()
	})

	it("shows why a request failed and remembers nothing", async () => {
		vi.spyOn(apiClient.accessRequests, "create").mockRejectedValue(new Error("Too many requests"))
		renderAsMember(
			<>
				<RequestAccess artifactId={ARTIFACT} />
				<SentProbe />
			</>,
		)
		await userEvent.click(screen.getByRole("button", { name: "Request access" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests")
		expect(screen.getByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(screen.getByLabelText("remembered")).toHaveTextContent("")
	})

	it("shows a request this browser sent as pending, without asking the server about the file", async () => {
		recordSent(SCOPE, ARTIFACT, { at: Date.now() - 3 * 60_000, role: "view", note: "" })
		const send = create()
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		expect(screen.getByRole("heading", { name: "Request pending" })).toBeInTheDocument()
		expect(screen.getByText("You asked the owner for access to this file 3 minutes ago.")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Send reminder" })).toBeDisabled()
		await waitFor(() => expect(feed).toHaveBeenCalled())
		expect(send).not.toHaveBeenCalled()
	})

	it("does not show another person's request, or one from another Workspace, as this member's", () => {
		recordSent("u2.w1", ARTIFACT, { at: Date.now(), role: "view", note: "" })
		recordSent("u1.w2", ARTIFACT, { at: Date.now(), role: "view", note: "" })
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		expect(screen.getByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(feed).not.toHaveBeenCalled()
	})

	it("sends a reminder after a day, as the same role and note, and holds the next one back", async () => {
		recordSent(SCOPE, ARTIFACT, { at: Date.now() - 25 * HOUR, role: "edit", note: "Still need it" })
		const send = create()
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		await userEvent.click(screen.getByRole("button", { name: "Send reminder" }))
		expect(send).toHaveBeenCalledWith({ artifactId: ARTIFACT, role: "edit", note: "Still need it" })
		expect(await screen.findByText("Reminder sent.")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Send reminder" })).toBeDisabled()
		expect(screen.getByText("You asked the owner for access to this file just now.")).toBeInTheDocument()
	})

	it("cancels, goes back to the form and forgets the request", async () => {
		recordSent(SCOPE, ARTIFACT, { at: Date.now() - HOUR, role: "view", note: "" })
		const cancel = vi.spyOn(apiClient.accessRequests, "cancel").mockResolvedValue({ canceled: true })
		renderAsMember(
			<>
				<RequestAccess artifactId={ARTIFACT} />
				<SentProbe />
			</>,
		)
		await userEvent.click(screen.getByRole("button", { name: "Cancel request" }))
		expect(cancel).toHaveBeenCalledWith({ artifactId: ARTIFACT })
		expect(await screen.findByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(screen.getByText("Request canceled.")).toBeInTheDocument()
		expect(screen.getByLabelText("remembered")).toHaveTextContent("")
	})

	it("keeps the request when the cancel fails", async () => {
		recordSent(SCOPE, ARTIFACT, { at: Date.now() - HOUR, role: "view", note: "" })
		vi.spyOn(apiClient.accessRequests, "cancel").mockRejectedValue(new Error("Could not cancel the request"))
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		await userEvent.click(screen.getByRole("button", { name: "Cancel request" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not cancel the request")
		expect(screen.getByRole("heading", { name: "Request pending" })).toBeInTheDocument()
	})

	it("signs out to switch account", async () => {
		const signOut = vi.spyOn(apiClient.auth, "signOut").mockResolvedValue(undefined as never)
		vi.spyOn(apiClient.auth, "me").mockReturnValue(new Promise(() => undefined))
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		await userEvent.click(screen.getByRole("button", { name: "Switch account" }))
		expect(signOut).toHaveBeenCalledOnce()
	})

	it("offers a Personal Workspace Viewer and Editor", () => {
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />, { kind: "personal" })
		expect(screen.queryByRole("option", { name: "Collaborator" })).not.toBeInTheDocument()
		expect(screen.getByRole("option", { name: "Editor" })).toBeInTheDocument()
	})

	describe("the Owner's answer, from the member's own feed", () => {
		const since = Date.now() - 3 * HOUR
		const sent = () => recordSent(SCOPE, ARTIFACT, { at: since, role: "view", note: "" })

		it("shows a decline, which names neither the file nor its Owner", async () => {
			sent()
			vi.spyOn(apiClient.notifications, "list").mockResolvedValue(feedOf([decision({ outcome: "declined" })]))
			renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
			expect(await screen.findByRole("heading", { name: "Your request wasn’t approved" })).toBeInTheDocument()
			expect(screen.getByText("Contact the owner if you still need access.")).toBeInTheDocument()
		})

		it("asks the page for the file again when the answer is a Grant, and leaves the approval to the page", async () => {
			sent()
			vi.spyOn(apiClient.notifications, "list").mockResolvedValue(
				feedOf([decision({ outcome: "granted", title: "Pricing FAQ", actorName: "Grace", role: "collaborate" })]),
			)
			const { invalidate } = renderAsMember(
				<>
					<RequestAccess artifactId={ARTIFACT} />
					<SentProbe />
				</>,
			)
			await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.artifacts.get(ARTIFACT) }))
			expect(screen.getByRole("heading", { name: "Request pending" })).toBeInTheDocument()
			expect(screen.queryByText(/Pricing FAQ/)).not.toBeInTheDocument()
			expect(Number(screen.getByLabelText("remembered").textContent)).toBeGreaterThan(0)
		})

		it("asks from a little before the request, to allow for a clock that runs ahead", async () => {
			sent()
			renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
			await waitFor(() => expect(feed).toHaveBeenCalled())
			const [first] = feed.mock.calls
			expect(first?.[0]?.since?.getTime()).toBe(since - 5 * 60_000)
		})

		it("reads on through the feed's pages and takes the newest answer", async () => {
			sent()
			vi.spyOn(apiClient.notifications, "list")
				.mockResolvedValueOnce(feedOf([decision({ outcome: "declined" })], "page-2"))
				.mockResolvedValueOnce(
					feedOf([decision({ outcome: "granted", title: "Pricing FAQ", actorName: "Grace", role: "view" })]),
				)
			const { invalidate } = renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
			await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.artifacts.get(ARTIFACT) }))
			expect(feed).toHaveBeenLastCalledWith({ after: "page-2" })
			expect(screen.queryByRole("heading", { name: "Your request wasn’t approved" })).not.toBeInTheDocument()
		})

		it("stays pending for answers about other files and for other kinds of Notification", async () => {
			sent()
			vi.spyOn(apiClient.notifications, "list").mockResolvedValue(
				feedOf([
					decision({ artifactId: OTHER_ARTIFACT, outcome: "declined" }),
					decision({ artifactId: OTHER_ARTIFACT, outcome: "granted", title: "Other file", role: "view" }),
					decision({ subject: "revision", outcome: "approved", revision: 2 }),
					decision({ kind: "grant", subject: null, outcome: null }),
				]),
			)
			const { client, invalidate } = renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
			await waitFor(() => expect(feed).toHaveBeenCalled())
			await waitFor(() => expect(client.isFetching()).toBe(0))
			expect(screen.getByRole("heading", { name: "Request pending" })).toBeInTheDocument()
			expect(screen.queryByText(/Other file/)).not.toBeInTheDocument()
			expect(invalidate).not.toHaveBeenCalledWith({ queryKey: QueryKeys.artifacts.get(ARTIFACT) })
		})

		it("stays pending when the feed cannot be read", async () => {
			sent()
			vi.spyOn(apiClient.notifications, "list").mockRejectedValue(new Error("Could not load notifications"))
			const { client } = renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
			await waitFor(() => expect(feed).toHaveBeenCalled())
			await waitFor(() => expect(client.isFetching()).toBe(0))
			expect(screen.getByRole("heading", { name: "Request pending" })).toBeInTheDocument()
			expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		})

		it("gives up on a feed too long to search, rather than call the request unanswered", async () => {
			sent()
			vi.spyOn(apiClient.notifications, "list").mockResolvedValue(feedOf([], "more"))
			const { client } = renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
			await waitFor(() => expect(client.isFetching()).toBe(0))
			expect(feed).toHaveBeenCalledTimes(5)
			expect(screen.getByRole("heading", { name: "Request pending" })).toBeInTheDocument()
		})

		it("asks the feed again when the window regains focus after a few seconds", async () => {
			sent()
			const { client } = renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
			await waitFor(() => expect(client.isFetching()).toBe(0))
			expect(feed).toHaveBeenCalledTimes(1)
			feed.mockResolvedValue(feedOf([decision({ outcome: "declined" })]))
			vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 6_000 })
			try {
				window.dispatchEvent(new Event("visibilitychange"))
				expect(await screen.findByRole("heading", { name: "Your request wasn’t approved" })).toBeInTheDocument()
			} finally {
				vi.useRealTimers()
			}
		})
	})

	it("clears a failed reminder's message once the request is canceled", async () => {
		recordSent(SCOPE, ARTIFACT, { at: Date.now() - 25 * HOUR, role: "view", note: "" })
		vi.spyOn(apiClient.accessRequests, "create").mockRejectedValue(new Error("Too many requests"))
		vi.spyOn(apiClient.accessRequests, "cancel").mockResolvedValue({ canceled: true })
		renderAsMember(<RequestAccess artifactId={ARTIFACT} />)
		await userEvent.click(screen.getByRole("button", { name: "Send reminder" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests")
		await userEvent.click(screen.getByRole("button", { name: "Cancel request" }))
		expect(await screen.findByRole("heading", { name: "You need access" })).toBeInTheDocument()
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})
})
