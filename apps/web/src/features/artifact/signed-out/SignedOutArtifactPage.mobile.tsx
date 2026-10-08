import { anyoneGateOf, statusOf, type VisibleArtifact } from "@exagram/api-client"
import { useEffect } from "react"
import { Link, Navigate, useLocation } from "react-router"

import { MobileScreen } from "@/components/mobile/primitives"
import { SkeletonText } from "@/components/ui/Skeleton"
import { BodyFrame, DeckBody, Notice, PHONE_ZOOM } from "@/features/artifact/ArtifactPage.mobile"
import { useArtifact } from "@/features/artifact/hooks/useArtifact"
import { GateScreen, ReadGate } from "@/features/artifact/PasswordGate"
import { ReadingBody } from "@/features/artifact/reading/ReadingBody"
import { paths } from "@/routes/paths"

const Reading = ({ artifact, from }: { artifact: VisibleArtifact; from: string }) => {
	const reading = { revisionId: artifact.visibleRevisionId, pending: false }
	const hasRevision = reading.revisionId !== null
	const isFramed = hasRevision && artifact.kind === "html"
	const isDeck = hasRevision && artifact.kind === "pptx"

	useEffect(() => {
		const previous = document.title
		document.title = `${artifact.title} · Exagram`
		return () => {
			document.title = previous
		}
	}, [artifact.title])

	return (
		<MobileScreen
			label={artifact.title}
			header={
				<div
					className="flex flex-none items-center border-b border-row-line bg-white"
					style={{ height: 56, padding: "0 12px 0 16px", gap: 8 }}
				>
					<h1 className="m-0 flex min-w-0 flex-1 flex-col justify-center" style={{ fontSize: "inherit" }}>
						<span className="max-w-full truncate" style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>
							{artifact.title}
						</span>
						<span className="max-w-full truncate text-muted-2" style={{ fontSize: 12, lineHeight: 1.3 }}>
							Shared by {artifact.ownerName}
						</span>
					</h1>
					<Link
						to={paths.signIn}
						state={{ from }}
						className="inline-flex flex-none items-center bg-ink text-white no-underline active:bg-primary-hover"
						style={{ height: 36, padding: "0 14px", fontSize: 14, fontWeight: 500 }}
					>
						Sign in
					</Link>
				</div>
			}
			bodyStyle={{
				background: isDeck ? "var(--color-ground)" : "var(--color-panel)",
				...(isFramed ? { display: "flex", flexDirection: "column" } : {}),
			}}
			bleed={isFramed}
		>
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

/** The phone's face of `SignedOutArtifactPage`: a file read signed out (ADR 0042), with a way to sign in. */
export default function SignedOutArtifactPageMobile({ artifactId }: { artifactId: string }) {
	const location = useLocation()
	const from = location.pathname + location.search
	const file = useArtifact(artifactId)

	if (file.data) return <Reading artifact={file.data} from={from} />
	if (file.isError && statusOf(file.error) === 404) return <Navigate to={paths.signIn} state={{ from }} replace />
	const gate = file.isError ? anyoneGateOf(file.error) : null
	if (gate) {
		return (
			<MobileScreen bleed>
				<GateScreen>
					<ReadGate gate={gate} artifactId={artifactId} />
				</GateScreen>
			</MobileScreen>
		)
	}
	if (file.isError) {
		return (
			<MobileScreen>
				<Notice alert>{file.error.message}</Notice>
			</MobileScreen>
		)
	}
	return (
		<MobileScreen>
			<SkeletonText lines={6} style={{ padding: 16 }} />
		</MobileScreen>
	)
}
