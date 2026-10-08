import { revisionsContract } from "@exagram/core/contract/revisions/contract"
import { implement } from "@orpc/server"

import { limitSignedOutReads, readerOf } from "../plugins/reader"
import { requireUser } from "../plugins/require-user.middleware"
import { unlockHashOf } from "../plugins/unlock-cookie"

import type { RateCounter } from "../mcp/rate"
import type { BaseContext } from "../plugins/context"
import type { RevisionBodyUsecase } from "../usecase/revision-body.usecase"
import type { RevisionPreviewUsecase } from "../usecase/revision-preview.usecase"
import type { RevisionsUsecase } from "../usecase/revisions/revisions.usecase"

export const createRevisionsRouter = ({
	revisionsUsecase,
	revisionBodyUsecase,
	revisionPreviewUsecase,
	signedOutRate,
}: {
	revisionsUsecase: RevisionsUsecase
	revisionBodyUsecase: RevisionBodyUsecase
	revisionPreviewUsecase: RevisionPreviewUsecase
	/** Shared with the artifacts router: one per-IP budget across every signed-out read. */
	signedOutRate: RateCounter
}) => {
	const os = implement(revisionsContract).$context<BaseContext>()
	const authed = os.use(requireUser)
	const open = os.use(limitSignedOutReads(signedOutRate))

	// `text` and `bodyToken` are the two procedures here a session is not required for: signed out, they
	// read as the anonymous reader, which the boundary admits only to an Artifact open to anyone with the
	// link (ADR 0042), within the per-IP budget. Every other procedure keeps `requireUser`.
	return os.router({
		list: authed.list.handler(async ({ context, input }) => ({
			result: { items: await revisionsUsecase.list(context.user, input.params.artifactId) },
		})),
		createUploadTicket: authed.createUploadTicket.handler(async ({ context, input }) => ({
			result: await revisionsUsecase.createUploadTicket(context.user, {
				artifactId: input.params.artifactId,
				mime: input.body.mime,
				bytes: input.body.bytes,
			}),
		})),
		finalize: authed.finalize.handler(async ({ context, input }) => ({
			result: await revisionsUsecase.finalize(context.user, {
				artifactId: input.params.artifactId,
				storageKey: input.body.storageKey,
				sha256: input.body.sha256,
				bytes: input.body.bytes,
				note: input.body.note,
			}),
		})),
		restoreAsNew: authed.restoreAsNew.handler(async ({ context, input }) => ({
			result: await revisionsUsecase.restoreAsNew(context.user, {
				artifactId: input.params.artifactId,
				revisionId: input.params.revisionId,
			}),
		})),
		text: open.text.handler(async ({ context, input }) => ({
			result: await revisionsUsecase.text(
				readerOf(context.user, input.params.artifactId),
				input.params.artifactId,
				unlockHashOf(context.headers, input.params.artifactId),
			),
		})),
		revisionText: authed.revisionText.handler(async ({ context, input }) => ({
			result: await revisionsUsecase.revisionText(
				context.user,
				input.params.artifactId,
				input.params.revisionId,
				unlockHashOf(context.headers, input.params.artifactId),
			),
		})),
		bodyToken: open.bodyToken.handler(async ({ context, input }) => ({
			result: await revisionBodyUsecase.bodyToken(
				readerOf(context.user, input.params.artifactId),
				input.params.artifactId,
				unlockHashOf(context.headers, input.params.artifactId),
			),
		})),
		bodyTokenAt: authed.bodyTokenAt.handler(async ({ context: { user, headers }, input }) => ({
			result: await revisionBodyUsecase.bodyTokenAt(
				user,
				input.params.artifactId,
				input.params.revisionId,
				unlockHashOf(headers, input.params.artifactId),
			),
		})),
		previewToken: authed.previewToken.handler(async ({ context: { user, headers }, input }) => ({
			result: await revisionPreviewUsecase.previewToken(
				user,
				input.params.artifactId,
				unlockHashOf(headers, input.params.artifactId),
			),
		})),
	})
}
