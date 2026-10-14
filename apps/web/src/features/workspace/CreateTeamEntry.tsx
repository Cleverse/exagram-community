import { useContext, useState } from "react"

import { SheetApiContext } from "@/components/mobile/sheet/context"
import { useShell } from "@/components/mobile/shell"
import { CreateTeamDialog } from "@/features/workspace/CreateTeamDialog"
import { useCanCreateTeam } from "@/features/workspace/useCreateTeamMutation"

export const useCreateTeamEntry = () => {
	const available = useCanCreateTeam()
	const mobile = useShell() === "mobile"
	const sheet = useContext(SheetApiContext)
	const [dialogOpen, setDialogOpen] = useState(false)

	return {
		available,
		open: () => {
			if (mobile && sheet !== null) sheet.open("createTeam", {})
			else setDialogOpen(true)
		},
		dialog: dialogOpen ? <CreateTeamDialog onClose={() => setDialogOpen(false)} /> : null,
	}
}
