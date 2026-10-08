import { type Project } from "@exagram/api-client"

import { useToast } from "@/components/Toast"
import { useMe } from "@/features/auth/hooks/useMe"
import { useProjects } from "@/features/library/hooks/useProjects"
import { movedMessage } from "@/features/library/moveMessage"
import { useMoveArtifact } from "@/features/project/hooks/useProjectMutations"

/** Roots first, each followed by its sub-projects, so the list reads like the sidebar. */
export const orderedProjects = (projects: Project[]): { project: Project; nested: boolean }[] =>
	projects
		.filter((project) => project.parentProjectId === null)
		.flatMap((root) => [
			{ project: root, nested: false },
			...projects
				.filter((child) => child.parentProjectId === root.id)
				.map((child) => ({ project: child, nested: true })),
		])

/**
 * "Move to project" apart from how it is drawn, for the desktop dialog and the mobile Move drawer. §A.3
 * restricts `artifacts.move` to the Owner's own Projects, and `projects.list` also returns Projects shared with
 * you, so the choices are only the ones you own; a refused move toasts the server's message unchanged, a done
 * one the shared moved message.
 */
export const useMoveArtifactModel = ({ artifactId, title }: { artifactId: string; title: string }) => {
	const projects = useProjects()
	const me = useMe()
	const move = useMoveArtifact()
	const toast = useToast()

	const moveTo = (projectId: string | null, onMoved: () => void) =>
		move.mutate(
			{ artifactId, projectId },
			{
				onSuccess: () => {
					toast(movedMessage(title, projectId, projects.data ?? []))
					onMoved()
				},
				onError: (error) => toast(error.message),
			},
		)

	return {
		rows: orderedProjects((projects.data ?? []).filter((project) => project.ownerId === me.data?.id)),
		error: projects.isError ? projects.error.message : null,
		moving: move.isPending,
		moveTo,
	}
}
