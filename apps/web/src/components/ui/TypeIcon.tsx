import clsx from "clsx"

import type { ArtifactKind } from "@exagram/api-client"

import type { FileType } from "@/components/ui/fileType"
import type { CSSProperties, ReactNode } from "react"

import { IconPeople } from "@/components/ui/icons"

/** The prototype's three sample types plus the eight kinds the API stores. */
export type TypeIconKind = FileType | ArtifactKind | "folder"

const PAGE = (
	<>
		<path d="M7,4 L14,4 L17,7 L17,20 L7,20 Z" />
		<polyline points="14,4 14,7 17,7" />
	</>
)

/**
 * The row glyphs: a page for markdown, a browser window for HTML, a speech
 * bubble for chat, a folder for a project. The office kinds and images, which the prototype
 * never shows, keep their distinction as a mark inside the page.
 */
const GLYPH: Record<TypeIconKind, ReactNode> = {
	md: PAGE,
	doc: PAGE,
	html: (
		<>
			<rect x="4" y="5" width="16" height="14" />
			<line x1="4" y1="9" x2="20" y2="9" />
			<circle cx="7" cy="7" r="0.7" fill="currentColor" stroke="none" />
		</>
	),
	chat: <path d="M5,6 L19,6 L19,15 L11,15 L8,19 L8,15 L5,15 Z" />,
	// The blue project folder; it carries its own stroke and fill.
	folder: (
		<path
			d="M3,7 L9,7 L11,5 L21,5 L21,19 L3,19 Z"
			style={{ stroke: "var(--color-folder)", fill: "var(--color-folder-fill)" }}
		/>
	),
	pdf: (
		<>
			{PAGE}
			<path d="M9.5 15h5v2.5h-5z" />
		</>
	),
	docx: (
		<>
			{PAGE}
			<path d="M9.5 11h5M9.5 13.5h5M9.5 16h3" />
		</>
	),
	pptx: (
		<>
			{PAGE}
			<path d="M9.5 10.5h5v4h-5zM9.5 17h3" />
		</>
	),
	xlsx: (
		<>
			{PAGE}
			<path d="M9.5 10.5h5v7h-5zM9.5 14h5M12 10.5v7" />
		</>
	),
	image: (
		<>
			<rect x="4" y="5" width="16" height="14" />
			<path d="m4 17 5-5 4 4 2-2 5 5" />
			<circle cx="15" cy="9.5" r="1.3" />
		</>
	),
}

/** v3's muted type colours: HTML orange, chat blue, every page-shaped kind the doc grey. */
const COLOR: Partial<Record<TypeIconKind, string>> = {
	html: "var(--color-type-html)",
	chat: "var(--color-type-chat)",
}

/**
 * The line icon for an Artifact kind or a project, colour-coded as v3 draws them (doc grey, HTML orange,
 * chat blue, the blue folder). `size` is the footprint the glyph centres in, so rows keep their geometry: a
 * 24px footprint (list rows) draws the 20px glyph, anything smaller at most 16px.
 */
export const TypeIcon = ({
	kind,
	size = 34,
	shared = false,
	className,
	style,
}: {
	kind: TypeIconKind
	size?: number
	/** Adds the small people glyph at the bottom-right corner. */
	shared?: boolean
	className?: string
	style?: CSSProperties
}) => {
	const glyph = size >= 24 ? 20 : Math.min(size, 16)
	return (
		<div
			aria-hidden
			// `relative` only when the people glyph needs it: the prototype's row icon is `static`.
			className={clsx("grid flex-none place-items-center", shared && "relative", className)}
			style={{
				width: size,
				height: size,
				color: COLOR[kind] ?? "var(--color-type-doc)",
				...style,
			}}
		>
			<svg
				width={glyph}
				height={glyph}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				{GLYPH[kind]}
			</svg>
			{shared ? (
				<IconPeople size={12} className="absolute" style={{ right: 0, bottom: 0, color: "var(--color-muted)" }} />
			) : null}
		</div>
	)
}
