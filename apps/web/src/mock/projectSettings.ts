import { useCallback } from "react"

import { useLocalStore } from "@/mock/store"

/**
 * The project fields the design shows that the API has no column for: the prompt-style policy and
 * the collaborator-overwrite toggle (README "Screen 2"). Stored per project under
 * `exagram.mock.project.<id>` so a reload keeps them. The publish policy is a real column now.
 */

export type ProjectSettings = {
	policy: string
	overwrite: boolean
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { policy: "", overwrite: false }

export const useProjectSettings = (
	projectId: string,
): ProjectSettings & { set: (patch: Partial<ProjectSettings>) => void } => {
	const [current, setCurrent] = useLocalStore<ProjectSettings>(`project.${projectId}`, DEFAULT_PROJECT_SETTINGS)

	const set = useCallback(
		(patch: Partial<ProjectSettings>) => {
			setCurrent((previous) => ({ ...previous, ...patch }))
		},
		[setCurrent],
	)

	return { ...current, set }
}
