import { type VisibleArtifact } from "@exagram/api-client"

import { sortArtifacts } from "@/features/library/sort"
import { paths } from "@/routes/paths"

/** The folder a preview belongs to: its Project, or the list it was opened from when it has none. */
export type FolderRef = { kind: "project"; id: string; name: string } | { kind: "list"; name: string; href: string }

/** The folder a file with no Project (or none the reader can list) falls back to. */
export const ALL_ARTIFACTS_FOLDER: FolderRef = { kind: "list", name: "All artifacts", href: paths.library }

/** Where the preview's ↑ ↓ / j k step, and the folder its path line names: the current folder and its files in order. */
export type PreviewNav = { folder: FolderRef; siblings: VisibleArtifact[] }

/**
 * The navigation order (v3.2 `siblingsOf`). A file in a Project the reader can list steps through that
 * Project's files, sorted the way the list is; any other file steps through the list the reader came from,
 * already in that list's order. A file that list does not hold (a pinned file from another folder, say) steps
 * through All artifacts, newest first.
 */
export const previewNavFor = ({
	artifact,
	everything,
	projectNames,
	list,
	listFolder,
	sort = "updated",
}: {
	artifact: VisibleArtifact
	/** Every Artifact the reader can open (`artifacts.list` scope all). */
	everything: VisibleArtifact[]
	projectNames: Map<string, string>
	/** The list on screen, in its display order. */
	list: VisibleArtifact[]
	listFolder: FolderRef
	sort?: "updated" | "name"
}): PreviewNav => {
	const projectName = artifact.projectId === null ? undefined : projectNames.get(artifact.projectId)
	if (artifact.projectId !== null && projectName !== undefined)
		return {
			folder: { kind: "project", id: artifact.projectId, name: projectName },
			siblings: sortArtifacts(
				everything.filter((candidate) => candidate.projectId === artifact.projectId),
				sort,
			),
		}
	if (list.some((candidate) => candidate.id === artifact.id)) return { folder: listFolder, siblings: list }
	return { folder: ALL_ARTIFACTS_FOLDER, siblings: sortArtifacts(everything, "updated") }
}
