import { type AccessRequest, type PendingRevision } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { describe, expect, it } from "vitest"

import { InboxButton } from "./InboxButton"

import { QueryKeys } from "@/config/queryKeys"

const pendingRevision = (revisionId: string, isApprover: boolean): PendingRevision => ({
	placeholderTypes: [],
	redactionStatus: "done",
	revisionId,
	artifactId: "a1",
	seq: 2,
	authorUserId: "u2",
	authorConnectionId: null,
	mime: "text/markdown",
	bytes: 12,
	note: null,
	createdAt: new Date("2026-09-14T00:00:00Z"),
	title: "a1",
	kind: "doc",
	ownerId: isApprover ? "u1" : "u2",
	isApprover,
	authorName: "Grace",
	authorConnectionName: null,
})

const request: AccessRequest = {
	id: "q1",
	artifactId: "a1",
	artifactTitle: "Spec",
	requesterId: "u3",
	requesterEmail: "grace@example.com",
	requesterName: "Grace Hopper",
	role: "view",
	note: null,
	createdAt: new Date(2026, 0, 1),
}

const Where = () => <div data-testid="where">{useLocation().pathname}</div>

const renderInbox = ({
	at = "/",
	pending = [],
	requests = [],
}: { at?: string; pending?: PendingRevision[]; requests?: AccessRequest[] } = {}) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.approvals.pending(), pending)
	queryClient.setQueryData(QueryKeys.accessRequests.list(), requests)
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[at]}>
				<InboxButton />
				<Routes>
					<Route path="*" element={<Where />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	)
}

describe("InboxButton", () => {
	it("counts the Revisions you approve and the open Access Requests on your files", () => {
		renderInbox({ pending: [pendingRevision("r9", true), pendingRevision("r8", false)], requests: [request] })
		const inbox = screen.getByRole("link", { name: "Inbox, 2 awaiting your action" })
		expect(inbox.querySelector("span[aria-hidden]")).not.toBeNull()
	})

	it("shows no badge when nothing awaits you", () => {
		renderInbox({ pending: [pendingRevision("r8", false)] })
		expect(screen.getByRole("link", { name: "Inbox" }).querySelector("span[aria-hidden]")).toBeNull()
	})

	it("opens the Activity screen and lights while it is open", () => {
		const { unmount } = renderInbox({ at: "/activity?preview=a1" })
		expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page")
		unmount()

		renderInbox({ at: "/context" })
		const inbox = screen.getByRole("link", { name: "Inbox" })
		expect(inbox).not.toHaveAttribute("aria-current")
		fireEvent.click(inbox)
		expect(screen.getByTestId("where")).toHaveTextContent("/activity")
	})
})
