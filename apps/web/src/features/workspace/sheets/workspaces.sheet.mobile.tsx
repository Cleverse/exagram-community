import { SheetRow, SheetRows } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { IconPlus } from "@/components/ui/icons"
import { useWorkspaceChoice } from "@/features/workspace/useWorkspaceChoice"

export default function WorkspacesSheet() {
	const { entries, choose } = useWorkspaceChoice()
	const sheet = useSheet()

	return (
		<Sheet title="Workspace">
			<SheetRows>
				{entries.map((entry) =>
					entry.kind === "createTeam" ? (
						<SheetRow
							key="create-team"
							icon={<IconPlus size={16} />}
							label="Create team"
							onClick={() => sheet.closeThen(() => choose(entry))}
						/>
					) : (
						<SheetRow
							key={entry.id}
							label={entry.label}
							value={entry.detail}
							check={entry.current}
							onClick={() => (entry.current ? sheet.close() : sheet.closeThen(() => choose(entry)))}
						/>
					),
				)}
			</SheetRows>
		</Sheet>
	)
}
