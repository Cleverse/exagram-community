import { type ReactNode } from "react"
import { Navigate, useLocation } from "react-router"

import { useMe } from "@/features/auth/hooks/useMe"
import { paths } from "@/routes/paths"

/**
 * Signed out, the guard sends the person to sign in and brings them back afterwards; a frame that has a
 * signed-out face (a file open to anyone with the link, ADR 0042) passes it as `signedOut` and decides
 * there whether this address has one.
 */
export const AuthGuard = ({ children, signedOut }: { children: ReactNode; signedOut?: ReactNode }) => {
	const me = useMe()
	const location = useLocation()

	if (me.isPending) return <div className="p-8 text-muted">Loading…</div>
	if (me.isError) {
		if (signedOut !== undefined) return <>{signedOut}</>
		return <Navigate to={paths.signIn} state={{ from: location.pathname + location.search }} replace />
	}

	return <>{children}</>
}
