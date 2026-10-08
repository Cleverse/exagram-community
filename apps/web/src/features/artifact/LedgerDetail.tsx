import { type LedgerEntry } from "@exagram/api-client"

import { formatWhen } from "@/utils/format"

const SURFACE_LABEL: Record<string, string> = {
	web: "Web",
	mcp: "Connection",
	link: "Link",
}

/**
 * Presentation only. `revisionLabel` resolves an id to `v{seq}` (owner, seq known) or an 8-char id
 * (admin, or an id the caller can't map); `currentRevisionId` undefined means the caller has no
 * notion of current at all (admin), so the served field never claims current/superseded.
 */
export const LedgerDetail = ({
	row,
	revisionLabel,
	currentRevisionId,
}: {
	row: LedgerEntry
	revisionLabel: (revisionId: string) => string
	currentRevisionId?: string | null
}) => {
	const revisionServed =
		row.revisionId === null
			? "—"
			: currentRevisionId === undefined
				? revisionLabel(row.revisionId)
				: `${revisionLabel(row.revisionId)} · ${row.revisionId === currentRevisionId ? "current" : "superseded"}`

	return (
		<div className="bg-ground-raised grid grid-cols-2 gap-6 px-4 py-4">
			<div>
				<p className="mono-label mb-1">Request</p>
				<p className="text-sm font-medium">{row.action}</p>
				<p className="text-muted text-sm">{SURFACE_LABEL[row.surface] ?? row.surface}</p>
				<p className="text-muted text-sm">
					principal: {row.principalKind} {row.principalId.slice(0, 8)}
				</p>
			</div>
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
				<dt className="text-muted">Revision served</dt>
				<dd>{revisionServed}</dd>
				<dt className="text-muted">Status</dt>
				<dd>{row.status}</dd>
				<dt className="text-muted">Started</dt>
				<dd>{formatWhen(row.startedAt)}</dd>
				<dt className="text-muted">Delivered</dt>
				<dd>{formatWhen(row.deliveredAt)}</dd>
				{row.outcome === "withheld" ? (
					<>
						<dt className="text-muted">Withheld because</dt>
						<dd>{row.reason ?? "no access"}</dd>
					</>
				) : null}
			</dl>
		</div>
	)
}
