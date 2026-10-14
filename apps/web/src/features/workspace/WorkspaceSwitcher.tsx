import { useState } from "react"

import { IconChevronsUpDown } from "@/components/ui/icons"
import { Menu } from "@/components/ui/Menu"
import { edition } from "@/edition/edition"
import { useMe } from "@/features/auth/hooks/useMe"
import { toMenuItems } from "@/features/workspace/switcherEntries"
import { useWorkspaceChoice } from "@/features/workspace/useWorkspaceChoice"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"

export const WorkspaceSwitcher = () => {
	const me = useMe()
	const kind = useWorkspaceKind()
	const { entries, choose, dialog } = useWorkspaceChoice()
	const [anchor, setAnchor] = useState<DOMRect | null>(null)
	const line = edition.accountLine(kind, me.data?.workspaceName)

	if (entries.length < 2) {
		if (line === null) return null
		return (
			<div className="truncate text-muted" style={{ fontSize: 13, marginTop: 2 }}>
				{line}
			</div>
		)
	}

	return (
		<>
			<button
				type="button"
				title="Switch workspace"
				aria-label={`Switch workspace, ${line ?? ""}`}
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
				className="inline-flex max-w-full items-center text-muted transition-colors duration-(--duration-row) ease-(--ease-arrive) hover:text-ink"
				style={{ fontSize: 13, marginTop: 2, gap: 4 }}
			>
				<span className="truncate">{line}</span>
				<IconChevronsUpDown size={12} className="flex-none" />
			</button>
			{anchor ? (
				<Menu
					anchor={anchor}
					width={240}
					ariaLabel="Workspaces"
					onClose={() => setAnchor(null)}
					items={toMenuItems(entries, (entry) => {
						setAnchor(null)
						choose(entry)
					})}
				/>
			) : null}
			{dialog}
		</>
	)
}
