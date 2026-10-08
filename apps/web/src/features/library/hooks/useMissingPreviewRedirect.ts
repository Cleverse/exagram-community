import { type VisibleArtifact } from "@exagram/api-client"
import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router"

import { paths, previewIdOf } from "@/routes/paths"

export const useMissingPreviewRedirect = (artifacts: VisibleArtifact[] | undefined, loaded: boolean) => {
	const location = useLocation()
	const navigate = useNavigate()
	const previewId = previewIdOf(location.search)
	const missingId =
		loaded && previewId !== null && !artifacts?.some((artifact) => artifact.id === previewId) ? previewId : null

	useEffect(() => {
		if (missingId !== null) void navigate(paths.artifact(missingId), { replace: true })
	}, [missingId, navigate])
}
