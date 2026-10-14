import type { ComponentProps, ReactNode } from "react"

/**
 * One rounded card centred on the canvas, shared by every page that signs someone in or answers a link. `hideTitle`
 * keeps the page's `<h1>` for screen readers when the card's first step needs no heading; `below` sits under the
 * card, outside it.
 */
export const AuthCard = ({
	title,
	hideTitle = false,
	below,
	children,
}: {
	title: string
	hideTitle?: boolean
	below?: ReactNode
	children: ReactNode
}) => (
	<main
		className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ground px-4"
		style={{
			paddingTop: "max(40px, env(safe-area-inset-top))",
			paddingBottom: "max(40px, env(safe-area-inset-bottom))",
		}}
	>
		<div className="w-full max-w-[400px] rounded-[20px] border border-line bg-panel p-6 shadow-sheet sm:p-8">
			<h1
				className={
					hideTitle ? "sr-only" : "font-display mb-5 text-[22px] leading-tight font-semibold text-balance break-words"
				}
			>
				{title}
			</h1>
			{children}
		</div>
		{below ? <div className="flex w-full max-w-[400px] justify-center">{below}</div> : null}
	</main>
)

const inputShape =
	"w-full rounded-[10px] border border-line-strong bg-panel outline-0 placeholder:text-muted-2 focus:border-ink"

/** 16px type, so iOS does not zoom the page when a field takes focus. */
export const authInputClass = `h-11 px-3.5 text-[16px] ${inputShape}`

/** The left padding adds back the letter-spacing that trails the last digit, so the six sit centred. */
export const authCodeClass = `h-14 pr-3.5 pl-[calc(14px+0.4em)] text-center font-mono text-[28px] tracking-[0.4em] ${inputShape}`

export const AuthField = ({
	id,
	label,
	hideLabel = false,
	inputClass = authInputClass,
	...rest
}: { id: string; label: string; hideLabel?: boolean; inputClass?: string } & ComponentProps<"input">) => (
	<div>
		<label htmlFor={id} className={hideLabel ? "sr-only" : "mb-2 block text-[14px] font-semibold"}>
			{label}
		</label>
		<input id={id} className={inputClass} {...rest} />
	</div>
)

export const authPrimaryClass =
	"press flex h-11 w-full items-center justify-center rounded-[10px] bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"

const outlineBase =
	"press flex h-11 items-center justify-center gap-2.5 rounded-[10px] border border-line-strong bg-panel text-[15px] font-medium text-ink"

const outlineShape = `${outlineBase} w-full`

/** The outlined white button: a social sign-in and a secondary choice beside a primary one. */
export const authOutlineClass = `${outlineShape} hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50`

/** Sized to its label, for Download desktop app under the card. */
export const authOutlineCompactClass = `${outlineBase} px-5 hover:bg-hover`

export const authOutlineDisabledClass = `${outlineShape} cursor-not-allowed opacity-50`

/** A quiet button that reads as a link: Use password instead, Resend, Use a different email. */
export const authTextButtonClass =
	"text-[14px] text-muted underline underline-offset-[3px] hover:text-ink disabled:cursor-default disabled:no-underline disabled:hover:text-muted"
