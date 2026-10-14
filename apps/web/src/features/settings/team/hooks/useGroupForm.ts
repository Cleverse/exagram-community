import { type AdminGroup } from "@exagram/api-client"
import { useState } from "react"

import { useUpsertGroup } from "@/features/settings/team/hooks/useGroups"
import { membersIn, type TeamMember } from "@/features/settings/team/teamModel"

export const useGroupForm = (group: AdminGroup | undefined, members: readonly TeamMember[], onSaved: () => void) => {
	const save = useUpsertGroup()
	const [name, setName] = useState(group?.name ?? "")
	const [picked, setPicked] = useState<ReadonlySet<string>>(
		() => new Set(membersIn(members, group?.memberIds ?? []).map((member) => member.id)),
	)
	const ready = name.trim() !== "" && picked.size > 0

	const rename = (next: string) => {
		setName(next)
		if (save.isError) save.reset()
	}

	const toggle = (id: string, on: boolean) =>
		setPicked((current) => {
			const next = new Set(current)
			if (on) next.add(id)
			else next.delete(id)
			return next
		})

	const submit = () => {
		if (!ready || save.isPending) return
		save.mutate(
			{ id: group?.id, name: name.trim(), memberIds: members.filter((m) => picked.has(m.id)).map((m) => m.id) },
			{ onSuccess: onSaved },
		)
	}

	return { name, rename, picked, toggle, ready, submit, saving: save.isPending, error: save.error }
}
