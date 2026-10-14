import { type Notification, type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { type ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { vi } from "vitest"

import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { stateScopeOf } from "@/features/workspace/stateScope"
import { sessionIn } from "@/test/workspaces"

export const ARTIFACT = "00000000-0000-4000-8000-00000000000a"
export const OTHER_ARTIFACT = "00000000-0000-4000-8000-00000000000b"

export const SCOPE = stateScopeOf({ id: "u1", workspaceId: "w1" })

export const renderAsMember = (
	ui: ReactNode,
	{
		kind = "team",
		userId = "u1",
		seed,
	}: { kind?: WorkspaceKind; userId?: string; seed?: (client: QueryClient) => void } = {},
) => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
	})
	client.setQueryData(QueryKeys.auth.me(), {
		id: userId,
		email: "grace@example.com",
		name: "Grace Hopper",
		...sessionIn(kind, "w1"),
	})
	seed?.(client)
	const invalidate = vi.spyOn(client, "invalidateQueries")
	render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<MemoryRouter>{ui}</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
	return { client, invalidate }
}

export const decision = (over: Partial<Notification> = {}): Notification => ({
	id: "00000000-0000-4000-8000-0000000000d1",
	kind: "decision",
	artifactId: ARTIFACT,
	projectId: null,
	title: "",
	actorName: null,
	revision: null,
	role: null,
	outcome: "declined",
	subject: "accessRequest",
	note: null,
	createdAt: new Date(),
	...over,
})

export const feedOf = (items: Notification[], next: string | null = null) => ({
	items,
	serverTime: new Date(),
	next,
})
