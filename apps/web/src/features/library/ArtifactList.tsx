import { type VisibleArtifact } from "@exagram/api-client"

import { ArtifactRow } from "@/features/library/ArtifactRow"
import { groupArtifactsByRecency } from "@/features/library/grouping"
import { type SortKey, sortArtifacts } from "@/features/library/sort"

/** The heading above each recency bucket (v5 §4): the micro-label in `label` grey, "EARLIER THIS WEEK · 14". */
export const GroupLabel = ({ children }: { children: string }) => (
	<div className="mono-kicker" style={{ padding: "28px 10px 6px" }}>
		{children}
	</div>
)

/**
 * The list body. A search, and every Project page, renders flat; the library root groups by
 * recency, which is what the prototype's default "Recent" layout does.
 */
export const ArtifactList = ({
	artifacts,
	sort,
	flat,
	showProject,
	showOwner,
	showMeta = true,
	projectNames,
	selectedId,
	onSelect,
	onOpen,
}: {
	artifacts: VisibleArtifact[]
	sort: SortKey
	flat?: boolean
	showProject?: boolean
	showOwner?: boolean
	/** False while the preview pane is open, when the list is too narrow for the trailing cells. */
	showMeta?: boolean
	projectNames?: Map<string, string>
	selectedId: string | null
	onSelect: (artifactId: string) => void
	onOpen: (artifactId: string) => void
}) => {
	const sorted = sortArtifacts(artifacts, sort)

	const row = (artifact: VisibleArtifact) => (
		<ArtifactRow
			key={artifact.id}
			artifact={artifact}
			selected={artifact.id === selectedId}
			onSelect={onSelect}
			onOpen={onOpen}
			showProject={showProject}
			showOwner={showOwner}
			showMeta={showMeta}
			projectName={artifact.projectId === null ? null : (projectNames?.get(artifact.projectId) ?? null)}
		/>
	)

	if (flat || sort === "name") return <ul>{sorted.map(row)}</ul>

	return (
		<>
			{groupArtifactsByRecency(sorted).map((group) => (
				<div key={group.label}>
					<GroupLabel>{`${group.label} · ${group.artifacts.length}`}</GroupLabel>
					<ul>{group.artifacts.map(row)}</ul>
				</div>
			))}
		</>
	)
}
