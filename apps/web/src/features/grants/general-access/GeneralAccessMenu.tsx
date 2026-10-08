import { type GeneralAccess, type VisibleArtifact, type WorkspaceKind } from "@exagram/api-client"
import { useState } from "react"

import { IconChevronDown } from "@/components/ui/icons"
import { Menu, type MenuItem } from "@/components/ui/Menu"
import { edition } from "@/edition/edition"
import { generalAccessLabel, generalAccessOptionsFor } from "@/features/grants/general-access/generalAccess"

export const GeneralAccessMenu = ({
	artifact,
	kind,
	disabled,
	onChange,
}: {
	artifact: Pick<VisibleArtifact, "generalAccess" | "workspaceName" | "orgDomain">
	kind: WorkspaceKind
	disabled?: boolean
	onChange: (generalAccess: GeneralAccess) => void
}) => {
	const [anchor, setAnchor] = useState<DOMRect | null>(null)
	const items: MenuItem[] = generalAccessOptionsFor(kind, edition.generalAccessOrg).map((option) => ({
		label: option.label(artifact),
		checked: option.value === artifact.generalAccess,
		disabled: option.value === "org" && !artifact.orgDomain && artifact.generalAccess !== "org",
		onSelect: () => {
			setAnchor(null)
			if (option.value !== artifact.generalAccess) onChange(option.value)
		},
	}))

	return (
		<>
			<button
				type="button"
				aria-label="General access"
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				disabled={disabled}
				onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
				className="inline-flex items-center bg-transparent text-ink hover:bg-row-selected disabled:opacity-60"
				style={{ height: 32, padding: "0 6px 0 10px", gap: 6, borderRadius: 8, border: 0, fontSize: 15 }}
			>
				{generalAccessLabel(artifact)}
				<IconChevronDown size={14} className="flex-none" style={{ color: "var(--color-muted)" }} />
			</button>
			{anchor ? (
				<Menu
					anchor={anchor}
					items={items}
					onClose={() => setAnchor(null)}
					ariaLabel="General access"
					width={320}
					footer={
						<p className="m-0 text-muted" style={{ fontSize: 13, lineHeight: 1.45, padding: "6px 12px 4px" }}>
							People with the link can view, but not edit.
						</p>
					}
				/>
			) : null}
		</>
	)
}
