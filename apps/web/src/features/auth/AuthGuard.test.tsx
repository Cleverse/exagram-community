import { ApiError } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AuthGuard } from "./AuthGuard"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"

afterEach(() => vi.restoreAllMocks())

const renderGuard = (client: QueryClient) =>
	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={["/library"]}>
				<Routes>
					<Route path="/signin" element={<div>sign-in page</div>} />
					<Route
						path="*"
						element={
							<AuthGuard>
								<div>the app</div>
							</AuthGuard>
						}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	)

const knownSession = () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	client.setQueryData(QueryKeys.auth.me(), { id: "u1", workspaceId: "w1" })
	return client
}

describe("AuthGuard", () => {
	it("sends a person with no session to sign in", async () => {
		vi.spyOn(apiClient.auth, "me").mockRejectedValue(new ApiError(401, "Not signed in"))
		renderGuard(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
		expect(await screen.findByText("sign-in page")).toBeInTheDocument()
	})

	it("keeps the app on screen when a refetch of me fails without a 401, as the api restarting does", async () => {
		const client = knownSession()
		vi.spyOn(apiClient.auth, "me").mockRejectedValue(new ApiError(503, "Not signed in"))
		renderGuard(client)
		await client.invalidateQueries({ queryKey: QueryKeys.auth.me() })
		await waitFor(() => expect(client.getQueryState(QueryKeys.auth.me())?.status).toBe("error"))
		expect(screen.getByText("the app")).toBeInTheDocument()
		expect(screen.queryByText("sign-in page")).not.toBeInTheDocument()
	})

	it("signs a known session out when a refetch of me answers 401", async () => {
		const client = knownSession()
		vi.spyOn(apiClient.auth, "me").mockRejectedValue(new ApiError(401, "Not signed in"))
		renderGuard(client)
		void client.invalidateQueries({ queryKey: QueryKeys.auth.me() })
		expect(await screen.findByText("sign-in page")).toBeInTheDocument()
	})
})
