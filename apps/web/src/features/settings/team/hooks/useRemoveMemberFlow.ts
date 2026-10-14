import { useState } from "react"

import { useRemoveMember } from "@/features/settings/team/hooks/useMembers"
import { type TeamMember } from "@/features/settings/team/teamModel"

export const useRemoveMemberFlow = (target: TeamMember, onRemoved: () => void) => {
	const remove = useRemoveMember()
	const [ownsItems, setOwnsItems] = useState("projectCount" in target && target.projectCount > 0)
	const [successor, setSuccessor] = useState("")

	const confirm = () =>
		remove.mutate(
			{ userId: target.id, name: target.name, transferTo: ownsItems ? successor : undefined },
			{
				onSuccess: (result) => {
					if (result.removed) onRemoved()
					else if (result.transferRequired) setOwnsItems(true)
				},
			},
		)

	return {
		ownsItems,
		successor,
		setSuccessor,
		confirm,
		pending: remove.isPending,
		blocked: remove.isPending || (ownsItems && successor === ""),
		error: remove.error,
	}
}
