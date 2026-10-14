import { type AuditLookup, type AuditRow, type ClientChip, chipsOf, rowFromLedger, withinWindow } from "../auditModel"

import { useAuditWindow } from "@/features/audit/hooks/useAuditWindow"
import { useMe } from "@/features/auth/hooks/useMe"
import { useLedgerConnectionLookup } from "@/features/connections/hooks/useConnections"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"

export type AuditRowsState =
	| { status: "loading" }
	| { status: "forbidden" }
	| { status: "error"; message: string; retry: () => void }
	| { status: "ready"; rows: AuditRow[]; chips: ClientChip[]; refresh: () => void; refreshing: boolean }

/**
 * `ledger.activity` refuses everyone but a workspace admin, and it does so with the same generic
 * refusal every other Ledger call uses — so `me.isAdmin` is the one reliable signal for "not an
 * admin"; any other failure (network, 500, …) is a genuine error with a retry, not a refusal. The
 * window is also gated on it: a non-admin's browser never even calls the endpoint that refuses it.
 *
 * There is no per-artifact Revisions read here: `revisions.list` is itself a ledgered read (History
 * is a served read like any other), so resolving a row's revision id to a "vN" label would write a
 * new Ledger row for every distinct artifact Audit shows — the screen would pollute the log it
 * reads. `rowFromLedger` shows only what the activity row itself carries.
 */
export const useAuditRows = (): AuditRowsState => {
	const me = useMe()
	const isAdmin = me.data?.isAdmin === true
	const activity = useAuditWindow(isAdmin)
	const connections = useLedgerConnectionLookup()
	const artifacts = useArtifacts({ scope: "all" })

	if (me.isPending) return { status: "loading" }
	if (me.isError) return { status: "error", message: me.error.message, retry: () => void me.refetch() }
	if (!isAdmin) return { status: "forbidden" }

	if (activity.isPending) return { status: "loading" }
	if (activity.isError)
		return { status: "error", message: activity.error.message, retry: () => void activity.refetch() }

	const lookup: AuditLookup = {
		connections: new Map((connections.data ?? []).map((connection) => [connection.id, connection])),
		artifacts: new Map((artifacts.data ?? []).map((artifact) => [artifact.id, artifact])),
	}

	const rows = activity.items
		.filter((entry) => withinWindow(entry.startedAt))
		.map((entry) => rowFromLedger(entry, lookup))

	return {
		status: "ready",
		rows,
		chips: chipsOf(rows),
		refresh: () => void activity.refetch(),
		refreshing: activity.isFetching,
	}
}
