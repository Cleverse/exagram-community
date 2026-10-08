import { isApiError } from "@exagram/api-client"

import { paths } from "@/routes/paths"

export const joinWaitPath = (error: unknown): string | null =>
	isApiError(error) && error.code === "JOIN_PENDING" ? paths.joinPending : null
