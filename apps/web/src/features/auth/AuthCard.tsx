import type { InputHTMLAttributes, ReactNode } from "react"

const DOTS = [
	"rgba(150,90,222,.16)",
	"rgba(150,90,222,.5)",
	"rgba(150,90,222,.16)",
	"rgba(150,90,222,.5)",
	"rgba(104,110,230,.95)",
	"rgba(150,90,222,.5)",
	"rgba(150,90,222,.16)",
	"rgba(150,90,222,.5)",
	"rgba(150,90,222,.16)",
]

/** The dark brand pill above the auth card (the old handoff prototype, line 25); the app shell has its own mark. */
const BrandPill = () => (
	<div className="flex h-11 flex-none items-center gap-2.5 bg-rail-pill px-[18px]">
		<div
			aria-hidden
			className="flex-none"
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(3,5px)",
				gridTemplateRows: "repeat(3,5px)",
				gap: "1.5px",
			}}
		>
			{DOTS.map((tone, index) => (
				<div key={index} style={{ background: tone }} />
			))}
		</div>
		<div className="font-sans text-[13px] font-semibold tracking-[.16em] text-ground">EXAGRAM</div>
	</div>
)

/**
 * The prototype has no auth screen; this is its dialog surface (line 1003) centred on the canvas,
 * with the Screen 2 field styles.
 */
export const AuthCard = ({ title, children }: { title: string; children: ReactNode }) => (
	<div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ground p-6">
		<BrandPill />
		<div className="w-full max-w-[420px] overflow-hidden rounded-(--radius-dialog) bg-surface shadow-dialog">
			<div className="flex items-center gap-3 border-b border-line px-6 py-5">
				<h1 className="font-display min-w-0 flex-1 truncate text-[20px] font-semibold">{title}</h1>
			</div>
			<div className="p-6">{children}</div>
		</div>
	</div>
)

export const authInputClass =
	"h-11 w-full border border-line-soft bg-white px-3.5 text-[15px] outline-0 focus:border-ink"

export const AuthField = ({
	id,
	label,
	...rest
}: { id: string; label: string } & InputHTMLAttributes<HTMLInputElement>) => (
	<div>
		<label htmlFor={id} className="mb-2 block text-[14px] font-semibold">
			{label}
		</label>
		<input id={id} className={authInputClass} {...rest} />
	</div>
)

export const authPrimaryClass =
	"flex h-11 w-full items-center justify-center bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
