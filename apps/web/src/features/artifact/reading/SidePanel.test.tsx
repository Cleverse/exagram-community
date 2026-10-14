import { type VisibleArtifact } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { SidePanel, type SideTab } from "./SidePanel"

import { ToastProvider } from "@/components/Toast"

const artifact = { id: "a1", currentRevisionId: "r1", access: "owner" } as VisibleArtifact

const Harness = () => {
	const [tab, setTab] = useState<SideTab>("comments")
	return <SidePanel artifact={artifact} tab={tab} tabs={["comments", "ledger"]} onTab={setTab} onClose={() => {}} />
}

describe("SidePanel", () => {
	it("switches between Comments and the Ledger, with no History tab", async () => {
		const user = userEvent.setup()
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<ToastProvider>
					<Harness />
				</ToastProvider>
			</QueryClientProvider>,
		)
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Comments", "Ledger"])
		expect(screen.getByRole("tab", { name: "Comments" })).toHaveAttribute("aria-selected", "true")

		await user.click(screen.getByRole("tab", { name: "Ledger" }))
		expect(screen.getByRole("tab", { name: "Ledger" })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("heading", { name: "Ledger" })).toBeInTheDocument()
	})
})
