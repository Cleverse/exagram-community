import { anyoneGateOf, statusOf, type PendingRevision, type VisibleArtifact } from "@exagram/api-client"
import { type ReactNode, useEffect, useId, useState } from "react"
import { useParams } from "react-router"

import { HeaderIconButton, MobileScreen, PushHeader } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { NotFound } from "@/components/NotFound"
import { IconEllipsis } from "@/components/ui/icons"
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton"
import { edition } from "@/edition/edition"
import { ApprovedGate } from "@/features/access-requests/ApprovedGate"
import { pendingAuthor } from "@/features/activity/activityFeed"
import { usePendingRevisions } from "@/features/approvals/hooks/usePendingRevisions"
import { splitExtractedText } from "@/features/artifact/extractedText"
import { useArtifact, useBodyToken, useRevisionText } from "@/features/artifact/hooks/useArtifact"
import { readingRevisionOf, type ReadingRevision } from "@/features/artifact/hooks/useReadingRevision"
import { GateBody, ReadGate } from "@/features/artifact/PasswordGate"
import { DecisionButtons, PendingNotes, PreviewButton } from "@/features/artifact/PendingDecision.mobile"
import { FrameLoadingOverlay } from "@/features/artifact/reading/FrameLoadingOverlay"
import { ReadingBody } from "@/features/artifact/reading/ReadingBody"
import { usePendingDecision } from "@/features/artifact/usePendingDecision.mobile"
import { useMe } from "@/features/auth/hooks/useMe"
import { useProjects } from "@/features/library/hooks/useProjects"
import { paths } from "@/routes/paths"

/**
 * The document's text on a phone is 15px. The reading scale sets paragraphs at 1.2em of the sheet's
 * base, and the base is 15px at 100%, so 83⅓% lands the paragraphs on 15px and keeps every margin in step.
 */
export const PHONE_ZOOM = (15 / 18) * 100

/**
 * `allow-same-origin` is never in this list, as on desktop: with it the frame could reach the reader's session
 * on the app origin. The CSP on the usercontent response is the other half of the boundary.
 */
const SANDBOX = "allow-scripts"

export const Notice = ({ children, alert = false }: { children: string; alert?: boolean }) => (
	<p role={alert ? "alert" : undefined} className="m-0 text-muted" style={{ padding: "24px 16px", fontSize: 15 }}>
		{children}
	</p>
)

const HtmlBody = ({ url, title }: { url: string; title: string }) => {
	const [loaded, setLoaded] = useState(false)
	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<iframe
				className="block min-h-0 w-full flex-1 border-0 bg-white"
				sandbox={SANDBOX}
				referrerPolicy="no-referrer"
				src={url}
				title={title}
				onLoad={() => setLoaded(true)}
			/>
			{!loaded && <FrameLoadingOverlay />}
		</div>
	)
}

const ImageBody = ({ url, alt }: { url: string; alt: string }) => {
	const [loaded, setLoaded] = useState(false)
	return (
		<>
			{!loaded && <SkeletonText label="Loading preview…" lines={6} style={{ padding: 16 }} />}
			<img
				src={url}
				alt={alt}
				className="block w-full"
				onLoad={() => setLoaded(true)}
				onError={() => setLoaded(true)}
			/>
		</>
	)
}

/**
 * HTML in the existing sandboxed usercontent frame, filling the screen under the header edge to edge, and an
 * image as itself at full width. No card around either: the page's own layout is the frame.
 */
export const BodyFrame = ({ artifact, reading }: { artifact: VisibleArtifact; reading: ReadingRevision }) => {
	const body = useBodyToken(artifact.id, reading.revisionId, true, reading.pending)
	if (body.isPending) return <SkeletonText lines={6} style={{ padding: 16 }} />
	if (body.isError) return <Notice alert>{body.error.message}</Notice>
	if (body.data.revisionId !== reading.revisionId)
		return <Notice alert>This version changed. Refresh to read it.</Notice>
	return artifact.kind === "html" ? (
		<HtmlBody key={body.data.url} url={body.data.url} title={`Contents of ${artifact.title}`} />
	) : (
		<ImageBody key={body.data.url} url={body.data.url} alt={artifact.title} />
	)
}

/**
 * A deck as 16:9 slide cards, one per slide the parser marked, with the slide's first line as
 * its title and the rest beneath. The API has no rendered slide images, so the cards carry the slide's text.
 */
export const DeckBody = ({ artifact, reading }: { artifact: VisibleArtifact; reading: ReadingRevision }) => {
	const text = useRevisionText(artifact.id, reading.revisionId, true, reading.pending)
	if (text.isPending) return <SkeletonText lines={6} style={{ padding: 16 }} />
	if (text.isError) return <Notice alert>{text.error.message}</Notice>
	if (text.data.revisionId !== reading.revisionId)
		return <Notice alert>This version changed. Refresh to read it.</Notice>

	const slides = splitExtractedText(text.data.text)
	if (slides.every((slide) => slide.body === "")) return <Notice>No text has been extracted yet.</Notice>

	return (
		<ol className="m-0 flex list-none flex-col" style={{ padding: 12, gap: 10 }}>
			{slides.map((slide, index) => {
				const [title = "", ...rest] = slide.body
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line !== "")
				const kicker = slide.heading ?? `Slide ${index + 1}`
				return (
					<li
						key={index}
						aria-label={kicker}
						className="relative flex flex-col justify-end overflow-hidden bg-panel text-ink"
						style={{
							aspectRatio: "16 / 9",
							borderRadius: 6,
							padding: "16px 18px",
							gap: 6,
							boxShadow: "var(--shadow-sheet)",
						}}
					>
						<div
							className="font-mono absolute"
							style={{
								top: 14,
								left: 18,
								fontSize: 10,
								letterSpacing: ".06em",
								textTransform: "uppercase",
								opacity: 0.6,
							}}
						>
							{kicker}
						</div>
						<div
							className="line-clamp-3"
							style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2, textWrap: "pretty" }}
						>
							{title}
						</div>
						{rest.length > 0 ? (
							<div className="line-clamp-2" style={{ fontSize: 11.5, opacity: 0.7 }}>
								{rest.join(" · ")}
							</div>
						) : null}
					</li>
				)
			})}
		</ol>
	)
}

/**
 * The amber banner: "vN from X is waiting for your approval. Connections still read vM."
 * with Reject / Approve for the Owner; anyone else sees their draft waiting for the Owner, as on desktop.
 */
const PendingBanner = ({ artifact, revision }: { artifact: VisibleArtifact; revision: PendingRevision }) => {
	const me = useMe()
	const decision = usePendingDecision()
	// The server names the Approver; an Author who owns the file inside someone's folder does not approve it.
	const isOwner = revision.isApprover
	const author = pendingAuthor(revision, me.data?.id ?? null)
	const stillRead =
		artifact.revisionSeq === null ? "Nothing is published yet." : `Connections still read v${artifact.revisionSeq}.`
	const text = isOwner
		? `v${revision.seq} from ${author === "You" ? "you" : author} is waiting for your approval. ${stillRead}`
		: `v${revision.seq} is waiting for the Owner. ${stillRead}`

	return (
		<div
			role="status"
			className="flex flex-none flex-col bg-pending-bg"
			style={{ margin: "12px 12px 0", borderRadius: 10, padding: "12px 14px", gap: 10 }}
		>
			<div className="flex text-pending-fg" style={{ gap: 8, fontSize: 13.5, lineHeight: 1.4 }}>
				<span
					aria-hidden
					className="flex-none bg-pending"
					style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 6 }}
				/>
				<div className="min-w-0">
					<div>{text}</div>
					{revision.note ? <div style={{ marginTop: 4 }}>{revision.note}</div> : null}
				</div>
			</div>
			<PendingNotes revision={revision} />
			{isOwner ? (
				<DecisionButtons revision={revision} decision={decision} height={38} preview />
			) : (
				<PreviewButton revision={revision} height={38} />
			)}
			{decision.dialog}
		</div>
	)
}

const Reading = ({ artifact }: { artifact: VisibleArtifact }) => {
	const sheet = useSheet()
	const folderId = useId()
	const projects = useProjects()
	const pending = usePendingRevisions()

	const project = (projects.data ?? []).find((candidate) => candidate.id === artifact.projectId) ?? null
	const home = project ? paths.project(project.id) : paths.library
	// The queue holds only what this reader may see: their own drafts and, as Owner, others'.
	const waiting = pending.data?.find((revision) => revision.artifactId === artifact.id) ?? null
	// Before anything is approved, the Owner (or the draft's author) reads the Pending Revision it would approve.
	const reading = readingRevisionOf(artifact, pending.data)
	const hasRevision = reading.revisionId !== null
	const isFramed = hasRevision && artifact.kind === "html"
	const isDeck = hasRevision && artifact.kind === "pptx"

	// The tab names the open file, as the desktop page does; leaving gives the title back.
	useEffect(() => {
		const previous = document.title
		document.title = `${artifact.title} · Exagram`
		return () => {
			document.title = previous
		}
	}, [artifact.title])

	return (
		<MobileScreen
			push
			label={artifact.title}
			// v1.5: one 56px row, so only the document scrolls. Back, the file's name over its folder,
			// More and Share. History, Pin and Details are in the More drawer; tapping the name opens Details.
			header={
				<PushHeader
					to={home}
					center={
						// The folder is the button's description, so the heading and the button are named by the file alone.
						<h1
							aria-label={artifact.title}
							className="m-0 flex w-full min-w-0"
							style={{ fontSize: "inherit", fontWeight: "inherit" }}
						>
							<button
								type="button"
								onClick={() => sheet.open("details", { artifactId: artifact.id })}
								aria-label={artifact.title}
								aria-describedby={folderId}
								className="flex w-full min-w-0 flex-col items-start justify-center text-left text-ink"
								style={{ height: 44, padding: "0 4px" }}
							>
								<span className="max-w-full truncate" style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>
									{artifact.title}
								</span>
								<span
									id={folderId}
									className="max-w-full truncate text-muted-2"
									style={{ fontSize: 12, lineHeight: 1.3 }}
								>
									{project?.name ?? "All artifacts"}
								</span>
							</button>
						</h1>
					}
					actions={
						<>
							<HeaderIconButton label="More actions" onClick={() => sheet.open("file", { artifactId: artifact.id })}>
								<IconEllipsis size={20} />
							</HeaderIconButton>
							<button
								type="button"
								onClick={() => sheet.open("share", { target: { kind: "artifact", id: artifact.id } })}
								className="flex-none bg-ink text-white active:bg-primary-hover"
								style={{ height: 36, padding: "0 14px", margin: "0 4px", fontSize: 14, fontWeight: 500 }}
							>
								Share
							</button>
						</>
					}
				/>
			}
			// Content runs edge to edge on white; only a deck keeps the grey canvas its slide cards sit on. HTML fills
			// the body (a flex column) and scrolls inside its own frame, down to the bottom of the screen: under iOS 26
			// Safari's floating toolbar, with no gap above it.
			bodyStyle={{
				background: isDeck ? "var(--color-ground)" : "var(--color-panel)",
				...(isFramed ? { display: "flex", flexDirection: "column" } : {}),
			}}
			bleed={isFramed}
		>
			{edition.OpenInAppBanner ? <edition.OpenInAppBanner /> : null}
			{waiting ? <PendingBanner artifact={artifact} revision={waiting} /> : null}
			{!hasRevision ? (
				<Notice>No approved Revision to read yet.</Notice>
			) : isFramed || artifact.kind === "image" ? (
				<BodyFrame artifact={artifact} reading={reading} />
			) : isDeck ? (
				<DeckBody artifact={artifact} reading={reading} />
			) : (
				<ReadingBody artifact={artifact} zoom={PHONE_ZOOM} tableMode="cards" frame="card" reading={reading} />
			)}
		</MobileScreen>
	)
}

/** The frame while the library that holds the file loads. */
const ReadingSkeleton = () => (
	<MobileScreen
		push
		header={
			<PushHeader
				to={paths.library}
				center={
					<div className="flex flex-col" style={{ gap: 6, padding: "0 4px" }}>
						<Skeleton width={180} height={14} radius={4} />
						<Skeleton width={90} height={10} />
					</div>
				}
			/>
		}
	>
		<SkeletonText label="Loading file…" lines={8} style={{ padding: 16 }} />
	</MobileScreen>
)

const withPushHeader = (body: ReactNode) => (
	<MobileScreen push header={<PushHeader to={paths.library} />}>
		{body}
	</MobileScreen>
)

/**
 * `/artifacts/:artifactId` on a phone: the reading view. Its drawers
 * (File actions, Share, Details, History) open over it.
 */
export default function ArtifactPageMobile() {
	const { artifactId = "" } = useParams()
	const file = useArtifact(artifactId)
	const artifact = file.data ?? null

	if (artifact)
		return (
			<ApprovedGate artifactId={artifactId} fallback={<ReadingSkeleton />} frame={withPushHeader}>
				<Reading artifact={artifact} />
			</ApprovedGate>
		)
	if (file.isError && statusOf(file.error) === 404)
		return withPushHeader(<NotFound what="file" artifactId={artifactId} />)
	const gate = file.isError ? anyoneGateOf(file.error) : null
	if (gate)
		return (
			<MobileScreen push header={<PushHeader to={paths.library} />}>
				<GateBody>
					<ReadGate gate={gate} artifactId={artifactId} />
				</GateBody>
			</MobileScreen>
		)
	if (file.isError)
		return (
			<MobileScreen push header={<PushHeader to={paths.library} />}>
				<Notice alert>{file.error.message}</Notice>
			</MobileScreen>
		)
	return <ReadingSkeleton />
}
