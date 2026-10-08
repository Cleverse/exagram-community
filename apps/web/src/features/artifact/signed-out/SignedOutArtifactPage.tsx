import { anyoneGateOf, statusOf, type VisibleArtifact } from "@exagram/api-client"
import { useEffect } from "react"
import { Link, Navigate, useLocation } from "react-router"

import { SkeletonText } from "@/components/ui/Skeleton"
import { useArtifact, useBodyToken } from "@/features/artifact/hooks/useArtifact"
import { GateScreen, ReadGate } from "@/features/artifact/PasswordGate"
import { BodyFrame } from "@/features/artifact/reading/BodyFrames"
import { ReadingBody } from "@/features/artifact/reading/ReadingBody"
import { DEFAULT_PREVIEW_ZOOM } from "@/features/artifact/reading/zoom"
import { paths } from "@/routes/paths"

/** The kinds whose body is the usercontent origin's to draw (a body token), not text the page draws itself. */
const isBodyFrameKind = (kind: string) => kind === "html" || kind === "image" || kind === "pdf" || kind === "pptx"

const Body = ({ artifact }: { artifact: VisibleArtifact }) => {
	const framed = isBodyFrameKind(artifact.kind)
	const body = useBodyToken(artifact.id, artifact.visibleRevisionId, framed && artifact.visibleRevisionId !== null)
	if (!framed) return <ReadingBody artifact={artifact} zoom={DEFAULT_PREVIEW_ZOOM} />
	if (body.isPending) return <SkeletonText lines={6} style={{ padding: 20 }} />
	if (body.isError) {
		return (
			<div role="alert" style={{ padding: 20, fontSize: 14, color: "var(--color-muted)" }}>
				{body.error.message}
			</div>
		)
	}
	if (body.data.revisionId !== artifact.visibleRevisionId) {
		return (
			<div role="alert" style={{ padding: 20, fontSize: 14, color: "var(--color-muted)" }}>
				This version changed. Refresh to read it.
			</div>
		)
	}
	return <BodyFrame kind={artifact.kind} url={body.data.url} title={artifact.title} zoom={DEFAULT_PREVIEW_ZOOM} />
}

/**
 * A file read signed out (ADR 0042): the Current Revision and a way to sign in, nothing that asks the
 * API for a session. The server answers `artifacts.get` only for a file open to anyone with the link, and
 * its refusal is not-found, so a refused address goes to sign in and comes back here afterwards. A file that
 * needs a password, or has expired (ADR 0044), shows that instead.
 */
export const SignedOutArtifactPage = ({ artifactId }: { artifactId: string }) => {
	const location = useLocation()
	const from = location.pathname + location.search
	const file = useArtifact(artifactId)
	const title = file.data?.title

	useEffect(() => {
		if (title === undefined) return
		const previous = document.title
		document.title = `${title} · Exagram`
		return () => {
			document.title = previous
		}
	}, [title])

	if (file.isError) {
		if (statusOf(file.error) === 404) return <Navigate to={paths.signIn} state={{ from }} replace />
		const gate = anyoneGateOf(file.error)
		if (gate) {
			return (
				<GateScreen>
					<ReadGate gate={gate} artifactId={artifactId} />
				</GateScreen>
			)
		}
		return (
			<p role="alert" className="text-danger p-8 text-sm">
				{file.error.message}
			</p>
		)
	}
	if (file.isPending) return <SkeletonText lines={4} style={{ padding: 32 }} />

	const artifact = file.data
	return (
		<div className="flex h-screen min-h-0 flex-col bg-panel">
			<header
				className="flex flex-none items-center border-b border-row-line"
				style={{ height: 56, padding: "0 20px", gap: 12 }}
			>
				<div className="min-w-0 flex-1">
					<h1 className="m-0 truncate" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>
						{artifact.title}
					</h1>
					<div className="truncate text-muted" style={{ fontSize: 12.5, lineHeight: 1.3 }}>
						Shared by {artifact.ownerName}
					</div>
				</div>
				<Link
					to={paths.signIn}
					state={{ from }}
					className="inline-flex flex-none items-center bg-ink text-white no-underline hover:bg-primary-hover hover:text-white"
					style={{ height: 34, padding: "0 14px", fontSize: 14, fontWeight: 500 }}
				>
					Sign in
				</Link>
			</header>
			<div
				className={`relative min-h-0 flex-1 bg-white ${isBodyFrameKind(artifact.kind) ? "overflow-hidden" : "overflow-auto"}`}
			>
				<Body artifact={artifact} />
			</div>
		</div>
	)
}
