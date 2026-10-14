import { type Grant } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { useSharedPeople } from "./useSharedPeople"

import { QueryKeys } from "@/config/queryKeys"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"
import { groupGrant, personGrant } from "@/test/grants"

const projectGrant = { artifactId: null, projectId: "p1", pinnedRevisionId: null, createdAt: new Date(2026, 0, 1) }

const person = (id: string, name: string): Grant =>
	personGrant({
		...projectGrant,
		id,
		granteeId: `${id}-user`,
		granteeEmail: `${id}@example.com`,
		granteeName: name,
		granteePending: false,
		role: "view",
	})

const design = groupGrant(
	{ id: "grp-design", name: "Design team", memberCount: 3 },
	{ ...projectGrant, id: "g-design", role: "view" },
)

const sharedPeople = (grants: Grant[]) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.grants.access("p1"), "owner")
	client.setQueryData(QueryKeys.grants.listForProject("p1"), grants)
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
	const artifact = artifactFixture({ ownerName: "Ada Lovelace", sharedWithNames: ["Grace Hopper"] })
	return renderHook(() => useSharedPeople(artifact, true), { wrapper }).result.current
}

describe("useSharedPeople", () => {
	it("lists the Owner, the file's people and the Project's people, each once", () => {
		expect(sharedPeople([person("g1", "Grace Hopper"), person("g2", "Alan Turing")])).toEqual([
			"Ada Lovelace",
			"Grace Hopper",
			"Alan Turing",
		])
	})

	it("leaves out a Group on the Project, which is no person", () => {
		expect(sharedPeople([person("g2", "Alan Turing"), design])).toEqual(["Ada Lovelace", "Grace Hopper", "Alan Turing"])
	})
})
