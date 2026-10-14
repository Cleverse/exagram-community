import { Navigate, useLocation, useParams } from "react-router"

import { legacyPreviewTarget, paths } from "@/routes/paths"

/**
 * `/shares/:id` and the singular `/artifact/:id` were an Artifact's addresses before
 * `/artifacts/:id` became the only one. Old links keep working: they land on the Artifact's page,
 * query string included, with no extra history entry.
 */
export const LegacyArtifactRedirect = () => {
	const { legacyId = "" } = useParams()
	const { search } = useLocation()
	return <Navigate replace to={{ pathname: paths.artifact(legacyId), search }} />
}

export const LegacyProjectRedirect = () => {
	const { legacyProjectId = "" } = useParams()
	const { search } = useLocation()
	return <Navigate replace to={{ pathname: paths.project(legacyProjectId), search }} />
}

/** `/pending` was Activity's address before it moved to `/activity`. */
export const LegacyPendingRedirect = () => {
	const { search } = useLocation()
	return <Navigate replace to={{ pathname: paths.activity, search }} />
}

/**
 * A preview used to be a path, `/…/artifacts/:id` under a list, with `?view=full` for full view. It is
 * `?preview=:id` on the list now, and full view is the Artifact's own page; old links land on either.
 */
export const LegacyPreviewRedirect = () => {
	const { pathname, search } = useLocation()
	return <Navigate replace to={legacyPreviewTarget(pathname, search) ?? paths.library} />
}

/** A moved screen's old address: the new one, query string kept, with no extra history entry. */
export const RedirectKeepingSearch = ({ to }: { to: string }) => {
	const { search } = useLocation()
	return <Navigate replace to={{ pathname: to, search }} />
}
