import { requestWebUpdateCheck } from "./webVersion"

import { useLiveEvent } from "@/features/live/LiveEventsProvider"

/** Inside `LiveEventsProvider`: turns the feed's `webDeployed` into a check by the root `WebUpdateReloader`. */
export const WebDeployedListener = () => {
	useLiveEvent((event) => {
		if (event.topic === "webDeployed") requestWebUpdateCheck()
	})
	return null
}
