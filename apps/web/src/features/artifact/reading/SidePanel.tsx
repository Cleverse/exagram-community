import { type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"

import { IconButton, IconClose } from "@/components/ui"
import { CommentsPanel } from "@/features/artifact/CommentsPanel"
import { LedgerTab } from "@/features/artifact/LedgerTab"

/** The pane's side panels. History is its own 300px panel; Comments and the Ledger share this one. */
export type PanelTab = "history" | SideTab
export type SideTab = "comments" | "ledger"

const TITLE: Record<SideTab, string> = {
	comments: "Comments",
	ledger: "Ledger",
}

/**
 * Comments and the Ledger, switchable between each other. History is not a tab here: it is a modal
 * (`HistoryDialog`), opened from the full view's History icon and the ⋯ menu's "Revision history".
 */
export const SidePanel = ({
	artifact,
	tab,
	tabs,
	onTab,
	onClose,
}: {
	artifact: VisibleArtifact
	tab: SideTab
	tabs: SideTab[]
	onTab: (next: SideTab) => void
	onClose: () => void
}) => (
	<aside className="flex min-w-80 max-w-[460px] flex-[0_1_460px] flex-col border-l border-line bg-white">
		<div className="flex flex-none items-center gap-3 border-b border-line p-4">
			<h2 className="font-display min-w-0 flex-1 truncate text-[18px] font-semibold">{TITLE[tab]}</h2>
			<IconButton aria-label="Close panel" onClick={onClose} style={{ color: "var(--color-secondary)" }}>
				<IconClose />
			</IconButton>
		</div>

		<div role="tablist" aria-label="Artifact panel" className="flex flex-none gap-1 border-b border-line px-4 py-2">
			{tabs.map((candidate) => (
				<button
					key={candidate}
					type="button"
					role="tab"
					aria-selected={tab === candidate}
					onClick={() => onTab(candidate)}
					className={clsx(
						"flex h-[34px] items-center px-3 text-[14px]",
						tab === candidate ? "bg-chip font-semibold" : "text-secondary hover:bg-menu-hover",
					)}
				>
					{TITLE[candidate]}
				</button>
			))}
		</div>

		<div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{tab === "comments" ? <CommentsPanel artifactId={artifact.id} /> : null}
			{tab === "ledger" ? <LedgerTab artifactId={artifact.id} currentRevisionId={artifact.currentRevisionId} /> : null}
		</div>
	</aside>
)
