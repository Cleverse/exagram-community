import { createRouterClient } from "@orpc/server"
import { vi } from "vitest"

import type { User } from "@exagram/core/entity/auth"

import { createRateCounter } from "../mcp/rate"

import { createRevisionsRouter } from "./revisions.router"

import type { RateCounter } from "../mcp/rate"
import type { BaseContext } from "../plugins/context"
import type { RevisionBodyUsecase } from "../usecase/revision-body.usecase"
import type { RevisionPreviewUsecase } from "../usecase/revision-preview.usecase"
import type { RevisionsUsecase } from "../usecase/revisions/revisions.usecase"

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
export const revisionId = "44444444-4444-4444-8444-444444444444"

export const build = (signedOutRate: RateCounter = createRateCounter(100)) => {
	const revisionText = vi.fn(() => Promise.resolve({ revisionId, mime: "text/markdown", text: "one" }))
	const text = vi.fn(() => Promise.resolve({ revisionId, mime: "text/markdown", text: "one" }))
	const minted = { revisionId, url: "https://uc.exagram.test/uc/t", expiresInSeconds: 300 }
	const bodyTokenAt = vi.fn(() => Promise.resolve(minted))
	const bodyToken = vi.fn(() => Promise.resolve(minted))
	const previewToken = vi.fn(() => Promise.resolve(minted))
	const router = createRevisionsRouter({
		revisionsUsecase: { revisionText, text } as unknown as RevisionsUsecase,
		revisionBodyUsecase: { bodyTokenAt, bodyToken } as unknown as RevisionBodyUsecase,
		revisionPreviewUsecase: { previewToken } as unknown as RevisionPreviewUsecase,
		signedOutRate,
	})
	const clientFor = (user: User | null | undefined, ip = "203.0.113.7", cookie?: string) =>
		createRouterClient(router, {
			context: { headers: cookie === undefined ? {} : { cookie }, requestId: "r1", ip, user } as unknown as BaseContext,
		})
	return { revisionText, text, bodyTokenAt, bodyToken, previewToken, clientFor }
}
