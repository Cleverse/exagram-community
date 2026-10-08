import { type Connection } from "@exagram/api-client"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useConnectionDetail } from "./useConnectionDetail"

import { apiClient } from "@/config/apiClient"
import { renderMobile } from "@/test/mobile"

const connection = (over: Partial<Connection> = {}): Connection => ({
	id: "conn-detail-1",
	name: "Claude Desktop",
	oidcClientId: "client-1",
	scopes: ["read", "write"],
	folderAccess: "all",
	folderCount: 0,
	workspaceId: "workspace-1",
	revokedAt: null,
	createdAt: new Date(2026, 7, 12),
	...over,
})

/** Prints what the hook reports and exposes its actions as buttons. */
const Probe = ({ value, onRevoked }: { value: Connection; onRevoked: () => void }) => {
	const detail = useConnectionDetail(value, { onRevoked })
	return (
		<div>
			<p>{detail.scopes.map((entry) => entry.label).join(", ")}</p>
			<p>{detail.stale ? "stale" : "current"}</p>
			<p>{detail.connectedLabel}</p>
			<button type="button" onClick={detail.reconnect}>
				Reconnect
			</button>
			<button type="button" onClick={detail.revoke}>
				Revoke
			</button>
		</div>
	)
}

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe("useConnectionDetail", () => {
	it("reports the scopes held, the connected date, and whether the Connection predates scopes", () => {
		const { unmount } = renderMobile(<Probe value={connection()} onRevoked={vi.fn()} />)
		expect(screen.getByText("Can read content, Can insert content")).toBeInTheDocument()
		expect(screen.getByText("current")).toBeInTheDocument()
		expect(screen.getByText("12 Aug 2026")).toBeInTheDocument()
		unmount()

		renderMobile(<Probe value={connection({ scopes: [] })} onRevoked={vi.fn()} />)
		expect(screen.getByText("stale")).toBeInTheDocument()
	})

	it("revokes on the server, then toasts and tells the caller", async () => {
		const user = userEvent.setup()
		const revoke = vi.spyOn(apiClient.connections, "revoke").mockResolvedValue(undefined as never)
		const onRevoked = vi.fn()
		renderMobile(<Probe value={connection()} onRevoked={onRevoked} />)
		await user.click(screen.getByRole("button", { name: "Revoke" }))
		await waitFor(() => expect(onRevoked).toHaveBeenCalledOnce())
		expect(revoke).toHaveBeenCalledWith({ connectionId: "conn-detail-1" })
		expect(screen.getByText("Claude Desktop revoked — its next request is refused.")).toBeInTheDocument()
	})

	it("explains Reconnect in a toast", async () => {
		const user = userEvent.setup()
		renderMobile(<Probe value={connection()} onRevoked={vi.fn()} />)
		await user.click(screen.getByRole("button", { name: "Reconnect" }))
		expect(await screen.findByText(/Reconnect Claude Desktop: the consent screen lists/)).toBeInTheDocument()
	})
})
