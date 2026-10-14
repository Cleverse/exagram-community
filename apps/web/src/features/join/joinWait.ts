import { isApiError } from "@exagram/api-client"
import { useNavigate } from "react-router"

import { paths } from "@/routes/paths"

const WAIT_PATHS = new Map([
	["JOIN_PENDING", paths.joinPending],
	["JOIN_DECLINED", paths.joinDeclined],
])

export const joinWaitPath = (error: unknown): string | null =>
	(isApiError(error) && error.code !== undefined ? WAIT_PATHS.get(error.code) : undefined) ?? null

/** `onError` for a sign-in: a pending or declined Join Request is a page of its own, not an alert. */
export const useJoinWaitRedirect = () => {
	const navigate = useNavigate()
	return (error: unknown) => {
		const wait = joinWaitPath(error)
		if (wait) void navigate(wait, { replace: true })
	}
}
