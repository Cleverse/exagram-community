import { type ReactNode, useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import { IconClose } from "@/components/ui/icons"

/**
 * Present mode. The 36px bar shows the header's path line at 13px — `folder / title TYPE` —
 * and only Exit · Esc on the right; ↑ ↓ / j k still step files from the keyboard (they live on `PreviewPane`). A portal onto `document.body`: a fixed,
 * full-viewport layer above the pane's full view (z-index 200), so it covers every app chrome — a 36px top
 * bar over the document canvas. It does not ask for the browser's real full screen (a later product
 * decision); the fixed layer alone is Present.
 */
export const PresentMode = ({
	title,
	folderName,
	typeLabel,
	onExit,
	children,
}: {
	title: string
	folderName: string
	/** The kind in capitals, as the header's path line shows it (MD, HTML…). */
	typeLabel: string
	onExit: () => void
	children: ReactNode
}) => {
	const exitButtonRef = useRef<HTMLButtonElement>(null)
	const previousFocusRef = useRef<Element | null>(null)
	const exitedRef = useRef(false)

	// Exit and Escape both funnel through here, so the two can't call `onExit` twice between them.
	const exitOnce = useCallback(() => {
		if (exitedRef.current) return
		exitedRef.current = true
		onExit()
	}, [onExit])

	useEffect(() => {
		previousFocusRef.current = document.activeElement
		exitButtonRef.current?.focus()
		return () => {
			if (previousFocusRef.current instanceof HTMLElement) previousFocusRef.current.focus()
		}
	}, [])

	// ↑/↓/j/k live on `PreviewPane` (it owns that keyboard everywhere, Present included) and switch
	// themselves off around a `[role="menu"|"dialog"|"listbox"]`; Escape stays here, on `document`, so the
	// list's and `ArtifactPage`'s window-level Escape handlers see it already `defaultPrevented` and leave
	// it alone.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			event.preventDefault()
			exitOnce()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [exitOnce])

	return createPortal(
		<div
			role="region"
			aria-label={`Presenting ${title}`}
			data-presenting
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 300,
				display: "flex",
				flexDirection: "column",
				background: "var(--color-panel)",
			}}
		>
			<div
				style={{
					flex: "none",
					display: "flex",
					alignItems: "center",
					gap: 4,
					height: 36,
					padding: "0 8px 0 14px",
					background: "var(--color-panel)",
					borderBottom: "1px solid var(--color-pane-line)",
					minWidth: 0,
				}}
			>
				<span className="text-muted" style={{ fontSize: 13, whiteSpace: "nowrap", flex: "none" }}>
					{folderName}
				</span>
				<span aria-hidden className="text-path-slash" style={{ fontSize: 13, flex: "none", padding: "0 6px" }}>
					/
				</span>
				<span
					className="text-ink"
					style={{
						fontSize: 13,
						fontWeight: 600,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						minWidth: 0,
						flex: "0 1 auto",
					}}
				>
					{title}
				</span>
				<span
					className="text-muted-2"
					style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".04em", flex: "none", marginLeft: 6 }}
				>
					{typeLabel}
				</span>
				<div style={{ flex: 1 }} />
				<button
					ref={exitButtonRef}
					type="button"
					onClick={exitOnce}
					className="press flex flex-none items-center whitespace-nowrap text-body hover:bg-hover hover:text-ink"
					style={{ gap: 6, height: 28, padding: "0 8px", borderRadius: "var(--radius)", fontSize: 12, fontWeight: 500 }}
				>
					<IconClose size={13} strokeWidth={2} />
					Exit
					<span aria-hidden className="font-mono text-muted-2" style={{ fontSize: 10, marginLeft: 2 }}>
						Esc
					</span>
				</button>
			</div>
			<div
				style={{
					flex: 1,
					minHeight: 0,
					display: "flex",
					flexDirection: "column",
					overflow: "auto",
					background: "var(--color-ground)",
				}}
			>
				{children}
			</div>
		</div>,
		document.body,
	)
}
