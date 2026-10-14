import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react"

const ToastContext = createContext<((message: string) => void) | null>(null)

export const useToast = () => {
	const show = useContext(ToastContext)
	if (!show) throw new Error("useToast must be used inside ToastProvider")
	return show
}

/** The exit: the toast drops back the way it rose, then unmounts. */
const TOAST_EXIT_MS = 150

/** Prototype TOAST section (Exagram Team.dc.html lines 1057–1059); dismisses after 2600ms. */
export const ToastProvider = ({ children }: { children: ReactNode }) => {
	// `shown` goes false for the exit transition; the toast unmounts TOAST_EXIT_MS later.
	const [toast, setToast] = useState<{ message: string; shown: boolean } | null>(null)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const show = useCallback((next: string) => {
		if (timer.current !== null) clearTimeout(timer.current)
		setToast({ message: next, shown: true })
		timer.current = setTimeout(() => {
			setToast((current) => (current === null ? null : { ...current, shown: false }))
			timer.current = setTimeout(() => setToast(null), TOAST_EXIT_MS)
		}, 2600)
	}, [])

	useEffect(
		() => () => {
			if (timer.current !== null) clearTimeout(timer.current)
		},
		[],
	)

	return (
		<ToastContext.Provider value={show}>
			{children}
			{toast === null ? null : (
				<div
					role="status"
					aria-live="polite"
					className="fixed"
					style={{
						// Centred by its margins, not a transform: the entry and exit own `transform`.
						left: 0,
						right: 0,
						marginInline: "auto",
						width: "fit-content",
						// The mobile shell raises it over its floating New button (css/mobile.css).
						bottom: "var(--toast-bottom, 28px)",
						// Above the full view (200) and Present, which cover the viewport; otherwise a toast fired
						// from there never shows.
						zIndex: 1000,
						background: "var(--color-ink)",
						color: "var(--color-ground)",
						padding: "14px 20px",
						borderRadius: "var(--radius)",
						fontSize: 15,
						boxShadow: "var(--shadow-toast)",
						animation: "fadeUp 200ms var(--ease-arrive)",
						opacity: toast.shown ? 1 : 0,
						transform: toast.shown ? "none" : "translateY(8px)",
						transition: `opacity ${TOAST_EXIT_MS}ms var(--ease-arrive), transform ${TOAST_EXIT_MS}ms var(--ease-arrive)`,
						maxWidth: "90vw",
					}}
				>
					{toast.message}
				</div>
			)}
		</ToastContext.Provider>
	)
}
