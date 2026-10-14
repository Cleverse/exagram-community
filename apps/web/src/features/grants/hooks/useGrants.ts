import { type DefaultPin, type GrantRole, type PublishPolicy } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { useMe } from "@/features/auth/hooks/useMe"
import { useInvalidate } from "@/utils/react-query"

/** Owner, Editor or Collaborator; a Viewer is refused, so `enabled` lets the caller skip asking. */
export const useGrants = (artifactId: string, enabled = true) =>
	useQuery({
		queryKey: QueryKeys.grants.list(artifactId),
		queryFn: () => apiClient.grants.list({ artifactId }),
		enabled,
	})

/** One Grant over a Project reaches every Artifact it holds, including ones uploaded later. */
export const useProjectGrants = (projectId: string, enabled = true) =>
	useQuery({
		queryKey: QueryKeys.grants.listForProject(projectId),
		queryFn: () => apiClient.grants.list({ projectId }),
		enabled,
	})

/** The server's answer to "may I share this?"; a Guest never may. */
export const useArtifactAccess = (artifactId: string) =>
	useQuery({
		queryKey: QueryKeys.grants.access(artifactId),
		queryFn: () => apiClient.grants.access({ artifactId }),
	})

/** The server's answer to "what may I do here?", so the Project Share panel never guesses from the client. */
export const useProjectAccess = (projectId: string, enabled = true) =>
	useQuery({
		queryKey: QueryKeys.grants.access(projectId),
		queryFn: () => apiClient.grants.access({ projectId }),
		enabled,
	})

export type GranteeInput = { granteeEmail: string } | { groupId: string }

/** What `create` takes beyond the target; `pinnedRevisionId` as in `apiClient.grants.create`. */
export type InviteInput = GranteeInput & { role: GrantRole; pinnedRevisionId?: string | null }

export const useDefaultShareRole = (workspaceId: string | undefined): GrantRole | undefined => {
	const me = useMe().data
	return edition.useTeamDefaultShareRole(
		workspaceId !== undefined && me?.workspaceKind === "team" && me.workspaceId === workspaceId,
	)
}

export const useInviteSuggestions = (
	target: { artifactId: string } | { projectId: string },
	query: string,
	enabled = true,
	/** The Invite view's checklist asks for more than the default few. */
	limit?: number,
) => {
	const targetId = "artifactId" in target ? target.artifactId : target.projectId
	const q = query.trim()
	return useQuery({
		queryKey: [...QueryKeys.grants.suggestions(targetId), q, limit],
		queryFn: () => apiClient.grants.suggestions({ ...target, ...(q ? { q } : {}), ...(limit ? { limit } : {}) }),
		enabled,
		placeholderData: (previous) => previous,
	})
}

export const useGrantMutations = (artifactId: string) => {
	const invalidate = useInvalidate()
	const toast = useToast()
	const onError = (error: Error) => toast(error.message)
	// The lists carry `defaultPin` and `sharedWithNames`, so a list row (and the mobile drawers, which read the
	// file from the list) would otherwise show the old share state until the list went stale.
	const refresh = () =>
		invalidate([
			QueryKeys.grants.list(artifactId),
			QueryKeys.grants.suggestions(artifactId),
			QueryKeys.artifacts.get(artifactId),
			["artifacts", "list"],
		])

	const invite = useMutation({
		mutationFn: (input: InviteInput) => apiClient.grants.create({ artifactId, ...input }),
		onSuccess: refresh,
	})

	const setRole = useMutation({
		mutationFn: (input: { grantId: string; role: GrantRole }) => apiClient.grants.updateRole(input),
		onSuccess: refresh,
		onError,
	})

	/** `null` means the Grant follows the Current Revision instead of a Pin. */
	const setPin = useMutation({
		mutationFn: (input: { grantId: string; pinnedRevisionId: string | null }) => apiClient.grants.updatePin(input),
		onSuccess: refresh,
		onError,
	})

	const remove = useMutation({
		mutationFn: (input: { grantId: string }) => apiClient.grants.remove(input),
		onSuccess: refresh,
		onError,
	})

	const setDefaultPin = useMutation({
		mutationFn: (input: { defaultPin: DefaultPin }) => apiClient.grants.setDefaultPin({ artifactId, ...input }),
		onSuccess: refresh,
		onError,
	})

	/** Owner only. `null` clears the file's own choice so it follows its Project again. */
	const setPublishPolicy = useMutation({
		mutationFn: (input: { publishPolicy: PublishPolicy | null }) =>
			apiClient.artifacts.setPublishPolicy({ artifactId, ...input }),
		onSuccess: () => invalidate([QueryKeys.artifacts.get(artifactId), ["artifacts", "list"]]),
		onError,
	})

	return { invite, setRole, setPin, remove, setDefaultPin, setPublishPolicy }
}

/**
 * A Project Grant carries no Pin — a Pin names one Revision of one Artifact — so this is the
 * artifact set minus `setPin` and `setDefaultPin`. Every Artifact list is invalidated because a
 * Project Grant changes what the grantee sees everywhere at once.
 */
export const useProjectGrantMutations = (projectId: string) => {
	const invalidate = useInvalidate()
	const toast = useToast()
	const onError = (error: Error) => toast(error.message)
	const refresh = () =>
		invalidate([QueryKeys.grants.listForProject(projectId), QueryKeys.grants.suggestions(projectId), ["artifacts"]])

	const invite = useMutation({
		// A Project Grant carries no pin.
		mutationFn: (input: GranteeInput & { role: GrantRole }) => apiClient.grants.create({ projectId, ...input }),
		onSuccess: refresh,
	})

	const setRole = useMutation({
		mutationFn: (input: { grantId: string; role: GrantRole }) => apiClient.grants.updateRole(input),
		onSuccess: refresh,
		onError,
	})

	const remove = useMutation({
		mutationFn: (input: { grantId: string }) => apiClient.grants.remove(input),
		onSuccess: refresh,
		onError,
	})

	return { invite, setRole, remove }
}
