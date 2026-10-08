import { IconLink, IconMaximize, IconPin, IconShield, IconSparkle } from "@/components/ui/icons"
import { type MenuItem } from "@/components/ui/Menu"

/**
 * What the docked pane's ⋯ menu adds in front (v5 §6): Present when the header has no room for its button,
 * Copy link, and Pin / Unpin. Full view passes none and keeps its menu as it was.
 */
export type DockedMenu = {
	/** Null while the header shows the Present button. */
	onPresent: (() => void) | null
	onCopyLink: () => void
	isPinned: boolean
	onTogglePin: () => void
}

/**
 * The pane ⋯ menu's item order: in the docked pane Present, Copy link and Pin / Unpin first; then …Move project,
 * Links…, then the owner's AI group (Redaction…, View as AI), Comments, Ledger, then Delete last behind a divider.
 * The docked menu's Pin / Unpin replaces `pinItem` ("Pin for org") from `items`, so the menu has one pin toggle.
 */
export const composePreviewMenuItems = ({
	items,
	pinItem,
	deleteItem,
	docked,
	isOwner,
	viewAsAi,
	redactionEnabled,
	onLinks,
	onRedaction,
	onViewAsAi,
	onComments,
	onLedger,
}: {
	items: MenuItem[]
	pinItem: MenuItem | null
	deleteItem: MenuItem | null
	docked: DockedMenu | null
	isOwner: boolean
	viewAsAi: boolean
	redactionEnabled: boolean
	onLinks: () => void
	onRedaction: () => void
	onViewAsAi: () => void
	onComments: () => void
	onLedger: () => void
}): MenuItem[] => [
	...(docked
		? [
				...(docked.onPresent
					? [{ label: "Present", icon: <IconMaximize size={16} />, onSelect: docked.onPresent }]
					: []),
				{ label: "Copy link", icon: <IconLink size={16} />, onSelect: docked.onCopyLink },
				{
					label: docked.isPinned ? "Unpin" : "Pin",
					icon: <IconPin size={16} fill={docked.isPinned ? "currentColor" : "none"} />,
					onSelect: docked.onTogglePin,
				},
				...items.filter((item) => item !== pinItem),
			]
		: items),
	...(isOwner
		? [
				{ label: "Links…", icon: <IconLink size={16} />, onSelect: onLinks },
				...(redactionEnabled
					? [
							{ label: "Redaction…", icon: <IconShield size={16} />, dividerAbove: true, onSelect: onRedaction },
							{
								label: viewAsAi ? "Exit AI view" : "View as AI",
								icon: <IconSparkle size={16} />,
								onSelect: onViewAsAi,
							},
						]
					: []),
			]
		: []),
	{ label: "Comments", dividerAbove: true, onSelect: onComments },
	...(isOwner ? [{ label: "Ledger", onSelect: onLedger }] : []),
	...(deleteItem ? [deleteItem] : []),
]
