import { useEffect, useRef, useState } from "react"

import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { continuationInstruction } from "@/features/artifact/continuation"

/**
 * "Use in Claude" (reading view and full-width header): a popover with the continuation instruction and one Copy
 * button. Opening it moves focus to Copy. It closes on Escape (claimed, so the pane under it stays, and focus goes
 * back to its button), on a click outside, on focus leaving it, and when the window loses focus to the file's frame.
 */
export const UseInClaude = ({ artifactId }: { artifactId: string }) => {
	const toast = useToast()
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const copyRef = useRef<HTMLDivElement>(null)
	const instruction = continuationInstruction(artifactId)

	useEffect(() => {
		if (!open) return
		copyRef.current?.querySelector("button")?.focus()
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return
			event.preventDefault()
			setOpen(false)
			rootRef.current?.querySelector("button")?.focus()
		}
		const onPointerDown = (event: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
		}
		// A click into the file's frame never reaches this document; the window losing focus is the sign of it.
		const onBlur = () => setOpen(false)
		document.addEventListener("keydown", onKeyDown)
		document.addEventListener("pointerdown", onPointerDown)
		window.addEventListener("blur", onBlur)
		return () => {
			document.removeEventListener("keydown", onKeyDown)
			document.removeEventListener("pointerdown", onPointerDown)
			window.removeEventListener("blur", onBlur)
		}
	}, [open])

	const copy = () => {
		navigator.clipboard
			.writeText(instruction)
			.then(() => {
				toast("Copied. Paste it into a conversation with Exagram connected.")
				setOpen(false)
			})
			.catch(() => toast("Could not copy the instruction"))
	}

	return (
		<div
			ref={rootRef}
			className="relative flex-none"
			onBlur={(event) => {
				// Tabbing on past the popover (to Share, say) closes it, so it never sits open behind another layer.
				if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
			}}
		>
			<Button
				variant="outline"
				size={32}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				style={{ padding: "0 10px" }}
			>
				Use in Claude
			</Button>
			{open ? (
				<div
					role="dialog"
					aria-label="Use in Claude"
					className="absolute whitespace-normal"
					style={{
						right: 0,
						top: 38,
						zIndex: 20,
						width: 340,
						background: "var(--color-panel)",
						border: "1px solid var(--color-line-faint)",
						borderRadius: "var(--radius)",
						boxShadow: "var(--shadow-menu)",
						padding: "14px 16px 16px",
						animation: "fadeUp var(--duration-panel) var(--ease-arrive)",
					}}
				>
					<p className="m-0 text-muted" style={{ fontSize: 13, lineHeight: 1.5, textWrap: "pretty" }}>
						Paste this into a conversation in Claude, or in ChatGPT with the Exagram app added, to carry on from this
						artifact.
					</p>
					<p
						className="font-mono m-0 border border-line-faint bg-subtle text-ink"
						style={{
							marginTop: 10,
							padding: "10px 12px",
							borderRadius: "var(--radius)",
							fontSize: 12,
							lineHeight: 1.55,
							wordBreak: "break-word",
						}}
					>
						{instruction}
					</p>
					<div ref={copyRef} className="flex justify-end" style={{ marginTop: 12 }}>
						<Button size={32} onClick={copy} style={{ padding: "0 14px" }}>
							Copy
						</Button>
					</div>
				</div>
			) : null}
		</div>
	)
}
