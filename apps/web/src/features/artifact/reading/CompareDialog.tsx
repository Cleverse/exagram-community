import { type Revision, type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { useMemo } from "react"

import { Dialog } from "@/components/Dialog"
import { useRevisionTextAt } from "@/features/artifact/hooks/useArtifact"
import { lineDiff } from "@/features/artifact/reading/lineDiff"

const GUTTER = { same: " ", added: "+", removed: "−" } as const

const Notice = ({ children, alert = false }: { children: string; alert?: boolean }) => (
	<p role={alert ? "alert" : undefined} className="text-muted" style={{ padding: "20px 24px", fontSize: 14 }}>
		{children}
	</p>
)

/**
 * History's "Compare with current": the older Revision's text against the Current one's, as a line diff.
 * Both texts come from the per-Revision text endpoint, which serves an older or pending Revision to its
 * Owner only — the only person who sees History.
 */
export const CompareDialog = ({
	artifact,
	revision,
	current,
	onClose,
}: {
	artifact: VisibleArtifact
	revision: Revision
	current: Revision
	onClose: () => void
}) => {
	const before = useRevisionTextAt(artifact.id, revision.id, true)
	const after = useRevisionTextAt(artifact.id, current.id, true)
	const title = `Compare v${revision.seq} with v${current.seq}`

	const beforeText = before.data?.text
	const afterText = after.data?.text
	// The LCS is quadratic, so it runs once per pair of texts rather than on every render.
	const lines = useMemo(
		() => (beforeText === undefined || afterText === undefined ? undefined : lineDiff(beforeText, afterText)),
		[beforeText, afterText],
	)
	const added = lines?.filter((line) => line.kind === "added").length ?? 0
	const removed = lines?.filter((line) => line.kind === "removed").length ?? 0

	return (
		<Dialog
			title={title}
			onClose={onClose}
			width={760}
			bare
			helper={lines ? `${added} added · ${removed} removed · v${current.seq} is current` : undefined}
		>
			{before.isError || after.isError ? (
				<Notice alert>{(before.error ?? after.error)?.message ?? "Could not load the text."}</Notice>
			) : !before.data || !after.data ? (
				<Notice>Loading…</Notice>
			) : lines === null ? (
				<Notice>These revisions are too long to compare here.</Notice>
			) : added === 0 && removed === 0 ? (
				<Notice>{`v${revision.seq} and v${current.seq} have the same text.`}</Notice>
			) : (
				<ol aria-label={title} className="font-mono" style={{ fontSize: 13, lineHeight: 1.6, padding: "8px 0" }}>
					{lines?.map((line, index) => (
						<li
							key={index}
							className={clsx(
								"flex whitespace-pre-wrap",
								line.kind === "added" && "bg-green-bg text-green-fg",
								line.kind === "removed" && "bg-html-bg text-held-deep",
							)}
							style={{ padding: "0 24px 0 0" }}
						>
							<span aria-hidden className="flex-none text-muted select-none" style={{ width: 32, textAlign: "center" }}>
								{GUTTER[line.kind]}
							</span>
							<span className="sr-only">{line.kind === "same" ? "" : `${line.kind}: `}</span>
							<span className="min-w-0 flex-1 break-words">{line.text === "" ? " " : line.text}</span>
						</li>
					))}
				</ol>
			)}
		</Dialog>
	)
}
