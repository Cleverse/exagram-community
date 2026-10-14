import { type VisibleArtifact } from "@exagram/api-client"
import { Children, createContext, isValidElement, type ReactElement, type ReactNode, useContext } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { SkeletonText } from "@/components/ui/Skeleton"
import { parseChatBody } from "@/features/artifact/chat"
import { splitExtractedText } from "@/features/artifact/extractedText"
import { useRevisionText } from "@/features/artifact/hooks/useArtifact"
import { type ReadingRevision } from "@/features/artifact/hooks/useReadingRevision"
import { sheetMarkdown } from "@/features/artifact/reading/markdown"
import { Sheet } from "@/features/artifact/reading/Sheet"

const EXTRACTED_KINDS: string[] = ["pdf", "docx", "pptx", "xlsx"]

/** How a Markdown table reads: a grid (desktop), or one card of label/value pairs per row (a phone). */
export type TableMode = "table" | "cards"

/** The part of a hast node the cards read: enough to pull the header row's text out of a table. */
type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[] }

const textOf = (node: HastNode): string =>
	node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("")

const childElements = (node: HastNode | undefined, tagName: string) =>
	(node?.children ?? []).filter((child) => child.type === "element" && child.tagName === tagName)

/** The table's column names, from its `thead` row, for the cards' labels. */
const headerLabels = (table: HastNode | undefined): string[] =>
	childElements(childElements(childElements(table, "thead")[0], "tr")[0], "th").map((cell) => textOf(cell).trim())

const CardLabels = createContext<string[]>([])

/** One body row as a card: the first cell is its title, the rest label/value pairs under the header's names. */
const CardRow = ({ children }: { children?: ReactNode }) => {
	const labels = useContext(CardLabels)
	const cells = Children.toArray(children).filter(isValidElement) as ReactElement<{ children?: ReactNode }>[]
	const [first, ...rest] = cells
	return (
		<div className="border border-card-line" style={{ borderRadius: 6, padding: "12px 14px" }}>
			<div className="text-ink" style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.4 }}>
				{first?.props.children}
			</div>
			{rest.map((cell, index) => (
				<div key={index} style={{ marginTop: 8 }}>
					{labels[index + 1] ? (
						<div
							className="text-label"
							style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}
						>
							{labels[index + 1]}
						</div>
					) : null}
					<div style={{ fontSize: 14, lineHeight: 1.55, marginTop: 2 }}>{cell.props.children}</div>
				</div>
			))}
		</div>
	)
}

/**
 * A table as stacked cards: each body row is a bordered card and the header row is
 * not drawn. The cells stay the Markdown's own nodes, so a link or bold text in a cell keeps working.
 */
const cardMarkdown: Components = {
	...sheetMarkdown,
	table: ({ node, children }) => (
		<CardLabels.Provider value={headerLabels(node as HastNode | undefined)}>
			<div className="flex flex-col" style={{ gap: 8, margin: "4px 0 12px" }}>
				{children}
			</div>
		</CardLabels.Provider>
	),
	thead: () => null,
	tbody: ({ children }) => <>{children}</>,
	tr: ({ children }) => <CardRow>{children}</CardRow>,
	th: ({ children }) => <>{children}</>,
	td: ({ children }) => <>{children}</>,
}

const Notice = ({ children, alert = false }: { children: string; alert?: boolean }) => (
	<p role={alert ? "alert" : undefined} className="text-muted p-8 text-[15px]">
		{children}
	</p>
)

const ExtractedBody = ({
	text,
	asMarkdown,
	components,
}: {
	text: string
	asMarkdown: boolean
	components: Components
}) => {
	const sections = splitExtractedText(text)

	if (sections.every((section) => section.body === "")) {
		return <p className="mt-[1.6em] text-[1.2em] leading-[1.7] text-muted">No text has been extracted yet.</p>
	}

	return (
		<>
			{sections.map((section, index) => (
				<section key={index}>
					{section.heading ? (
						<h3 className="font-display mt-[2em] mb-[.8em] text-[1.65em] font-semibold tracking-[-.01em]">
							{section.heading}
						</h3>
					) : null}
					{asMarkdown ? (
						<Markdown remarkPlugins={[remarkGfm]} components={components}>
							{section.body}
						</Markdown>
					) : (
						<pre className="mt-[1.6em] mb-[1.1em] font-sans text-[1.2em] leading-[1.7] whitespace-pre-wrap">
							{section.body}
						</pre>
					)}
				</section>
			))}
		</>
	)
}

const ChatBody = ({ text, components }: { text: string; components: Components }) => {
	const turns = parseChatBody(text)
	if (!turns) {
		return (
			<Markdown remarkPlugins={[remarkGfm]} components={components}>
				{text}
			</Markdown>
		)
	}

	return (
		<>
			{turns.map((turn, index) => (
				<section key={index} className="mt-[1.6em]">
					{turn.question ? (
						<p className="mb-[1.1em] ml-auto max-w-[76%] bg-chip px-[1em] py-[.7em] text-[1.05em] leading-[1.6] whitespace-pre-line">
							{turn.question}
						</p>
					) : null}
					{turn.answer ? (
						<Markdown remarkPlugins={[remarkGfm]} components={components}>
							{turn.answer}
						</Markdown>
					) : null}
				</section>
			))}
		</>
	)
}

/**
 * The phone's document: edge to edge on white with no card around it, the text 16px in from the screen's
 * sides. The desktop sheet's 40px sides would leave a 390px screen a narrow column.
 */
const PhoneCard = ({ zoom, children }: { zoom: number; children: ReactNode }) => (
	<div className="bg-panel" style={{ padding: "20px 16px 36px" }}>
		<article className="[&>:first-child]:mt-0" style={{ fontSize: `${(zoom / 100) * 15}px` }}>
			{children}
		</article>
	</div>
)

/**
 * One Revision's text drawn by kind; the preview, Revision history and the mobile reading view share it.
 * `tableMode="cards"` turns each table row into a card and `frame="card"` sets the document in the phone's card
 * instead of the desktop sheet; both default to the desktop reading.
 */
export const TextSheet = ({
	kind,
	body,
	zoom,
	tableMode = "table",
	frame = "sheet",
}: {
	kind: VisibleArtifact["kind"]
	body: { mime: string; text: string }
	zoom: number
	tableMode?: TableMode
	frame?: "sheet" | "card"
}) => {
	const components = tableMode === "cards" ? cardMarkdown : sheetMarkdown
	const Frame = frame === "card" ? PhoneCard : Sheet
	const plainText =
		(kind === "doc" && ["text/csv", "application/json"].includes(body.mime)) ||
		(kind === "chat" && body.mime === "text/html")

	return (
		<Frame zoom={zoom}>
			{plainText ? (
				<pre className="mt-[1.6em] mb-[1.1em] font-sans text-[1.2em] leading-[1.7] whitespace-pre-wrap">
					{body.text}
				</pre>
			) : EXTRACTED_KINDS.includes(kind) ? (
				<ExtractedBody text={body.text} asMarkdown={kind === "xlsx"} components={components} />
			) : kind === "chat" ? (
				<ChatBody text={body.text} components={components} />
			) : body.text.trim() === "" ? (
				<p className="mt-[1.6em] text-[1.2em] leading-[1.7] text-muted">This Revision has no contents.</p>
			) : (
				<Markdown remarkPlugins={[remarkGfm]} components={components}>
					{body.text}
				</Markdown>
			)}
		</Frame>
	)
}

/** Everything but html, which the preview pane draws in its own sandboxed frame. */
export const ReadingBody = ({
	artifact,
	zoom,
	tableMode = "table",
	frame = "sheet",
	reading = { revisionId: artifact.visibleRevisionId, pending: false },
}: {
	artifact: VisibleArtifact
	zoom: number
	tableMode?: TableMode
	frame?: "sheet" | "card"
	/** Which Revision to draw (`useReadingRevision`); the one the boundary serves unless a caller names a Pending one. */
	reading?: ReadingRevision
}) => {
	const hasRevision = reading.revisionId !== null
	const text = useRevisionText(artifact.id, reading.revisionId, hasRevision, reading.pending)

	if (!hasRevision) return <Notice>No approved Revision to read yet.</Notice>

	if (text.isPending) return <SkeletonText lines={8} style={{ padding: 32 }} />
	if (text.isError) return <Notice alert>{text.error.message}</Notice>
	if (text.data.revisionId !== reading.revisionId)
		return <Notice alert>This version changed. Refresh to read it.</Notice>

	return <TextSheet kind={artifact.kind} body={text.data} zoom={zoom} tableMode={tableMode} frame={frame} />
}
