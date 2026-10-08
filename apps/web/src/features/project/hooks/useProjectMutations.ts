import { type LinkPreview, type PublishPolicy } from "@exagram/api-client"
import { useMutation } from "@tanstack/react-query"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { useInvalidate } from "@/utils/react-query"

export const useRenameProject = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { projectId: string; name: string }) => apiClient.projects.rename(input),
		onSuccess: () => invalidate([QueryKeys.projects.list()]),
	})
}

/** The server refuses a non-empty Project; the browser never counts first. */
export const useDeleteProject = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { projectId: string }) => apiClient.projects.remove(input),
		onSuccess: () => invalidate([QueryKeys.projects.list()]),
	})
}

/** Owner only: whether uploads in this Project publish on arrival or wait for approval. */
export const useSetProjectPublishPolicy = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { projectId: string; publishPolicy: PublishPolicy }) =>
			apiClient.projects.setPublishPolicy(input),
		onSuccess: () => invalidate([QueryKeys.projects.list(), ["artifacts"]]),
	})
}

/** Owner only: whether link previews of this Project and its files show titles or a generic card. */
export const useSetProjectLinkPreview = () => {
	const invalidate = useInvalidate()
	const toast = useToast()

	return useMutation({
		mutationFn: (input: { projectId: string; linkPreview: LinkPreview }) => apiClient.projects.setLinkPreview(input),
		onSuccess: () => invalidate([QueryKeys.projects.list()]),
		onError: (error) => toast(error.message),
	})
}

export const useCreateProject = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { name: string; parentProjectId: string | null }) => apiClient.projects.create(input),
		onSuccess: () => invalidate([QueryKeys.projects.list()]),
	})
}

/** Owner only: nest a Project under a top-level one, or lift it back to the top (`null`). */
export const useMoveProject = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { projectId: string; parentProjectId: string | null }) => apiClient.projects.move(input),
		// A parent's Grants reach its folders, so who reads which file can change with the move.
		onSuccess: () => invalidate([QueryKeys.projects.list(), ["artifacts"]]),
	})
}

export const useMoveArtifact = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { artifactId: string; projectId: string | null }) => apiClient.artifacts.move(input),
		onSuccess: (_result, input) => invalidate([["artifacts", "list"], QueryKeys.artifacts.get(input.artifactId)]),
	})
}

/** The row menu's Delete: a soft delete, so the bytes survive a mistake. */
export const useDeleteArtifact = () => {
	const invalidate = useInvalidate()

	return useMutation({
		mutationFn: (input: { artifactId: string }) => apiClient.artifacts.softDelete(input),
		onSuccess: (_result, input) =>
			invalidate([["artifacts", "list"], QueryKeys.artifacts.get(input.artifactId), QueryKeys.approvals.pending()]),
	})
}
