import { type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDefaultShareRole } from "./useGrants"

import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { edition as community } from "@/edition/edition"
import { sessionIn } from "@/test/workspaces"

const SESSION_WORKSPACE = "w-session"

const renderDefault = (sessionKind: WorkspaceKind, workspaceId: string | undefined) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.me(), {
		id: "u1",
		name: "Owner",
		email: "owner@example.test",
		...sessionIn(sessionKind, SESSION_WORKSPACE),
	})
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
	return { client, ...renderHook(() => useDefaultShareRole(workspaceId), { wrapper }) }
}

afterEach(() => vi.restoreAllMocks())

describe("useDefaultShareRole in Community", () => {
	beforeEach(() => {
		if ((edition as unknown) !== community)
			vi.spyOn(edition, "useTeamDefaultShareRole").mockImplementation((enabled) =>
				community.useTeamDefaultShareRole(enabled),
			)
	})

	it("starts a share in the session's Team at Collaborator, without asking for joining settings", () => {
		const { result, client } = renderDefault("team", SESSION_WORKSPACE)
		expect(result.current).toBe("collaborate")
		expect(client.getQueryCache().findAll({ queryKey: QueryKeys.workspace.joining() })).toHaveLength(0)
	})

	it.each([
		["a Personal session", "personal", SESSION_WORKSPACE],
		["a file in another Workspace than the session's", "team", "w-other"],
		["a file whose Workspace is not known yet", "team", undefined],
	] as const)("has no Team default for %s", (_name, sessionKind, workspaceId) => {
		expect(renderDefault(sessionKind, workspaceId).result.current).toBeUndefined()
	})
})
