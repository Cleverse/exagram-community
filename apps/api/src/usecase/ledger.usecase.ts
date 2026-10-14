import { RefusalError } from "@exagram/core/utils/refusal"

import type { LedgerCursor, LedgerDatagateway, LedgerRow } from "@exagram/core/datagateway/ledger.datagateway"
import type { User } from "@exagram/core/entity/auth"
import type { ActivityPage, ArtifactViewer, LedgerEntry, LedgerPage } from "@exagram/core/entity/ledger"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

export interface LedgerPageInput {
	limit: number
	cursor?: string
}

// The cursor is opaque to clients: the last serve row's started_at (microsecond UTC), call id and
// serve id. Anything else — a cursor from before serve-row paging included — is refused, not guessed at.
const CURSOR_STARTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const encodeCursor = (cursor: LedgerCursor): string => `${cursor.startedAt}|${cursor.callId}|${cursor.serveId}`

const decodeCursor = (cursor: string | undefined): LedgerCursor | null => {
	if (cursor === undefined) return null
	const [startedAt, callId, serveId, ...rest] = cursor.split("|")
	if (rest.length > 0 || startedAt === undefined || callId === undefined || serveId === undefined) {
		throw new RefusalError()
	}
	if (!CURSOR_STARTED_AT.test(startedAt) || !UUID.test(callId) || !UUID.test(serveId)) throw new RefusalError()
	return { startedAt, callId, serveId }
}

export class LedgerUsecase {
	constructor(
		private readonly ledger: LedgerDatagateway,
		private readonly serve: ServeService,
	) {}

	async forArtifact(userId: string, artifactId: string, input: LedgerPageInput): Promise<LedgerPage> {
		const resolution = await this.serve.resolveUnledgered({ kind: "user", id: userId }, artifactId)
		if (resolution === null || resolution.access !== "owner") throw new RefusalError()
		const rows = await this.ledger.listForArtifact(artifactId, input.limit, decodeCursor(input.cursor))
		return this.page(rows, input.limit)
	}

	/** Owner only, like the Ledger it is folded from: who has opened this Artifact, and when. */
	async viewers(userId: string, artifactId: string): Promise<ArtifactViewer[]> {
		const resolution = await this.serve.resolveUnledgered({ kind: "user", id: userId }, artifactId)
		if (resolution === null || resolution.access !== "owner") throw new RefusalError()
		return this.ledger.listArtifactViewers(artifactId)
	}

	async activity(user: Pick<User, "workspaceId" | "isAdmin">, input: LedgerPageInput): Promise<ActivityPage> {
		if (!user.isAdmin) throw new RefusalError()
		const rows = await this.ledger.listActivity(user.workspaceId, input.limit, decodeCursor(input.cursor))
		return this.page(rows, input.limit)
	}

	private page<T extends LedgerEntry>(rows: LedgerRow<T>[], limit: number): { items: T[]; nextCursor: string | null } {
		const last = rows.at(-1)
		// A full page means there may be more; keyset on (started_at, call id, serve id) so a page can end
		// inside one call's rows and equal timestamps still order.
		const nextCursor = rows.length === limit && last ? encodeCursor(last.cursor) : null
		return { items: rows.map((row) => row.entry), nextCursor }
	}
}
