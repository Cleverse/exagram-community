import { createRouterClient } from "@orpc/server"
import { vi } from "vitest"

import type { ReadableArtifact } from "@exagram/core/entity/artifact"
import type { User } from "@exagram/core/entity/auth"

import { createRateCounter } from "../mcp/rate"

import { createArtifactsRouter } from "./artifacts.router"

import type { RateCounter } from "../mcp/rate"
import type { BaseContext } from "../plugins/context"
import type { AnyoneUsecase } from "../usecase/artifacts/anyone.usecase"
import type { ArtifactsUsecase } from "../usecase/artifacts/artifacts.usecase"
import type { SearchUsecase } from "../usecase/artifacts/search.usecase"

export const owner: User = {
	id: "11111111-1111-4111-8111-111111111111",
	workspaceId: "22222222-2222-4222-8222-222222222222",
	email: "owner@example.com",
	name: "Owner",
	isAdmin: false,
	googleLinked: false,
	createdAt: new Date(),
}
export const artifactId = "33333333-3333-4333-8333-333333333333"
export const otherId = "55555555-5555-4555-8555-555555555555"

export const readable = (id: string): ReadableArtifact => ({
	id,
	workspaceId: owner.workspaceId,
	ownerId: owner.id,
	projectId: null,
	kind: "doc",
	title: "Plan",
	defaultPin: "latest",
	publishPolicy: null,
	generalAccess: "anyone",
	deletedAt: null,
	createdAt: new Date(),
	workspaceName: "Acme",
	orgDomain: null,
	visibleRevisionId: "44444444-4444-4444-8444-444444444444",
	access: "view",
	effectivePublishPolicy: "auto",
	isPinned: false,
	revisionSeq: 1,
	extractionStatus: null,
	updatedAt: new Date(),
	ownerName: "Owner",
	sharedCount: 0,
	sharedWithNames: [],
	canDownload: true,
	anyoneSettings: null,
})

/** Every other hex letter upper-cased, a spelling of the same UUID. */
export const mixedCase = (id: string): string =>
	id.replace(/[a-f]/g, (letter, at: number) => (at % 2 === 0 ? letter.toUpperCase() : letter))

/** What a test reads of the response headers; named so the exported `build` needs no undici type. */
interface ResponseHeaders {
	get(name: string): string | null
}

export const build = (
	signedOutRate: RateCounter,
	options: { unlockPerIp?: number; unlockPerArtifact?: number; secure?: boolean } = {},
) => {
	const get = vi.fn<(reader: unknown, id: string, unlockHash?: string) => Promise<ReadableArtifact>>((_reader, id) =>
		Promise.resolve(readable(id)),
	)
	const duplicate = vi.fn<ArtifactsUsecase["duplicate"]>()
	const list = vi.fn<ArtifactsUsecase["list"]>().mockResolvedValue([readable(artifactId)])
	const search = vi.fn<SearchUsecase["search"]>().mockResolvedValue([])
	const unlock = vi.fn<AnyoneUsecase["unlock"]>().mockResolvedValue({ token: "cookie-value", ttlSeconds: 86_400 })
	const setSettings = vi.fn<AnyoneUsecase["setSettings"]>().mockResolvedValue(readable(artifactId))
	const router = createArtifactsRouter({
		artifactsUsecase: { get, list, duplicate } as unknown as ArtifactsUsecase,
		anyoneUsecase: { unlock, setSettings } as unknown as AnyoneUsecase,
		searchUsecase: { search } as unknown as SearchUsecase,
		signedOutRate,
		unlockIpRate: createRateCounter(options.unlockPerIp ?? 100),
		unlockArtifactRate: createRateCounter(options.unlockPerArtifact ?? 100),
		cookieSecure: options.secure ?? false,
	})
	const clientFor = (user: User | null, ip = "203.0.113.7", cookie?: string) => {
		const resHeaders = new Headers()
		const client = createRouterClient(router, {
			context: {
				headers: cookie === undefined ? {} : { cookie },
				requestId: "r1",
				ip,
				user,
				resHeaders,
			} as unknown as BaseContext,
		})
		return Object.assign(client, { resHeaders: resHeaders as ResponseHeaders })
	}
	return { get, duplicate, list, search, unlock, setSettings, clientFor }
}
