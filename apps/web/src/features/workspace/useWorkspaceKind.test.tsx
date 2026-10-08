import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { useWorkspaceKind, useWorkspaceOf } from "./useWorkspaceKind"

import { QueryKeys } from "@/config/queryKeys"
import { meActingIn } from "@/test/workspaces"

const kindFor = (me: unknown) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	queryClient.setQueryData(QueryKeys.auth.me(), me)
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return renderHook(() => useWorkspaceKind(), { wrapper }).result.current
}

describe("useWorkspaceKind", () => {
	it("reads the kind the server sends", () => {
		expect(kindFor({ workspaceName: "Acme", workspaceKind: "personal" })).toBe("personal")
		expect(kindFor({ workspaceName: "Acme", workspaceKind: "team" })).toBe("team")
	})

	it("falls back to team while me lacks the field", () => {
		expect(kindFor({ workspaceName: "Acme" })).toBe("team")
	})
})

const standingFor = (me: unknown, workspaceId: string) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	if (me !== undefined) queryClient.setQueryData(QueryKeys.auth.me(), me)
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return renderHook(() => useWorkspaceOf(workspaceId), { wrapper }).result.current
}

describe("useWorkspaceOf", () => {
	const team = { id: "w-team", kind: "team" } as const
	const personal = { id: "w-personal", kind: "personal" } as const

	it("reads the kind of a Workspace the person is in, whichever the session acts in", () => {
		const me = meActingIn(personal, [team])
		expect(standingFor(me, "w-team")).toEqual({ kind: "team", member: true })
		expect(standingFor(me, "w-personal")).toEqual({ kind: "personal", member: true })
	})

	it("gives a Guest on a Team file the narrowest kind while the session is in Personal", () => {
		expect(standingFor(meActingIn(personal), "w-someone-elses-team")).toEqual({ kind: "personal", member: false })
	})

	it("gives a Guest on a Personal file the narrowest kind, not the Team the session is in", () => {
		expect(standingFor(meActingIn(team), "w-someone-elses-personal")).toEqual({ kind: "personal", member: false })
	})

	it("takes the narrowest kind until me has loaded", () => {
		expect(standingFor(undefined, "w-team")).toEqual({ kind: "personal", member: false })
	})
})
