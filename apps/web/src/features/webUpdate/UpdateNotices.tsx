import { UPDATE_NOTICE } from "./webVersion"

import type { ReactNode } from "react"

import { Button } from "@/components/ui/Button"

/**
 * A card pinned to the top centre, above every screen and the full view (like the toast, z 1000). The top keeps it
 * clear of the toast at the bottom and of the phone's floating New button.
 */
const NoticeCard = ({ children }: { children: ReactNode }) => (
	<div
		role="region"
		aria-label="Exagram update"
		className="fixed flex items-center bg-white"
		style={{
			top: "calc(env(safe-area-inset-top, 0px) + 12px)",
			left: "50%",
			transform: "translateX(-50%)",
			zIndex: 1000,
			gap: 12,
			padding: "8px 8px 8px 16px",
			borderRadius: "var(--radius-dialog)",
			boxShadow: "var(--shadow-toast)",
			fontSize: 14,
			color: "var(--color-ink)",
			maxWidth: "calc(100vw - 32px)",
			animation: "fadeUp var(--duration-panel) var(--ease-arrive)",
		}}
	>
		{children}
	</div>
)

/** The seconds left before an update reload, with Reload now and Cancel. */
export const ReloadCountdown = ({
	seconds,
	onReload,
	onCancel,
}: {
	seconds: number
	onReload: () => void
	onCancel: () => void
}) => (
	<NoticeCard>
		{/* Read out once, not every second: the number changes, the sentence's meaning does not. */}
		<span aria-live="off" style={{ fontVariantNumeric: "tabular-nums" }}>
			{UPDATE_NOTICE.countdown(seconds)}
		</span>
		<Button variant="outline" size={32} onClick={onCancel}>
			Cancel
		</Button>
		<Button size={32} onClick={onReload}>
			Reload now
		</Button>
	</NoticeCard>
)

/** Stays after Cancel until the reader reloads; Reload waits while an upload is in flight. */
export const UpdateBanner = ({ uploading, onReload }: { uploading: boolean; onReload: () => void }) => (
	<NoticeCard>
		<span>{uploading ? UPDATE_NOTICE.bannerUploading : UPDATE_NOTICE.banner}</span>
		<Button size={32} disabled={uploading} onClick={onReload}>
			Reload
		</Button>
	</NoticeCard>
)
