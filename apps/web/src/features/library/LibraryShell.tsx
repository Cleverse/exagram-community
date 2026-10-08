import { type ReactNode } from "react"

import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton"
import { LIST_MIN_WIDTH } from "@/features/library/hooks/useListWidth"

/**
 * The frame both the library scopes and a Project page render into: the list column and the preview pane
 * beside it, filling the shell's main area. With the pane open the list is sized (`flex: 0 1 <w>px`, at
 * least 300px, T:L4516) and the pane fills the rest; the width never animates, so a drag tracks the
 * pointer. A file dropped anywhere is the shell's to upload.
 */
export const LibraryShell = ({
	preview,
	listWidth,
	children,
}: {
	preview?: ReactNode
	/** The list's width beside an open pane; ignored while no pane is open. */
	listWidth?: number
	children: ReactNode
}) => (
	<div className="flex h-full" style={{ minHeight: 560 }}>
		<div
			className="flex flex-col"
			style={{
				flex: preview && listWidth !== undefined ? `0 1 ${listWidth}px` : "1 1 0",
				minWidth: LIST_MIN_WIDTH,
			}}
		>
			{children}
		</div>
		{preview}
	</div>
)

/**
 * The frame a list screen draws before it knows what it is showing — a Project page whose Project has not
 * loaded yet, say: the header's place, then placeholder rows where the list will be.
 */
export const LibraryShellSkeleton = ({ label = "Loading…" }: { label?: string }) => (
	<LibraryShell>
		<div className="flex-none" style={{ padding: "20px 28px 0" }}>
			<div className="flex flex-col justify-end" style={{ gap: 10, minHeight: 48 }}>
				<Skeleton width={96} height={10} />
				<Skeleton width={220} height={20} radius={5} />
			</div>
			<div style={{ marginTop: 12, paddingBottom: 10, borderBottom: "1px solid var(--color-pane-line)" }}>
				<Skeleton width={120} height={10} style={{ marginLeft: 10 }} />
			</div>
		</div>
		<div className="flex-1 overflow-hidden" style={{ padding: "0 28px 48px" }}>
			<SkeletonRows label={label} count={8} />
		</div>
	</LibraryShell>
)
