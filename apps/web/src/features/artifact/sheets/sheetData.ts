import { type VisibleArtifact } from "@exagram/api-client"
import { useQuery } from "@tanstack/react-query"
import { type CSSProperties } from "react"

import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useProjects } from "@/features/library/hooks/useProjects"

/**
 * The file a drawer is about. Every screen that opens one has already listed it, so it comes from the
 * library's list; only a file that list lacks is asked for on its own, since `artifacts.get` ledgers a read.
 */
export const useSheetArtifact = (artifactId: string) => {
	const all = useArtifacts({ scope: "all" })
	const listed = all.data?.find((artifact) => artifact.id === artifactId)
	const fetched = useQuery({
		queryKey: QueryKeys.artifacts.get(artifactId),
		queryFn: () => apiClient.artifacts.get({ artifactId }),
		enabled: listed === undefined && !all.isPending,
	})
	const artifact: VisibleArtifact | null = listed ?? fetched.data ?? null
	return { artifact, loading: artifact === null && (all.isPending || fetched.isPending) }
}

/** A Project's name for a meta line, or null outside one. */
export const useProjectName = (projectId: string | null) => {
	const projects = useProjects()
	return projectId === null ? null : ((projects.data ?? []).find((project) => project.id === projectId)?.name ?? null)
}

/** The drawers' two button weights (W:L681–682): a 44px outline and a 44px ink fill. */
export const outlineButtonClass = "border border-line-strong bg-white text-ink active:bg-hover disabled:opacity-50"
export const inkButtonClass = "bg-ink text-white active:bg-primary-hover disabled:opacity-50"
export const buttonStyle: CSSProperties = { height: 44, fontSize: 14.5, fontWeight: 500 }
