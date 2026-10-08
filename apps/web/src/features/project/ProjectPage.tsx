import { useLocation, useParams } from "react-router"

import { NotFound } from "@/components/NotFound"
import { useMissingPreviewRedirect } from "@/features/library/hooks/useMissingPreviewRedirect"
import { useProjects } from "@/features/library/hooks/useProjects"
import { LibraryScreen } from "@/features/library/LibraryScreen"
import { LibraryShellSkeleton } from "@/features/library/LibraryShell"
import { previewIdOf } from "@/routes/paths"

export const ProjectPage = () => {
	const { projectId = "" } = useParams()
	const { search } = useLocation()
	const projects = useProjects()
	const project = projects.data?.find((candidate) => candidate.id === projectId)
	useMissingPreviewRedirect(undefined, !project && projects.isSuccess)

	if (!project) {
		if (projects.isPending) return <LibraryShellSkeleton label="Loading project…" />
		const previewId = previewIdOf(search)
		if (projects.isSuccess && previewId !== null) return null
		return <NotFound what="project" />
	}

	return <LibraryScreen project={project} />
}
