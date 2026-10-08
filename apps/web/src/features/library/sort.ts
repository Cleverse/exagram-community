import { type VisibleArtifact } from "@exagram/api-client"

export type SortKey = "updated" | "name"

/** The list's only ordering: newest first, or by name. The server returns its own order. */
export const sortArtifacts = (artifacts: VisibleArtifact[], sort: SortKey): VisibleArtifact[] =>
	[...artifacts].sort((a, b) =>
		sort === "name"
			? a.title.localeCompare(b.title)
			: new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
	)
