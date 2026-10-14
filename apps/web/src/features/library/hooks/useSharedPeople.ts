import { type VisibleArtifact } from "@exagram/api-client"

import { useProjectAccess, useProjectGrants } from "@/features/grants/hooks/useGrants"
import { isGroupGrant } from "@/features/grants/useShareModel"

/**
 * Everyone who can open the file: its Owner, the people it is shared with, and the people with a
 * Grant on its Project, each once. The Project's Grants are asked for only by someone who may see them — the
 * same `access` check the Project Share panel makes — so a Viewer never draws a refusal.
 */
export const useSharedPeople = (artifact: VisibleArtifact, enabled: boolean): string[] => {
	const projectId = artifact.projectId ?? ""
	const access = useProjectAccess(projectId, enabled && artifact.projectId !== null)
	const mayList = access.data === "owner" || access.data === "edit" || access.data === "collaborate"
	const projectGrants = useProjectGrants(projectId, enabled && artifact.projectId !== null && mayList)

	const names = [
		artifact.ownerName,
		...artifact.sharedWithNames,
		...(projectGrants.data ?? []).filter((grant) => !isGroupGrant(grant)).map((grant) => grant.granteeName),
	]
	return names.filter((name, index) => name.trim() !== "" && names.indexOf(name) === index)
}
