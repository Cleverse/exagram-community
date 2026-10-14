import { type PublishPolicy, type WorkspaceKind } from "@exagram/api-client"

import { useToast } from "@/components/Toast"
import { useProjects } from "@/features/library/hooks/useProjects"
import {
	useCreateProject,
	useRenameProject,
	useSetProjectPublishPolicy,
} from "@/features/project/hooks/useProjectMutations"
import { hasProjectRules } from "@/features/project/projectRules"
import { publishPolicyLabel } from "@/features/project/publishPolicy"
import { useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"
import { useProjectSettings } from "@/mock/projectSettings"

/**
 * A Project's rules apart from how they are drawn: the desktop settings dialog and the mobile Rules drawer read
 * and save the same name, policy, overwrite switch and publish policy, with the same toasts.
 */

export type ProjectDraft = {
	name: string
	policy: string
	overwrite: boolean
	publish: PublishPolicy
}

export const EMPTY_PROJECT_DRAFT: ProjectDraft = { name: "", policy: "", overwrite: false, publish: "auto" }

/** The toast once a new Project and its settings are all written. */
export const createdProjectMessage = (name: string, publish: PublishPolicy, kind: WorkspaceKind) =>
	kind === "personal"
		? `${name} created.`
		: `${name} created — ${publishPolicyLabel(publish).toLowerCase()}, private until you invite someone.`

/**
 * Creating a Project: the Project first, then its publish policy only if it differs from the server's 'auto'.
 * `onCreated` gets the new id and the trimmed draft, so the caller can write the settings keyed by that id.
 */
export const useCreateProjectModel = () => {
	const createProject = useCreateProject()
	const setPublishPolicy = useSetProjectPublishPolicy()
	const toast = useToast()

	const create = (
		draft: ProjectDraft,
		parentProjectId: string | null,
		onCreated: (projectId: string, draft: ProjectDraft) => void,
	) => {
		const name = draft.name.trim()
		createProject.mutate(
			{ name, parentProjectId },
			{
				onSuccess: (project) => {
					const done = () => onCreated(project.id, { ...draft, name })
					// A new Project starts 'auto'; only a different choice needs a second call.
					if (draft.publish === project.publishPolicy) done()
					else
						setPublishPolicy.mutate(
							{ projectId: project.id, publishPolicy: draft.publish },
							{ onSuccess: done, onError: (error) => toast(error.message) },
						)
				},
			},
		)
	}

	return { create, saving: createProject.isPending || setPublishPolicy.isPending }
}

/**
 * Editing one Project's rules. `project` is undefined until the Project list has it. `save` writes the local
 * settings at once, then renames and changes the publish policy only where they changed.
 */
export const useProjectSettingsModel = (projectId: string) => {
	const projects = useProjects()
	const project = projects.data?.find((candidate) => candidate.id === projectId)
	const settings = useProjectSettings(projectId)
	const { kind } = useWorkspaceOf(project?.workspaceId)
	const renameProject = useRenameProject()
	const setPublishPolicy = useSetProjectPublishPolicy()
	const toast = useToast()

	const initial: ProjectDraft | null = project
		? { name: project.name, policy: settings.policy, overwrite: settings.overwrite, publish: project.publishPolicy }
		: null

	const save = (draft: ProjectDraft, onSaved: () => void) => {
		if (!project) return
		const name = draft.name.trim()
		settings.set({ policy: draft.policy.trim(), overwrite: draft.overwrite })
		const write = async () => {
			if (name !== project.name) await renameProject.mutateAsync({ projectId, name })
			if (draft.publish !== project.publishPolicy) {
				await setPublishPolicy.mutateAsync({ projectId, publishPolicy: draft.publish })
			}
		}
		write().then(
			() => {
				// A folder with no rules to show saved only its name, which no Connection's request depends on.
				toast(hasProjectRules(kind) ? "Settings saved — applies to the next request." : "Settings saved.")
				onSaved()
			},
			(error: Error) => toast(error.message),
		)
	}

	return { project, initial, saving: renameProject.isPending || setPublishPolicy.isPending, save }
}
