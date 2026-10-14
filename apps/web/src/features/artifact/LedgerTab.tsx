import clsx from "clsx"
import { Fragment, useState } from "react"

import { useArtifactLedger } from "@/features/artifact/hooks/useLedger"
import { useRevisions } from "@/features/artifact/hooks/useRevisions"
import { LedgerDetail } from "@/features/artifact/LedgerDetail"
import { formatWhen } from "@/utils/format"

const SURFACE_LABEL: Record<string, string> = {
	web: "Web",
	mcp: "Connection",
	link: "Link",
}

/** The withheld rows are the point of the Ledger: they say who asked and was told nothing. */
export const LedgerTab = ({
	artifactId,
	currentRevisionId,
}: {
	artifactId: string
	currentRevisionId: string | null | undefined
}) => {
	const ledger = useArtifactLedger(artifactId)
	const revisions = useRevisions(artifactId, true)
	const [expandedCallId, setExpandedCallId] = useState<string | null>(null)

	const seqById = new Map(revisions.data?.map((revision) => [revision.id, revision.seq]))
	const revisionLabel = (revisionId: string) => {
		const seq = seqById.get(revisionId)
		return seq === undefined ? revisionId.slice(0, 8) : `v${seq}`
	}

	if (ledger.isError)
		return (
			<p role="alert" className="text-muted p-6 text-sm">
				{ledger.error.message}
			</p>
		)

	return (
		<div className="p-4">
			<p className="mono-label mb-3">Every read of this Artifact, served and withheld alike, newest first.</p>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[520px] text-sm">
					<thead>
						<tr className="mono-label border-line border-b text-left">
							<th className="py-2 font-normal">When</th>
							<th className="font-normal">Through</th>
							<th className="font-normal">Asked for</th>
							<th className="font-normal">Revision</th>
							<th className="font-normal">Outcome</th>
						</tr>
					</thead>
					<tbody>
						{ledger.data?.items.length === 0 ? (
							<tr>
								<td className="text-muted py-3" colSpan={5}>
									Nobody has tried to read this yet.
								</td>
							</tr>
						) : null}
						{ledger.data?.items.map((row) => {
							const expanded = expandedCallId === row.callId
							return (
								<Fragment key={row.callId}>
									<tr
										className="border-line hover:bg-chip cursor-pointer border-b"
										aria-expanded={expanded}
										onClick={() => setExpandedCallId(expanded ? null : row.callId)}
									>
										<td className="py-2 whitespace-nowrap">{formatWhen(row.startedAt)}</td>
										<td>{SURFACE_LABEL[row.surface] ?? row.surface}</td>
										<td className="mono-label">{row.action}</td>
										<td className="mono-label">{row.revisionId === null ? "—" : revisionLabel(row.revisionId)}</td>
										<td className={clsx(row.outcome === "served" ? "" : "text-muted")}>
											{row.outcome === "served" ? "Served" : `Withheld — ${row.reason ?? "no access"}`}
										</td>
									</tr>
									{expanded ? (
										<tr className="border-line border-b">
											<td colSpan={5} className="p-0">
												<LedgerDetail row={row} revisionLabel={revisionLabel} currentRevisionId={currentRevisionId} />
											</td>
										</tr>
									) : null}
								</Fragment>
							)
						})}
					</tbody>
				</table>
			</div>
			{ledger.data?.nextCursor ? (
				<p className="text-muted mt-3 text-xs">
					Older entries exist. The Ledger keeps them all; this page shows the newest 50.
				</p>
			) : null}
		</div>
	)
}
