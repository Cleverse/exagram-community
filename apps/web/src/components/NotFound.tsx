import { Link } from "react-router"

import { RequestAccess } from "@/features/access-requests/RequestAccess"
import { paths } from "@/routes/paths"

/**
 * One page for "not there" and "not yours": the app never says which, so a link to someone else's
 * Artifact reads the same as a deleted one. A file's page passes `artifactId` to offer Request access,
 * which shows for every refused file alike.
 */
export const NotFound = ({ what = "page", artifactId }: { what?: string; artifactId?: string }) => (
	<div
		role="alert"
		className="flex flex-1 flex-col items-center justify-center text-center"
		style={{ padding: "96px 24px", gap: 10 }}
	>
		<div className="font-mono" style={{ fontSize: 13, color: "var(--color-muted)", letterSpacing: ".08em" }}>
			404
		</div>
		<h1 className="font-display" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>
			{`This ${what} isn't available`}
		</h1>
		<p style={{ fontSize: 15, color: "var(--color-muted)", maxWidth: 420, lineHeight: 1.55 }}>
			It may have been deleted, or you don&apos;t have access. Ask the owner to share it with you.
		</p>
		{artifactId ? <RequestAccess artifactId={artifactId} /> : null}
		<Link
			to={paths.library}
			className="bg-primary text-white hover:bg-primary-hover press"
			style={{
				marginTop: 12,
				padding: "10px 18px",
				fontSize: 14,
				fontWeight: 600,
			}}
		>
			Back to all artifacts
		</Link>
	</div>
)
