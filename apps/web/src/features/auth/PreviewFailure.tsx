import { isApiError } from "@exagram/api-client"

import type { ReactNode } from "react"

import { Button } from "@/components/ui/Button"

/**
 * What a Join or Reset Link page says when its preview fails. Only a 404 means the link is dead; anything else
 * (a rate limit, a network drop) shows the error's own message with a way to ask again.
 */
export const PreviewFailure = ({
	error,
	dead,
	onRetry,
	children,
}: {
	error: Error
	dead: string
	onRetry: () => void
	children: ReactNode
}) => (
	<>
		<p role="alert" className="text-[14px] text-danger">
			{isApiError(error) && error.status === 404 ? dead : error.message}
		</p>
		{isApiError(error) && error.status === 404 ? null : (
			<Button className="mt-4" variant="outline" size={44} onClick={onRetry}>
				Try again
			</Button>
		)}
		{children}
	</>
)
