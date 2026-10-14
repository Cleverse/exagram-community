import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApprovedGate } from "./ApprovedGate"
import { clearSentRequests, recordSent, sentRequestOf } from "./sentRequests"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { ARTIFACT, decision, feedOf, renderAsMember, SCOPE } from "@/test/accessRequests"

const sent = () => recordSent(SCOPE, ARTIFACT, { at: Date.now() - 3_600_000, role: "view", note: "" })

const renderGate = () =>
	renderAsMember(
		<ApprovedGate artifactId={ARTIFACT} fallback={<p>Loading the file</p>}>
			<p>The file</p>
		</ApprovedGate>,
	)

beforeEach(() => clearSentRequests())
afterEach(() => vi.restoreAllMocks())

describe("ApprovedGate", () => {
	it("is the file at once when this browser never asked for it", () => {
		const feed = vi.spyOn(apiClient.notifications, "list")
		renderGate()
		expect(screen.getByText("The file")).toBeInTheDocument()
		expect(feed).not.toHaveBeenCalled()
	})

	it("holds the file back while the feed answers", () => {
		sent()
		vi.spyOn(apiClient.notifications, "list").mockReturnValue(new Promise(() => undefined))
		renderGate()
		expect(screen.getByText("Loading the file")).toBeInTheDocument()
		expect(screen.queryByText("The file")).not.toBeInTheDocument()
	})

	it("puts the Owner's approval in front of the file until Open", async () => {
		sent()
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(
			feedOf([decision({ outcome: "granted", title: "Pricing FAQ", actorName: "Grace", role: "edit" })]),
		)
		renderGate()
		expect(await screen.findByRole("heading", { name: "You now have access to “Pricing FAQ”" })).toBeInTheDocument()
		expect(screen.getByText("Grace approved your request as Editor.")).toBeInTheDocument()
		expect(screen.queryByText("The file")).not.toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Open" }))
		expect(screen.getByText("The file")).toBeInTheDocument()
		expect(sentRequestOf(SCOPE, ARTIFACT)).toBeUndefined()
	})

	it("does not take an answer cached before the file opened for the Owner's reply", async () => {
		const at = Date.now() - 3_600_000
		recordSent(SCOPE, ARTIFACT, { at, role: "view", note: "" })
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(
			feedOf([decision({ outcome: "granted", title: "Pricing FAQ", actorName: "Grace", role: "view" })]),
		)
		renderAsMember(
			<ApprovedGate artifactId={ARTIFACT}>
				<p>The file</p>
			</ApprovedGate>,
			{ seed: (client) => client.setQueryData(QueryKeys.notifications.requestAnswer(ARTIFACT, at), null) },
		)
		expect(await screen.findByRole("heading", { name: "You now have access to “Pricing FAQ”" })).toBeInTheDocument()
		expect(sentRequestOf(SCOPE, ARTIFACT)).toBeDefined()
	})

	it("claims no approval for a file reached another way, and forgets the request", async () => {
		sent()
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(feedOf([]))
		renderGate()
		expect(await screen.findByText("The file")).toBeInTheDocument()
		await waitFor(() => expect(sentRequestOf(SCOPE, ARTIFACT)).toBeUndefined())
		expect(screen.queryByRole("heading", { name: /You now have access to/ })).not.toBeInTheDocument()
	})

	it("forgets a request whose answer was a decline, since the file now opens anyway", async () => {
		sent()
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(feedOf([decision({ outcome: "declined" })]))
		renderGate()
		expect(await screen.findByText("The file")).toBeInTheDocument()
		await waitFor(() => expect(sentRequestOf(SCOPE, ARTIFACT)).toBeUndefined())
	})

	it("shows the file when the feed cannot be read, keeping the request", async () => {
		sent()
		vi.spyOn(apiClient.notifications, "list").mockRejectedValue(new Error("Could not load notifications"))
		renderGate()
		expect(await screen.findByText("The file")).toBeInTheDocument()
		expect(sentRequestOf(SCOPE, ARTIFACT)).toBeDefined()
	})

	it("frames the card where the screen needs it", async () => {
		sent()
		vi.spyOn(apiClient.notifications, "list").mockResolvedValue(
			feedOf([decision({ outcome: "granted", title: "Pricing FAQ", actorName: "Grace", role: "view" })]),
		)
		renderAsMember(
			<ApprovedGate artifactId={ARTIFACT} frame={(card) => <div data-testid="frame">{card}</div>}>
				<p>The file</p>
			</ApprovedGate>,
		)
		expect(await screen.findByTestId("frame")).toHaveTextContent("You now have access to “Pricing FAQ”")
	})
})
