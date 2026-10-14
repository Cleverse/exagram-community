import { type AuthProviders, NO_CAPABILITIES } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { type ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { useGoogleLink } from "./useGoogleLink"

import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { asCommunityProviders } from "@/test/edition"

const providers = (google: boolean): AuthProviders => ({
	google,
	apple: false,
	appleNative: false,
	emailCode: false,
	signUp: true,
	aiEdit: true,
	edition: "community",
	capabilities: NO_CAPABILITIES,
})

const shownFor = (google: boolean, googleLinked: boolean) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.providers(), providers(google))
	client.setQueryData(QueryKeys.auth.me(), { googleLinked })
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
	return renderHook(() => useGoogleLink(), { wrapper }).result.current.shown
}

describe("useGoogleLink", () => {
	it("skips Google in Settings when the install has none and the account holds none", () => {
		asCommunityProviders()
		expect(shownFor(false, false)).toBe(false)
		expect(shownFor(false, true)).toBe(true)
		expect(shownFor(true, false)).toBe(true)
	})

	it.skipIf(edition.followsProviders)("always lists Google, whatever the install answers", () => {
		expect(shownFor(false, false)).toBe(true)
		expect(shownFor(false, true)).toBe(true)
		expect(shownFor(true, false)).toBe(true)
	})
})
