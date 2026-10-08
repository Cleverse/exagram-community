import { matchPath, Navigate, useLocation } from "react-router"

import { SignedOutArtifactPage } from "@/features/artifact/signed-out/SignedOutArtifactPage"
import { ByShell } from "@/routes/byShell"
import { paths } from "@/routes/paths"

/**
 * The signed-in frame's signed-out face: a file's own address opens the read-only viewer, which the
 * server answers only for a file open to anyone with the link (ADR 0042); every other address goes to
 * sign-in and comes back here afterwards, as `AuthGuard` sends it.
 */
export const SignedOutArtifact = () => {
	const location = useLocation()
	const artifactId = matchPath(paths.artifact(":artifactId"), location.pathname)?.params.artifactId
	if (!artifactId) {
		return <Navigate to={paths.signIn} state={{ from: location.pathname + location.search }} replace />
	}
	return (
		<ByShell
			desktop={SignedOutArtifactPage}
			mobile="artifact/signed-out/SignedOutArtifactPage"
			props={{ artifactId }}
		/>
	)
}
