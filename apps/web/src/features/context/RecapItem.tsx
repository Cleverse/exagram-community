import { Link } from "react-router"

import { TypeIcon } from "@/components/ui/TypeIcon"
import { artifactLinkTarget } from "@/features/artifact/openArtifact"
import { type RecapRow } from "@/features/context/recap"

/**
 * One artifact line of the recap (T:L2290), in the file list's style: indented under its group (28px, or
 * `indent` in the modal), the 16px line icon, a 14px name over its 12px meta, and the mono revision. A real
 * file is a link to its address; a sample row is plain text, since the design's ids open nothing.
 */
export const RecapItem = ({ row, indent = 28, to }: { row: RecapRow; indent?: number; to?: string }) => {
	const body = (
		<>
			<TypeIcon kind={row.type} size={16} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-ink" style={{ fontSize: 14 }}>
					{row.name}
				</span>
				<span className="block truncate text-muted" style={{ fontSize: 12, marginTop: 2 }}>
					{row.meta}
				</span>
			</span>
			<span className="font-mono whitespace-nowrap text-muted" style={{ fontSize: 11 }}>
				{row.rev}
			</span>
		</>
	)
	const style = { gap: 12, padding: `8px 8px 8px ${indent}px`, borderRadius: "var(--radius)" }

	return to ? (
		<Link
			to={to}
			target={artifactLinkTarget()}
			className="flex w-full items-center text-left text-ink transition-colors duration-(--duration-row) ease-(--ease-arrive) hover:bg-hover hover:text-ink"
			style={style}
		>
			{body}
		</Link>
	) : (
		<div className="flex w-full items-center" style={style}>
			{body}
		</div>
	)
}
