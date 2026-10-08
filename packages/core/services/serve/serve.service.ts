import { AnyoneExpiredError, PasswordRequiredError } from "../../utils/errors"
import { MemberRemovedError, RefusalError } from "../../utils/refusal"

import type { ResolvedRevision, RevisionTextReader, ServePort, ServeRead } from "./serve.port"
import type { LinksDatagateway } from "../../datagateway/links.datagateway"
import type { TransactionManager } from "../../datagateway/transaction.datagateway"
import type { Boundary, VisibilityDatagateway, VisibleArtifact } from "../../datagateway/visibility.datagateway"
import type { AnyoneGate } from "../../entity/artifact"
import type { Access, LedgeredPrincipal, Principal, Surface, WithheldReason } from "../../entity/principal"
import type { DomainError } from "../../utils/errors"
import type { LedgerService } from "../ledger/ledger.service"
import type { Sql } from "postgres"

export interface ResolvedServe {
	callId: string
	artifactId: string
	revisionId: string | null
	access: Access
}

/** What a reader the 'anyone' gate stopped is told, and what the Ledger records of it (ADR 0044). */
const GATE_OUTCOME: Record<AnyoneGate, { reason: WithheldReason; error: () => DomainError }> = {
	password: { reason: "password-required", error: () => new PasswordRequiredError() },
	expired: { reason: "expired", error: () => new AnyoneExpiredError() },
}

export class ServeService implements ServePort {
	constructor(
		private readonly visibility: VisibilityDatagateway,
		private readonly ledger: LedgerService,
		private readonly tx: TransactionManager,
		private readonly links?: LinksDatagateway,
		private readonly revisionText?: RevisionTextReader,
	) {}

	/**
	 * One read of one Artifact. The call row and the serve row are written in the same transaction as the
	 * boundary lookup; the withheld unit is committed and only then refused, so the refusal keeps its row.
	 */
	async resolve(input: {
		principal: LedgeredPrincipal
		surface: Surface
		action: string
		artifactId: string
		requireRevision: boolean
		/** The sha256 of the reader's unlock cookie for this Artifact (ADR 0044). */
		unlockHash?: string
	}): Promise<ResolvedServe> {
		const outcome = await this.tx.atomic(async () => {
			const callId = await this.ledger.openCall({
				principal: input.principal,
				surface: input.surface,
				action: input.action,
			})
			const visible = await this.visibility.getVisible(input.principal, input.artifactId, {
				unlockHash: input.unlockHash,
			})
			const miss = visible ? null : await this.explainMiss(input.principal, input.artifactId, input.unlockHash)
			const withheldReason =
				miss?.reason ?? (input.requireRevision && visible?.revisionId === null ? "no-approved-revision" : null)

			if (withheldReason !== null) {
				await this.ledger.recordServe({
					callId,
					artifactId: input.artifactId,
					revisionId: null,
					outcome: "withheld",
					reason: withheldReason,
					form: null,
					detectorVersion: null,
				})
				await this.ledger.settle({ callId, status: "failed", bodySha256: null })
				return { served: false as const, error: miss?.error ?? new RefusalError() }
			}

			await this.ledger.recordServe({
				callId,
				artifactId: input.artifactId,
				revisionId: visible!.revisionId,
				outcome: "served",
				reason: null,
				form: null,
				detectorVersion: null,
			})
			await this.ledger.settle({ callId, status: "delivered", bodySha256: null })
			return {
				served: true as const,
				value: { callId, artifactId: input.artifactId, revisionId: visible!.revisionId, access: visible!.access },
			}
		})

		if (!outcome.served) throw outcome.error
		return outcome.value
	}

	/**
	 * A boundary miss is a plain refusal unless the reader met the 'anyone' gate, which answers
	 * it by name and is recorded under its own reason (ADR 0044). The gate is asked on every miss, so an
	 * existing Artifact and a missing one cost the same.
	 */
	private async explainMiss(
		principal: Principal,
		artifactId: string,
		unlockHash: string | undefined,
	): Promise<{ reason: WithheldReason; error: DomainError }> {
		const gate = await this.visibility.anyoneGate(principal, artifactId, unlockHash)
		if (gate === null) return { reason: "out-of-boundary", error: new RefusalError() }
		const { reason, error } = GATE_OUTCOME[gate]
		return { reason, error: error() }
	}

	/**
	 * `ServePort`. The ledger rows are `serve()`'s, so a rewrite that never happens still leaves the
	 * read it was based on in the Ledger. Withheld, absent, gated and bodyless all answer null.
	 */
	async resolveRevisionText(input: ServeRead): Promise<ResolvedRevision | null> {
		if (!this.revisionText) throw new Error("ServeService was built without a RevisionTextReader")
		try {
			return await this.serve(
				{
					principal: input.principal,
					surface: input.surface,
					action: input.action,
					artifactId: input.artifactId,
					unlockHash: input.unlockHash,
				},
				async (_tx, visible, callId) => {
					if (visible.revisionId === null) throw new RefusalError()
					const body = await this.revisionText!.readText({
						principal: input.principal,
						artifactId: visible.artifactId,
						revisionId: visible.revisionId,
						unlockHash: input.unlockHash,
					})
					if (!body) throw new RefusalError()
					return {
						artifactId: visible.artifactId,
						revisionId: visible.revisionId,
						kind: body.kind,
						access: visible.access,
						text: body.text,
						callId,
					} satisfies ResolvedRevision
				},
			)
		} catch (error) {
			if (
				error instanceof RefusalError ||
				error instanceof PasswordRequiredError ||
				error instanceof AnyoneExpiredError
			) {
				return null
			}
			throw error
		}
	}

	/** A refusal that never reached the boundary still owes the ledger a call row and a withheld row. */
	async recordWithheld(input: {
		principal: LedgeredPrincipal
		surface: Surface
		action: string
		artifactId: string
		reason: WithheldReason
	}): Promise<void> {
		await this.recordCall(input)
	}

	/**
	 * A call that names an Artifact without serving any Revision of it, such as an unlock attempt (ADR 0044):
	 * `reason: null` is a served row with no Revision, anything else a withheld one.
	 */
	async recordCall(input: {
		principal: LedgeredPrincipal
		surface: Surface
		action: string
		artifactId: string
		reason: WithheldReason | null
	}): Promise<void> {
		await this.tx.atomic(async () => {
			const callId = await this.ledger.openCall({
				principal: input.principal,
				surface: input.surface,
				action: input.action,
			})
			await this.ledger.recordServe({
				callId,
				artifactId: input.artifactId,
				revisionId: null,
				outcome: input.reason === null ? "served" : "withheld",
				reason: input.reason,
				form: null,
				detectorVersion: null,
			})
			await this.ledger.settle({
				callId,
				status: input.reason === null ? "delivered" : "failed",
				bodySha256: null,
			})
		})
	}

	/**
	 * The boundary, unledgered. Only for owner-only management reads — Grant lists, Link lists,
	 * Ledger reads — that answer a question about an Artifact without serving any part of it. Any
	 * path that returns a body, a text, or a body token uses `resolve()` or `serve()` instead.
	 */
	async resolveUnledgered(
		principal: Principal,
		artifactId: string,
		unlockHash?: string,
	): Promise<VisibleArtifact | null> {
		return this.visibility.getVisible(principal, artifactId, { unlockHash })
	}

	/**
	 * One read of one Artifact whose body work must join the ledger's transaction. `fn` receives the
	 * open connection, the row the boundary returned and the id of the call, and runs before the
	 * serve row is written, so work that fails leaves no row claiming a read happened.
	 *
	 * The withheld row must survive the refusal, so the transaction commits either way and the
	 * refusal is thrown after it; throwing inside the unit would roll the evidence back.
	 *
	 * A non-refusal error thrown by `fn` (a bad request, a store failure) rolls the whole unit back, call
	 * row included: nothing was served, so nothing may say it was.
	 *
	 * `revisionId` names the Revision a read asked for when it is not simply the one the boundary
	 * resolved (History's per-Revision text). The served row records it. A refusal of such a read records
	 * no Revision at all (`revisionId: null`): the boundary's Current Revision was not what was asked
	 * for, and naming the requested one would log an id the reader may not know exists.
	 *
	 * `requireRevision` withholds an Artifact with no approved Revision as `no-approved-revision`, the
	 * way `resolve()` does, before `fn` runs.
	 *
	 * `boundary` names the SQL function that answers (`visible` unless given). A reader the narrower
	 * `commentable` boundary leaves out is withheld `out-of-boundary`, the same row and refusal as one
	 * the Artifact is not visible to at all.
	 *
	 * `unlockHash` is forwarded to the boundary as it is. A reader that the 'anyone' gate stopped is
	 * withheld `password-required` or `expired` and gets the matching error, not the refusal (ADR 0044).
	 */
	async serve<T>(
		input: {
			principal: LedgeredPrincipal
			surface: Surface
			action: string
			artifactId: string
			revisionId?: string
			requireRevision?: boolean
			boundary?: Boundary
			unlockHash?: string
		},
		fn: (tx: Sql, resolution: VisibleArtifact, callId: string) => Promise<T>,
	): Promise<T> {
		const outcome = await this.tx.atomic(async () => {
			const callId = await this.ledger.openCall({
				principal: input.principal,
				surface: input.surface,
				action: input.action,
			})
			const visible = await this.visibility.getVisible(input.principal, input.artifactId, {
				boundary: input.boundary,
				unlockHash: input.unlockHash,
			})

			if (visible === null || (input.requireRevision === true && visible.revisionId === null)) {
				const miss =
					visible === null ? await this.explainMiss(input.principal, input.artifactId, input.unlockHash) : null
				await this.ledger.recordServe({
					callId,
					artifactId: input.artifactId,
					revisionId: null,
					outcome: "withheld",
					reason: miss?.reason ?? "no-approved-revision",
					form: null,
					detectorVersion: null,
				})
				await this.ledger.settle({ callId, status: "failed", bodySha256: null })
				return { served: false as const, error: miss?.error ?? new RefusalError() }
			}

			// `fn` may refuse — a pending-only revision, a body the store lost. That refusal must leave
			// its withheld row behind, so it is turned into a value here and thrown after the commit.
			let value: T
			try {
				value = await fn(this.tx.current(), visible, callId)
			} catch (error) {
				if (!(error instanceof RefusalError || error instanceof MemberRemovedError)) throw error
				await this.ledger.recordServe({
					callId,
					artifactId: visible.artifactId,
					revisionId: input.revisionId === undefined ? visible.revisionId : null,
					outcome: "withheld",
					reason: "refused-in-serve",
					form: null,
					detectorVersion: null,
				})
				await this.ledger.settle({ callId, status: "failed", bodySha256: null })
				return { served: false as const, error: new RefusalError() }
			}

			await this.ledger.recordServe({
				callId,
				artifactId: visible.artifactId,
				revisionId: input.revisionId ?? visible.revisionId,
				outcome: "served",
				reason: null,
				form: null,
				detectorVersion: null,
			})
			await this.ledger.settle({ callId, status: "delivered", bodySha256: null })
			return { served: true as const, value }
		})

		if (!outcome.served) throw outcome.error
		return outcome.value
	}

	/**
	 * One anonymous open of a Link: the boundary answers, the view is claimed and the ledger row is
	 * written in one transaction, so a refused open cannot spend a view and a spent view cannot go
	 * unrecorded. The claim is an UPDATE with the limit in its WHERE, so two concurrent opens at the
	 * limit cannot both win. A withheld row still names the Link's Artifact, which is why the gateway
	 * has `findTarget`: the boundary returns nothing for a dead Link, so the id has to come from the
	 * row itself.
	 */
	async serveLink<T>(
		input: { linkId: string; action: string },
		fn: (tx: Sql, resolution: VisibleArtifact, callId: string) => Promise<T>,
	): Promise<T> {
		if (this.links === undefined) throw new Error("ServeService was built without a links gateway")
		const links = this.links

		const outcome = await this.tx.atomic(async () => {
			const callId = await this.ledger.openCall({
				principal: { kind: "link", id: input.linkId },
				surface: "link",
				action: input.action,
			})

			const withheld = async (reason: WithheldReason) => {
				const target = await links.findTarget(input.linkId)
				await this.ledger.recordServe({
					callId,
					artifactId: target?.artifactId ?? input.linkId,
					revisionId: target?.revisionId ?? null,
					outcome: "withheld",
					reason,
					form: null,
					detectorVersion: null,
				})
				await this.ledger.settle({ callId, status: "failed", bodySha256: null })
				return { ok: false as const }
			}

			const [visible] = await this.visibility.listVisible({ kind: "link", id: input.linkId })
			if (visible === undefined || visible.revisionId === null) {
				const exhausted = await links.isExhausted(input.linkId)
				return withheld(exhausted ? "link-exhausted" : "out-of-boundary")
			}

			const claimed = await links.claimView(this.tx.current(), input.linkId)
			if (claimed === null) return withheld("link-exhausted")

			let value: T
			try {
				value = await fn(this.tx.current(), visible, callId)
			} catch (error) {
				if (!(error instanceof RefusalError || error instanceof MemberRemovedError)) throw error
				// The view was claimed before `fn` ran, so a refusal here still spends it: the Link
				// was opened, and the Ledger says what the opener got.
				return withheld("refused-in-serve")
			}

			await this.ledger.recordServe({
				callId,
				artifactId: visible.artifactId,
				revisionId: visible.revisionId,
				outcome: "served",
				reason: null,
				form: null,
				detectorVersion: null,
			})
			await this.ledger.settle({ callId, status: "delivered", bodySha256: null })
			return { ok: true as const, value }
		})

		if (!outcome.ok) throw new RefusalError()
		return outcome.value
	}

	/** Records the digest of the body this call served. Call it only from inside a serve callback. */
	async recordBodyDigest(callId: string, bodySha256: string): Promise<void> {
		await this.ledger.recordBodyDigest(callId, bodySha256)
	}

	/** One call row for the list, one serve row per Artifact the boundary returned. */
	async resolveList<T>(input: {
		principal: LedgeredPrincipal
		surface: Surface
		action: string
		resolve: () => Promise<T[]>
		toServe: (row: T) => { artifactId: string; revisionId: string | null }
	}): Promise<{ callId: string; rows: T[] }> {
		return this.tx.atomic(async () => {
			const callId = await this.ledger.openCall({
				principal: input.principal,
				surface: input.surface,
				action: input.action,
			})
			const rows = await input.resolve()
			for (const row of rows) {
				const served = input.toServe(row)
				await this.ledger.recordServe({
					callId,
					...served,
					outcome: "served",
					reason: null,
					form: null,
					detectorVersion: null,
				})
			}
			await this.ledger.settle({ callId, status: "delivered", bodySha256: null })
			return { callId, rows }
		})
	}
}
