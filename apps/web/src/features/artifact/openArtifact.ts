import { type NavigateFunction, type NavigateOptions } from "react-router"

import { macTabs } from "@/features/notifications/macBridge"
import { paths } from "@/routes/paths"

/**
 * An Artifact's full page. In the Mac app it opens in a tab of its own (bridge version 3), as a file does in a
 * desktop editor; the list it was opened from stays where it was. A browser navigates in place.
 */
export const openArtifact = (navigate: NavigateFunction, artifactId: string, options?: NavigateOptions): void => {
	if (macTabs()) window.open(paths.artifact(artifactId), "_blank")
	else void navigate(paths.artifact(artifactId), options)
}

/** A link's `target` for an Artifact's page, so a plain click opens a tab in the Mac app too. */
export const artifactLinkTarget = (): "_blank" | undefined => (macTabs() ? "_blank" : undefined)
