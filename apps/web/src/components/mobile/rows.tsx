import { type VisibleArtifact } from "@exagram/api-client"
import { Link } from "react-router"

import { IconEllipsis, IconPeople } from "@/components/ui/icons"
import { ThinkingMatrix } from "@/components/ui/ThinkingMatrix"
import { TypeTile } from "@/components/ui/TypeTile"
import { isIndexing } from "@/features/library/indexing"
import { activityWhen } from "@/features/library/lastActivity"
import { paths } from "@/routes/paths"

/** The meta line under a file's name: "Project · vN · age" (README §1 Files). */
export const fileMeta = (artifact: VisibleArtifact, projectName: string | null, now: Date = new Date()) =>
	`${projectName ?? "No project"} · v${artifact.revisionSeq} · ${activityWhen(artifact.updatedAt, now)}`

/**
 * A file in a mobile list (W:L166–194): 30px type tile, one-line name, meta with an amber dot while a
 * Revision waits, and a 44px "more" button that opens the File drawer. Artifacts, Project and Search share it.
 */
export const MobileFileRow = ({
	artifact,
	projectName,
	pending = false,
	onMore,
}: {
	artifact: VisibleArtifact
	projectName: string | null
	pending?: boolean
	onMore: () => void
}) => (
	<div className="flex items-center active:bg-row-hover" style={{ borderRadius: 6 }}>
		<Link
			to={paths.artifact(artifact.id)}
			className="flex min-w-0 flex-1 items-center text-ink hover:text-ink"
			style={{ gap: 12, height: 56, paddingLeft: 10, textDecoration: "none" }}
		>
			<TypeTile kind={artifact.kind} size={30} />
			<div className="min-w-0 flex-1">
				<div className="truncate" style={{ fontSize: 14.5, fontWeight: 450 }}>
					{artifact.title}
				</div>
				<div
					className="flex items-center overflow-hidden whitespace-nowrap text-muted-2"
					style={{ gap: 6, fontSize: 12, marginTop: 2 }}
				>
					{pending ? (
						<span
							aria-label="Waiting for approval"
							className="flex-none bg-pending"
							style={{ width: 6, height: 6, borderRadius: "50%" }}
						/>
					) : null}
					{isIndexing(artifact) ? <ThinkingMatrix size={12} /> : null}
					<span className="truncate">{fileMeta(artifact, projectName)}</span>
				</div>
			</div>
		</Link>
		<button
			type="button"
			aria-label={`More actions for ${artifact.title}`}
			onClick={onMore}
			className="grid flex-none place-items-center text-muted active:bg-subtle"
			style={{ width: 44, height: 44 }}
		>
			<IconEllipsis size={18} />
		</button>
	</div>
)

/** The folder glyph in the design's blue (fill `#C9D5FB`, stroke `#6B84E8`; W:L162). */
export const FolderGlyph = ({ size = 22 }: { size?: number }) => (
	<svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className="flex-none">
		<path
			d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
			fill="var(--color-folder-fill)"
			stroke="var(--color-folder)"
			strokeWidth={1.5}
			strokeLinejoin="round"
		/>
	</svg>
)

/** A Project in a mobile list (W:L161–166): folder, name, a shared mark where it applies, file count. */
export const MobileProjectRow = ({
	projectId,
	name,
	count,
	shared = false,
}: {
	projectId: string
	name: string
	count: number
	shared?: boolean
}) => (
	<Link
		to={paths.project(projectId)}
		className="flex w-full items-center text-ink hover:text-ink active:bg-row-hover"
		style={{ gap: 12, height: 48, padding: "0 10px", borderRadius: 6, textDecoration: "none" }}
	>
		<FolderGlyph />
		<span className="min-w-0 flex-1 truncate" style={{ fontSize: 14.5, fontWeight: 450 }}>
			{name}
		</span>
		{shared ? <IconPeople size={15} aria-hidden className="text-muted-2" /> : null}
		<span className="font-mono text-muted-2" style={{ fontSize: 12, minWidth: 18, textAlign: "right" }}>
			{count}
		</span>
	</Link>
)
