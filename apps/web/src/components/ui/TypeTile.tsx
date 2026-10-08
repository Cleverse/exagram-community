import { type ArtifactKind } from "@exagram/api-client"

import type { FileType } from "@/components/ui/fileType"

/**
 * v3.5's Dropbox-style file-type tile (CHANGELOG v3.5 §1): a 24px tile in list and pending rows, 34px in
 * the full-view preview header. Document kinds spell their short name in the kind's colour; HTML draws a
 * grey `</>` and chat a blue speech bubble. The prototype's CSV and TXT have no Artifact kind, and an image
 * (which the prototype never shows) takes TXT's grey.
 */
type TileKind = ArtifactKind | FileType

const LABEL: Partial<Record<TileKind, { text: string; color: string }>> = {
	md: { text: "MD", color: "var(--color-tile-md)" },
	doc: { text: "MD", color: "var(--color-tile-md)" },
	pdf: { text: "PDF", color: "var(--color-tile-pdf)" },
	pptx: { text: "PPT", color: "var(--color-tile-ppt)" },
	docx: { text: "DOC", color: "var(--color-tile-doc)" },
	xlsx: { text: "XLS", color: "var(--color-tile-xls)" },
	image: { text: "IMG", color: "var(--color-tile-code)" },
}

const GLYPH_PATH: Partial<Record<TileKind, { d: string; color: string }>> = {
	html: { d: "m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16", color: "var(--color-tile-code)" },
	chat: { d: "M4 5h16v11h-9l-4 3.5V16H4z", color: "var(--color-type-chat)" },
}

export const TypeTile = ({ kind, size = 24 }: { kind: TileKind; size?: 24 | 30 | 34 }) => {
	// 30px is the mobile web rows' tile (docs/design/exagram-mobile, W:L169); it draws like the large one.
	const large = size !== 24
	const glyph = GLYPH_PATH[kind]
	const label = LABEL[kind]
	return (
		<div
			aria-hidden
			className="grid flex-none place-items-center"
			style={{
				width: size,
				height: size,
				borderRadius: size === 34 ? 7 : size === 30 ? 6 : 5,
				background: "var(--color-tile)",
				border: "1px solid var(--color-tile-line)",
				boxSizing: "border-box",
			}}
		>
			{glyph ? (
				<svg
					width={large ? 17 : 13}
					height={large ? 17 : 13}
					viewBox="0 0 24 24"
					fill="none"
					stroke={glyph.color}
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d={glyph.d} />
				</svg>
			) : label ? (
				<span
					style={{
						fontFamily: "Geist, sans-serif",
						fontSize: large ? 9 : 7,
						fontWeight: 700,
						letterSpacing: ".01em",
						lineHeight: 1,
						color: label.color,
					}}
				>
					{label.text}
				</span>
			) : null}
		</div>
	)
}
