import type { CSSProperties, ReactNode, SVGProps } from "react"

/**
 * Line icons, copied out of the Aura Matrix prototype. Glyphs the prototype has no equivalent for keep
 * their earlier Lucide-style paths. Glyphs taken from Lucide (ISC) and its Feather-derived icons (MIT) are used under
 * the notices in `icons.LICENSE`, which must travel with this file. Every icon draws in `currentColor`: colour one with `color` on
 * the icon (`style` or a `text-…` class) — `var()` does not resolve in SVG presentation attributes.
 * `size` sets both width and height; each glyph carries the prototype's own stroke weight.
 */
export type IconProps = {
	size?: number
	className?: string
	style?: CSSProperties
	/** Only for glyphs that fill on a state, e.g. a pinned pin. */
	fill?: "currentColor" | "none"
	strokeWidth?: number
	"aria-hidden"?: boolean
}

type Shape = {
	children: ReactNode
	/** `currentColor` draws a solid glyph with no stroke (the ⋯ dots). */
	fill?: "currentColor"
	strokeWidth: number
	strokeLinecap?: SVGProps<SVGSVGElement>["strokeLinecap"]
	strokeLinejoin?: SVGProps<SVGSVGElement>["strokeLinejoin"]
	defaultSize?: number
}

const icon =
	(shape: Shape) =>
	({ size, className, style, fill, strokeWidth, ...rest }: IconProps) => {
		const solid = shape.fill === "currentColor"
		return (
			<svg
				width={size ?? shape.defaultSize ?? 16}
				height={size ?? shape.defaultSize ?? 16}
				viewBox="0 0 24 24"
				fill={fill ?? shape.fill ?? "none"}
				stroke={solid ? "none" : "currentColor"}
				strokeWidth={solid ? undefined : (strokeWidth ?? shape.strokeWidth)}
				strokeLinecap={shape.strokeLinecap ?? "round"}
				strokeLinejoin={shape.strokeLinejoin ?? "round"}
				className={className}
				style={style}
				aria-hidden={rest["aria-hidden"] ?? true}
			>
				{shape.children}
			</svg>
		)
	}

const FOLDER = <path d="M5,8 L9,8 L11,6 L19,6 L19,19 L5,19 Z" />

/**
 * v3's blue project folder: a `folder` stroke over a `folder-fill` body, at 1.5. It colours
 * itself, through `style`, since `var()` does not resolve in presentation attributes. The sidebar's project
 * rows take 17px; `TypeIcon kind="folder"` draws it at 20px in list rows.
 */
export const IconProjectFolder = ({ size = 17, className }: { size?: number; className?: string }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		strokeWidth={1.5}
		strokeLinejoin="round"
		className={className}
		style={{ stroke: "var(--color-folder)" }}
		aria-hidden
	>
		<path d="M3,7 L9,7 L11,5 L21,5 L21,19 L3,19 Z" style={{ fill: "var(--color-folder-fill)" }} />
	</svg>
)

/** The same folder opened: the sidebar row of a Project whose folders show beneath it. */
export const IconProjectFolderOpen = ({ size = 17, className }: { size?: number; className?: string }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		strokeWidth={1.5}
		strokeLinejoin="round"
		className={className}
		style={{ stroke: "var(--color-folder)" }}
		aria-hidden
	>
		<path d="M3,19 L3,7 L9,7 L11,5 L19,5 L19,9" />
		<path d="M3,19 L6,10 L22,10 L19,19 Z" style={{ fill: "var(--color-folder-fill)" }} />
	</svg>
)

/* Hairline set (stroke 1.2): the sidebar, list header, row types and row actions. */

/** A markdown/document Artifact. */
export const IconFile = icon({
	strokeWidth: 1.2,
	children: (
		<>
			<path d="M7,4 L14,4 L17,7 L17,20 L7,20 Z" />
			<polyline points="14,4 14,7 17,7" />
		</>
	),
})

/** An HTML Artifact: a browser window. */
export const IconApp = icon({
	strokeWidth: 1.2,
	children: (
		<>
			<rect x="4" y="5" width="16" height="14" />
			<line x1="4" y1="9" x2="20" y2="9" />
			<circle cx="7" cy="7" r="0.7" fill="currentColor" stroke="none" />
		</>
	),
})

export const IconChat = icon({
	strokeWidth: 1.2,
	children: <path d="M5,6 L19,6 L19,15 L11,15 L8,19 L8,15 L5,15 Z" />,
})

export const IconFolder = icon({ strokeWidth: 1.2, children: FOLDER })

export const IconNewProject = icon({
	strokeWidth: 1.2,
	children: (
		<>
			{FOLDER}
			<path d="M12 10.5v5M9.5 13h5" />
		</>
	),
})

export const IconSearch = icon({
	strokeWidth: 1.2,
	children: (
		<>
			<circle cx="11" cy="11" r="6" />
			<line x1="15.5" y1="15.5" x2="19" y2="19" />
		</>
	),
})

export const IconUpload = icon({
	strokeWidth: 1.2,
	children: (
		<>
			<line x1="5" y1="19" x2="19" y2="19" />
			<polyline points="8,9 12,5 16,9" />
			<line x1="12" y1="5" x2="12" y2="15" />
		</>
	),
})

export const IconShare = icon({
	strokeWidth: 1.2,
	children: (
		<>
			<circle cx="6" cy="12" r="2.2" />
			<circle cx="18" cy="6" r="2.2" />
			<circle cx="18" cy="18" r="2.2" />
			<line x1="8" y1="10.8" x2="16" y2="7.2" />
			<line x1="8" y1="13.2" x2="16" y2="16.8" />
		</>
	),
})

/** Three people: a shared Artifact or project. */
export const IconPeople = icon({
	strokeWidth: 1.2,
	children: (
		<>
			<circle cx="12" cy="9" r="2.4" />
			<path d="M6,19 Q6,14 12,14 Q18,14 18,19" />
			<circle cx="5" cy="10" r="1.7" />
			<path d="M2,18 Q2,14.5 5,14.5" />
			<circle cx="19" cy="10" r="1.7" />
			<path d="M22,18 Q22,14.5 19,14.5" />
		</>
	),
})

/** One person: the sidebar's shared-project marker (drawn at 12px, stroke 1.4). */
export const IconPerson = icon({
	strokeWidth: 1.4,
	children: (
		<>
			<circle cx="12" cy="9" r="2.4" />
			<path d="M6,19 Q6,14 12,14 Q18,14 18,19" />
		</>
	),
})

export const IconCalendar = icon({
	strokeWidth: 1.2,
	children: (
		<>
			<rect x="4" y="5" width="16" height="15" />
			<line x1="4" y1="9.5" x2="20" y2="9.5" />
			<line x1="8.5" y1="3" x2="8.5" y2="6.5" />
			<line x1="15.5" y1="3" x2="15.5" y2="6.5" />
		</>
	),
})

export const IconShield = icon({
	strokeWidth: 1.2,
	children: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />,
})

/** The New button's plus (stroke 1.2); the sidebar's add-project plus passes `strokeWidth={2.2}`. */
export const IconPlus = icon({
	strokeWidth: 1.2,
	children: <path d="M12 5v14M5 12h14" />,
})

/** The redaction-row pencil. */
export const IconPencil = icon({
	defaultSize: 14,
	strokeWidth: 1.2,
	children: <path d="M4 20h4L19 9l-4-4L4 16z" />,
})

/* Heavier set: navigation, composer and pane chrome. */

/** The sidebar's Activity entry (pulse line). */
export const IconActivity = icon({
	strokeWidth: 1.4,
	children: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
})

/** The desktop sidebar's Inbox: a tray. */
export const IconInbox = icon({
	strokeWidth: 1.4,
	strokeLinejoin: "round",
	children: (
		<>
			<path d="M4 13.5 6.4 6.2A1.8 1.8 0 0 1 8.1 5h7.8a1.8 1.8 0 0 1 1.7 1.2L20 13.5" />
			<path d="M4 13.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5h-4.5l-1 2h-5l-1-2Z" />
		</>
	),
})

/** Collapse / expand the library sidebar. */
export const IconSidebar = icon({
	strokeWidth: 1.6,
	children: (
		<>
			<rect x="3" y="4" width="18" height="16" />
			<path d="M9 4v16" />
		</>
	),
})

/** The composer's send arrow. */
export const IconSend = icon({
	strokeWidth: 1.6,
	children: <path d="M12 19V5m-6 6 6-6 6 6" />,
})

/** The account switcher's up/down chevrons. */
export const IconChevronsUpDown = icon({
	strokeWidth: 1.6,
	children: <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />,
})

export const IconRefresh = icon({
	defaultSize: 14,
	strokeWidth: 1.6,
	children: (
		<>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" />
			<path d="M21 3v6h-6" />
		</>
	),
})

/** The sidebar's All artifacts entry (a 2×2 grid). */
export const IconGrid = icon({
	strokeWidth: 2,
	children: (
		<>
			<rect x="3" y="3" width="7" height="7" />
			<rect x="14" y="3" width="7" height="7" />
			<rect x="3" y="14" width="7" height="7" />
			<rect x="14" y="14" width="7" height="7" />
		</>
	),
})

/** Pass `fill="currentColor"` with an ink `color` when pinned. */
export const IconPin = icon({
	defaultSize: 17,
	strokeWidth: 2,
	children: <path d="M12 17v5M9 3h6l1 7 3 3H5l3-3z" />,
})

export const IconClose = icon({
	defaultSize: 18,
	strokeWidth: 2,
	children: <path d="M18 6 6 18M6 6l12 12" />,
})

export const IconChevronDown = icon({
	defaultSize: 14,
	strokeWidth: 2,
	children: <path d="m6 9 6 6 6-6" />,
})

export const IconChevronUp = icon({
	defaultSize: 14,
	strokeWidth: 2,
	children: <path d="m18 15-6-6-6 6" />,
})

/** The sidebar and breadcrumb caret. */
export const IconChevronRight = icon({
	strokeWidth: 2.4,
	children: <path d="m9 18 6-6-6-6" />,
})

export const IconChevronLeft = icon({
	strokeWidth: 2.4,
	children: <path d="m15 18-6-6 6-6" />,
})

/** The row and header ⋯. */
export const IconEllipsis = icon({
	defaultSize: 18,
	fill: "currentColor",
	strokeWidth: 0,
	children: (
		<>
			<circle cx="5" cy="12" r="2" />
			<circle cx="12" cy="12" r="2" />
			<circle cx="19" cy="12" r="2" />
		</>
	),
})

export const IconArrowUp = icon({
	defaultSize: 14,
	strokeWidth: 2.2,
	children: <path d="M12 19V5m0 0-5 5m5-5 5 5" />,
})

/** The Audit log's Filter button. */
export const IconFilter = icon({
	strokeWidth: 2,
	children: <path d="M3 6h18M7 12h10M10 18h4" />,
})

/** Settings' "Back to Exagram". */
export const IconArrowLeft = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
})

export const IconMinus = icon({
	defaultSize: 14,
	strokeWidth: 2.4,
	children: <path d="M5 12h14" />,
})

export const IconCheck = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: <path d="M20 6 9 17l-5-5" />,
})

/** The heavier check on the security page and the connection's capability list. */
export const IconCheckBold = icon({
	defaultSize: 18,
	strokeWidth: 2.4,
	children: <path d="m5 12 5 5L20 7" />,
})

/** A filled disc with a white tick; colour the disc with `color`. */
export const IconCheckCircle = ({ size = 18, className, style }: IconProps) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="currentColor"
		className={className}
		style={style}
		aria-hidden
	>
		<circle cx="12" cy="12" r="10" />
		<path
			d="m7.5 12.5 3 3 6-7"
			fill="none"
			stroke="white"
			strokeWidth="2.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

export const IconLink = icon({
	defaultSize: 17,
	strokeWidth: 2,
	children: (
		<>
			<path d="M10 14a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-.5.5" />
			<path d="M14 10a3.5 3.5 0 0 0-5 0l-4 4a3.5 3.5 0 0 0 5 5l.5-.5" />
		</>
	),
})

export const IconUnlink = icon({
	defaultSize: 17,
	strokeWidth: 2,
	children: (
		<>
			<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
			<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
		</>
	),
})

export const IconDownload = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: <path d="M12 4v12m0 0 4-4m-4 4-4-4M4 20h16" />,
})

export const IconPeoplePlus = icon({
	strokeWidth: 2,
	children: (
		<>
			<circle cx="9" cy="8" r="4" />
			<path d="M2 21a7 7 0 0 1 14 0" />
			<path d="M19 8v6M16 11h6" />
		</>
	),
})

export const IconDollar = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
})

export const IconSparkle = icon({
	defaultSize: 14,
	strokeWidth: 2,
	children: <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" />,
})

export const IconLightbulb = icon({
	defaultSize: 18,
	strokeWidth: 2,
	children: (
		<>
			<path d="M9 18h6" />
			<path d="M10 22h4" />
			<path d="M12 2a7 7 0 0 0-4 12.7c.4.3.6.7.7 1.1l.3 1.2h6l.3-1.2c.1-.4.3-.8.7-1.1A7 7 0 0 0 12 2Z" />
		</>
	),
})

/** The reading-view toolbar button that returns to the library. */
export const IconHome = icon({
	defaultSize: 22,
	strokeWidth: 2,
	children: (
		<>
			<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
			<path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
			<path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
		</>
	),
})

export const IconCopy = icon({
	defaultSize: 14,
	strokeWidth: 2,
	children: (
		<>
			<rect x="9" y="9" width="13" height="13" rx="2" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</>
	),
})

export const IconTrash = icon({
	strokeWidth: 2,
	children: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />,
})

export const IconExternal = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
})

export const IconClock = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7v5l3 2" />
		</>
	),
})

/** Revision history (v3.6): a clock whose rim turns back, the meta line's History icon. */
export const IconHistory = icon({
	defaultSize: 15,
	strokeWidth: 1.8,
	children: (
		<>
			<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
			<path d="M3 3v5h5M12 7v5l3 2" />
		</>
	),
})

/** Revision history's Restore: the turning-back rim alone. */
export const IconRestore = icon({
	defaultSize: 15,
	strokeWidth: 1.8,
	children: (
		<>
			<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
			<path d="M3 3v5h5" />
		</>
	),
})

export const IconTag = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: (
		<>
			<path d="M12.6 2.86 21 11.3a2 2 0 0 1 0 2.83l-6.9 6.9a2 2 0 0 1-2.82 0L2.87 12.6A2 2 0 0 1 2.3 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.1.86Z" />
			<circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
		</>
	),
})

export const IconLock = icon({
	defaultSize: 20,
	strokeWidth: 2,
	children: (
		<>
			<rect x="4" y="11" width="16" height="10" rx="2" />
			<path d="M8 11V7a4 4 0 0 1 8 0v4" />
		</>
	),
})

export const IconInfo = icon({
	defaultSize: 15,
	strokeWidth: 2,
	children: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 16v-4M12 8h.01" />
		</>
	),
})

export const IconWarning = icon({
	defaultSize: 20,
	strokeWidth: 2,
	children: (
		<>
			<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
			<path d="M12 9v4M12 17h.01" />
		</>
	),
})

export const IconMaximize = icon({
	defaultSize: 18,
	strokeWidth: 2,
	children: <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />,
})

export const IconPlay = icon({
	defaultSize: 14,
	strokeWidth: 2,
	children: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="m10 8 5 4-5 4Z" fill="currentColor" stroke="none" />
		</>
	),
})

/* Mobile web glyphs, same lucide style. */

/** The top bar's hamburger. */
export const IconMenu = icon({ defaultSize: 20, strokeWidth: 1.8, children: <path d="M4 7h16M4 12h16M4 17h16" /> })

/** The top bar's bell. */
export const IconBell = icon({
	defaultSize: 20,
	strokeWidth: 1.8,
	strokeLinejoin: "round",
	children: (
		<>
			<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
			<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
		</>
	),
})

/** The nav drawer's Weekly recap. */
export const IconRecap = icon({
	defaultSize: 20,
	strokeWidth: 1.6,
	strokeLinejoin: "round",
	children: <path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18" />,
})

/** The File drawer's "Move to…": a folder with a down arrow (C: ICON.move). */
export const IconMove = icon({
	defaultSize: 18,
	strokeWidth: 1.7,
	strokeLinejoin: "round",
	children: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13l3 3 3-3" />,
})

/** Connections in the Account drawer. */
export const IconPlug = icon({
	defaultSize: 18,
	strokeWidth: 1.7,
	strokeLinejoin: "round",
	children: <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" />,
})

/** Settings in the Account drawer. */
export const IconSliders = icon({
	defaultSize: 18,
	strokeWidth: 1.7,
	children: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
})

/** Sign out in the Account drawer. */
export const IconLogout = icon({
	defaultSize: 18,
	strokeWidth: 1.7,
	strokeLinejoin: "round",
	children: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
})

/** An invite email: the Share dialog's Invited rows and "Invite {email}". */
export const IconMail = icon({
	defaultSize: 17,
	strokeWidth: 2,
	children: (
		<>
			<rect x="3" y="5" width="18" height="14" rx="2" />
			<path d="m3 7 9 6 9-6" />
		</>
	),
})

/** Sharing settings in the Share dialog header (v3.8). */
export const IconGear = icon({
	defaultSize: 18,
	strokeWidth: 1.8,
	children: (
		<>
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
})

/** Anyone with the link, in General access (lucide geometry). */
export const IconGlobe = icon({
	defaultSize: 17,
	strokeWidth: 1.8,
	children: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
			<path d="M2 12h20" />
		</>
	),
})

/** Link settings, beside General access (lucide `sliders-horizontal`). */
export const IconSlidersHorizontal = icon({
	defaultSize: 15,
	strokeWidth: 1.8,
	children: <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />,
})

/** Hide password, the pair of `IconEye`. */
export const IconEyeOff = icon({
	defaultSize: 16,
	strokeWidth: 1.8,
	children: (
		<>
			<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
			<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
			<path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
			<path d="m2 2 20 20" />
		</>
	),
})

/** Viewer activity in the Share dialog header: who has opened the file. */
export const IconEye = icon({
	defaultSize: 18,
	strokeWidth: 1.8,
	children: (
		<>
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
})
