import { type CSSProperties, type ReactNode } from "react"

import { Sheet } from "@/components/mobile/sheet/Sheet"
import { SkeletonText } from "@/components/ui/Skeleton"
import { buttonStyle, outlineButtonClass } from "@/features/artifact/sheets/sheetData"

/** A drawer waiting on its data. */
export const SheetLoading = ({ title }: { title: string }) => (
	<Sheet title={title}>
		<SkeletonText label="Loading…" lines={3} style={{ padding: "8px 16px 16px" }} />
	</Sheet>
)

/** Body copy inside a drawer that has nothing to list: gone, refused, or not yours to change. */
export const SheetNote = ({ children, role }: { children: ReactNode; role?: "alert" }) => (
	<p role={role} className="text-muted" style={{ padding: "4px 16px 12px", fontSize: 14, lineHeight: 1.5 }}>
		{children}
	</p>
)

/** The file is no longer there for this person: deleted, or its access removed. */
export const SheetGone = () => (
	<Sheet title="File unavailable">
		<SheetNote>This file was deleted or is no longer shared with you.</SheetNote>
	</Sheet>
)

/** The uppercase label over a drawer section: PEOPLE WITH ACCESS, POLICY FOR CONNECTIONS. */
export const SheetLabel = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
	<div
		className="text-label"
		style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", ...style }}
	>
		{children}
	</div>
)

/**
 * Asks before something that cannot be undone from the phone (Delete), in place of the drawer's rows:
 * what happens, then Cancel and the danger action (desktop's DeleteArtifactDialog semantics).
 */
export const ConfirmPanel = ({
	message,
	confirmLabel,
	busyLabel = "Deleting…",
	confirmDisabled = false,
	busy,
	onCancel,
	onConfirm,
	children,
}: {
	message: ReactNode
	confirmLabel: string
	busyLabel?: string
	confirmDisabled?: boolean
	busy: boolean
	onCancel: () => void
	onConfirm: () => void
	children?: ReactNode
}) => (
	<div style={{ padding: "4px 16px 8px" }}>
		<p className="text-body" style={{ fontSize: 14.5, lineHeight: 1.5 }}>
			{message}
		</p>
		{children}
		<div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 18 }}>
			<button type="button" onClick={onCancel} className={outlineButtonClass} style={buttonStyle}>
				Cancel
			</button>
			<button
				type="button"
				onClick={onConfirm}
				disabled={busy || confirmDisabled}
				className="bg-danger-bg text-danger active:bg-danger-hover disabled:opacity-50"
				style={buttonStyle}
			>
				{busy ? busyLabel : confirmLabel}
			</button>
		</div>
	</div>
)
