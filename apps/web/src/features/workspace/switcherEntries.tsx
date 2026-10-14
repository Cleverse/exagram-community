import { type Me } from "@exagram/api-client"

import { IconPlus } from "@/components/ui/icons"
import { type MenuItem } from "@/components/ui/Menu"

export type SwitcherEntry =
	| { kind: "workspace"; id: string; label: string; detail: string | undefined; current: boolean }
	| { kind: "createTeam" }

type LiveWorkspace = Me["workspaces"][number]

export const workspaceLabel = (workspace: Pick<LiveWorkspace, "kind" | "name">) =>
	workspace.kind === "personal" ? "Personal" : workspace.name

export const switcherEntries = (
	me: Pick<Me, "workspaceId" | "workspaces">,
	canCreateTeam: boolean,
): SwitcherEntry[] => {
	const entries: SwitcherEntry[] = me.workspaces.map((workspace) => ({
		kind: "workspace",
		id: workspace.id,
		label: workspaceLabel(workspace),
		detail: workspace.kind === "team" ? "Team" : undefined,
		current: workspace.id === me.workspaceId,
	}))
	const hasTeam = me.workspaces.some((workspace) => workspace.kind === "team")
	return canCreateTeam && !hasTeam ? [...entries, { kind: "createTeam" }] : entries
}

export const toMenuItems = (entries: SwitcherEntry[], onChoose: (entry: SwitcherEntry) => void): MenuItem[] =>
	entries.map((entry) =>
		entry.kind === "createTeam"
			? { label: "Create team", icon: <IconPlus size={15} />, dividerAbove: true, onSelect: () => onChoose(entry) }
			: {
					label: entry.label,
					...(entry.detail === undefined ? {} : { detail: entry.detail }),
					checked: entry.current,
					onSelect: () => onChoose(entry),
				},
	)
