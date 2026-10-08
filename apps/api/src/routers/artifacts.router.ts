import { artifactsContract } from "@exagram/core/contract/artifacts/contract"
import { RateLimitedError } from "@exagram/core/utils/errors"
import { implement } from "@orpc/server"

import { limitSignedOutReads, readerOf } from "../plugins/reader"
import { requireUser } from "../plugins/require-user.middleware"
import { buildUnlockCookie, unlockHashOf } from "../plugins/unlock-cookie"

import type { RateCounter } from "../mcp/rate"
import type { BaseContext } from "../plugins/context"
import type { AnyoneUsecase } from "../usecase/artifacts/anyone.usecase"
import type { ArtifactsUsecase } from "../usecase/artifacts/artifacts.usecase"
import type { SearchUsecase } from "../usecase/artifacts/search.usecase"

/** Password guesses from one IP across every Artifact; each one runs argon2. */
export const UNLOCKS_PER_MINUTE_PER_IP = 10
/** Password guesses at one Artifact from anywhere, so many addresses cannot add up to a brute force. */
export const UNLOCKS_PER_MINUTE_PER_ARTIFACT = 30

/**
 * Both budgets are taken before any lookup, so an existing Artifact and a missing one cost the same. The
 * Artifact's budget is keyed by the lower-cased id: a UUID has many spellings, and each would otherwise be
 * a fresh budget.
 */
export function checkUnlockRate(ipRate: RateCounter, artifactRate: RateCounter, ip: string, artifactId: string): void {
	if (!ipRate.take(ip)) throw new RateLimitedError(`Unlocking is limited to ${ipRate.perMinute} tries per minute.`)
	if (!artifactRate.take(artifactId.toLowerCase())) {
		throw new RateLimitedError(`Unlocking this file is limited to ${artifactRate.perMinute} tries per minute.`)
	}
}

interface ArtifactsRouterParams {
	artifactsUsecase: ArtifactsUsecase
	anyoneUsecase: AnyoneUsecase
	searchUsecase: SearchUsecase
	/** Shared with the revisions router: one per-IP budget across every signed-out read. */
	signedOutRate: RateCounter
	unlockIpRate: RateCounter
	unlockArtifactRate: RateCounter
	/** The session cookie's own rule, so an Unlock is Secure exactly when a session is. */
	cookieSecure: boolean
}

/**
 * `get` is the one procedure here a session is not required for:
 * signed out, it reads as the anonymous reader, which the boundary admits only to an Artifact open to anyone
 * with the link (ADR 0042), within the per-IP budget.
 */
export const createArtifactsRouter = ({
	artifactsUsecase,
	anyoneUsecase,
	searchUsecase,
	signedOutRate,
	unlockIpRate,
	unlockArtifactRate,
	cookieSecure,
}: ArtifactsRouterParams) => {
	const os = implement(artifactsContract).$context<BaseContext>()
	const authed = os.use(requireUser)
	const open = os.use(limitSignedOutReads(signedOutRate))
	// Unlock spends its own budgets instead of the signed-out one.
	const unlockable = os

	return os.router({
		list: authed.list.handler(async ({ context, input }) => ({
			result: { items: await artifactsUsecase.list(context.user, input.query) },
		})),
		get: open.get.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.get(
				readerOf(context.user, input.params.id),
				input.params.id,
				unlockHashOf(context.headers, input.params.id),
			),
		})),
		create: authed.create.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.create(context.user, input.body),
		})),
		finalize: authed.finalize.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.finalize(context.user, {
				artifactId: input.params.id,
				storageKey: input.body.storageKey,
				sha256: input.body.sha256,
				bytes: input.body.bytes,
				note: input.body.note,
			}),
		})),
		duplicate: authed.duplicate.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.duplicate(context.user, {
				artifactId: input.params.id,
				unlockHash: unlockHashOf(context.headers, input.params.id),
			}),
		})),
		move: authed.move.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.move(context.user, {
				artifactId: input.params.id,
				projectId: input.body.projectId,
			}),
		})),
		setPublishPolicy: authed.setPublishPolicy.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.setPublishPolicy(context.user, {
				artifactId: input.params.id,
				publishPolicy: input.body.publishPolicy,
			}),
		})),
		setGeneralAccess: authed.setGeneralAccess.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.setGeneralAccess(context.user, {
				artifactId: input.params.id,
				generalAccess: input.body.generalAccess,
			}),
		})),
		setAnyoneSettings: authed.setAnyoneSettings.handler(async ({ context, input }) => ({
			result: await anyoneUsecase.setSettings(context.user, { artifactId: input.params.id, ...input.body }),
		})),
		unlock: unlockable.unlock.handler(async ({ context, input }) => {
			checkUnlockRate(unlockIpRate, unlockArtifactRate, context.ip, input.params.id)
			const { token, ttlSeconds } = await anyoneUsecase.unlock(
				readerOf(context.user, input.params.id),
				input.params.id,
				input.body.password,
			)
			context.resHeaders?.append("set-cookie", buildUnlockCookie(input.params.id, token, ttlSeconds, cookieSecure))
			return { result: { unlocked: true as const } }
		}),
		softDelete: authed.softDelete.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.softDelete(context.user, input.params.id),
		})),
		restore: authed.restore.handler(async ({ context, input }) => ({
			result: await artifactsUsecase.restore(context.user, input.params.id),
		})),
		search: authed.search.handler(async ({ context: { user }, input }) => ({
			result: {
				items: (
					await searchUsecase.search({
						principalKind: "user",
						principalId: user.id,
						surface: "web",
						workspaceId: user.workspaceId,
						q: input.query.q,
						projectId: input.query.projectId ?? null,
						limit: input.query.limit,
					})
				).map((hit) => ({
					artifactId: hit.artifactId,
					revisionId: hit.revisionId,
					title: hit.title,
					kind: hit.kind,
					projectId: hit.projectId,
					snippet: hit.snippet,
				})),
			},
		})),
	})
}
