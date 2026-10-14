import { type ReactNode, useEffect, useState } from "react"

import { RequestAccessCard } from "@/features/access-requests/RequestAccessCard"
import { useForgetSent, useSentRequest } from "@/features/access-requests/sentRequests"
import { useRequestAnswer } from "@/features/access-requests/useMyAccessRequest"

/**
 * Puts the Owner's approval, with Open, in front of a file this browser asked for. The feed decides, so a file
 * reached by a Link or General Access never claims one.
 */
export const ApprovedGate = ({
	artifactId,
	children,
	fallback = null,
	frame = (card) => card,
}: {
	artifactId: string
	children: ReactNode
	fallback?: ReactNode
	frame?: (card: ReactNode) => ReactNode
}) => {
	const sent = useSentRequest(artifactId)
	const { asking, failed, answer } = useRequestAnswer(artifactId, sent)
	const forget = useForgetSent(artifactId)
	const [opened, setOpened] = useState(false)
	const granted = answer?.outcome === "granted" ? answer : null
	const settledWithoutGrant = sent !== undefined && !asking && !failed && granted === null

	useEffect(() => {
		if (settledWithoutGrant) forget()
	}, [settledWithoutGrant, forget])

	if (sent === undefined || opened || failed) return children
	if (asking) return fallback
	if (granted === null) return children
	return frame(
		<RequestAccessCard
			view={{
				state: "approved",
				title: granted.title,
				ownerName: granted.ownerName,
				role: granted.role,
				onOpen: () => {
					forget()
					setOpened(true)
				},
			}}
		/>,
	)
}
