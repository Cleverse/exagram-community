import { type Revision, type VisibleArtifact } from "@exagram/api-client"
import { useState } from "react"

import { SkeletonText } from "@/components/ui/Skeleton"
import { useBodyToken, useRevisionTextAt } from "@/features/artifact/hooks/useArtifact"
import { FrameLoadingOverlay } from "@/features/artifact/reading/FrameLoadingOverlay"
import { TextSheet } from "@/features/artifact/reading/ReadingBody"

export const Notice = ({ children, alert = false }: { children: string; alert?: boolean }) => (
	<p role={alert ? "alert" : undefined} className="text-muted" style={{ padding: "36px 48px", fontSize: 14 }}>
		{children}
	</p>
)

const RevisionHtml = ({ url, title }: { url: string; title: string }) => {
	const [loaded, setLoaded] = useState(false)
	return (
		<>
			<iframe
				className="absolute inset-0 h-full w-full border-0 bg-white"
				// Never `allow-same-origin`, the same boundary as the preview pane's frame.
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				src={url}
				title={title}
				onLoad={() => setLoaded(true)}
			/>
			{!loaded && <FrameLoadingOverlay />}
		</>
	)
}

const RevisionImage = ({ url, alt }: { url: string; alt: string }) => {
	const [loaded, setLoaded] = useState(false)
	return (
		<>
			<img
				src={url}
				alt={alt}
				className="h-full w-full object-contain"
				onLoad={() => setLoaded(true)}
				onError={() => setLoaded(true)}
			/>
			{!loaded && <FrameLoadingOverlay />}
		</>
	)
}

/**
 * One Revision's content, for History and a Pending Revision's preview. Text-backed and extracted kinds read
 * the per-Revision text endpoint. An HTML page or an image is framed from the usercontent origin: the visible
 * Revision through the boundary's own body token, any other through the named one, which the server grants
 * only to the Owner or to the author of their own Pending Revision.
 */
export const RevisionPreview = ({
	artifact,
	revision,
}: {
	artifact: Pick<VisibleArtifact, "id" | "kind" | "title" | "visibleRevisionId">
	revision: Pick<Revision, "id" | "seq">
}) => {
	const framed = artifact.kind === "html" || artifact.kind === "image"
	const extracted = ["pdf", "docx", "pptx", "xlsx"].includes(artifact.kind)
	const isVisible = revision.id === artifact.visibleRevisionId
	const text = useRevisionTextAt(artifact.id, revision.id, !framed)
	const visibleBody = useBodyToken(artifact.id, artifact.visibleRevisionId, framed && isVisible)
	const namedBody = useBodyToken(artifact.id, revision.id, framed && !isVisible, true)
	const body = isVisible ? visibleBody : namedBody

	if (framed) {
		if (body.isPending) return <SkeletonText lines={6} style={{ padding: 32 }} />
		if (body.isError) return <Notice alert>{body.error.message}</Notice>
		return (
			<div className="relative min-h-0 flex-1 overflow-hidden bg-white">
				{artifact.kind === "html" ? (
					<RevisionHtml
						key={body.data.url}
						url={body.data.url}
						title={`Contents of ${artifact.title} v${revision.seq}`}
					/>
				) : (
					<RevisionImage key={body.data.url} url={body.data.url} alt={artifact.title} />
				)}
			</div>
		)
	}

	if (text.isPending) return <SkeletonText label="Loading this version…" lines={8} style={{ padding: 32 }} />
	// An office file's text waits on extraction; that is a state to report, not an error.
	if (text.isError && extracted) return <Notice>A preview isn&apos;t ready for this file yet.</Notice>
	if (text.isError) return <Notice alert>{text.error.message}</Notice>
	return <TextSheet kind={artifact.kind} body={text.data} zoom={100} />
}
