import { useLocalStore } from "@/mock/store"

/**
 * The design's PINNED sidebar list. The API has no bookmark, so the set is mock local state; the
 * grant-level "Pin" (follow a Revision) is a different concept and lives in the Share dialog.
 */
export const usePinned = () => {
	const [ids, setIds] = useLocalStore<string[]>("pinned", [])

	return {
		ids,
		isPinned: (artifactId: string) => ids.includes(artifactId),
		toggle: (artifactId: string) =>
			setIds((previous) =>
				previous.includes(artifactId)
					? previous.filter((candidate) => candidate !== artifactId)
					: [...previous, artifactId],
			),
	}
}
