import { type ReactNode, useContext } from "react"

import { SheetFrameContext } from "./context"

import { IconChevronLeft, IconClose } from "@/components/ui/icons"

/**
 * One drawer level: grabber, header (Back on a sub-level, a 16/600 title with an optional subtitle, ×) and a
 * scrolling body. Height fits the content up to the screen less 64px; `full` takes that whole height (Search).
 * Web variant, `Exagram Mobile Web.dc.html` L616–632.
 */
export const Sheet = ({
	title,
	sub,
	full = false,
	wrapTitle = false,
	children,
}: {
	title: string
	sub?: string
	full?: boolean
	wrapTitle?: boolean
	children: ReactNode
}) => {
	const frame = useContext(SheetFrameContext)
	if (!frame) throw new Error("<Sheet> renders inside a SheetProvider drawer")
	return (
		<div className="flex flex-col" style={{ minHeight: 0, flex: full ? "1 1 calc(100dvh - 64px)" : "0 1 auto" }}>
			<div {...frame.dragHandleProps} className="flex-none" style={{ touchAction: "none", cursor: "grab" }}>
				<div className="grid place-items-center" style={{ height: 18 }}>
					<div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--color-line-segment)" }} />
				</div>
				<div
					className="flex items-center border-b border-row-line"
					style={{ gap: 4, padding: "0 10px 10px 16px", minHeight: 46, marginBottom: 6 }}
				>
					{frame.depth > 1 ? (
						<button
							type="button"
							aria-label="Back"
							onClick={frame.back}
							className="grid flex-none place-items-center active:bg-hover"
							style={{ width: 44, height: 44, margin: "-4px -4px -4px -12px" }}
						>
							<IconChevronLeft size={20} />
						</button>
					) : null}
					<div className="min-w-0 flex-1">
						<div
							id={frame.titleId}
							className={wrapTitle ? "break-words" : "truncate"}
							style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}
						>
							{title}
						</div>
						{sub ? (
							<div className={`${wrapTitle ? "break-words" : "truncate"} text-muted-2`} style={{ fontSize: 12.5 }}>
								{sub}
							</div>
						) : null}
					</div>
					<button
						type="button"
						aria-label="Close"
						onClick={frame.close}
						className="grid flex-none place-items-center text-secondary active:bg-hover"
						style={{ width: 44, height: 44, margin: -4 }}
					>
						<IconClose size={17} />
					</button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
		</div>
	)
}
