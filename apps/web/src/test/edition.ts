import { onTestFinished } from "vitest"

import { edition } from "@/edition/edition"
import { edition as community } from "@/edition/edition"

/** Runs the rest of the test with Community's General Access: no `org` choice, and its words for a stored one. */
export const asCommunityGeneralAccess = () => {
	const saved = { generalAccessOrg: edition.generalAccessOrg, copy: edition.copy }
	Object.assign(edition, { generalAccessOrg: community.generalAccessOrg, copy: community.copy })
	onTestFinished(() => {
		Object.assign(edition, saved)
	})
}

/** Runs the rest of the test with Community's Invites: Member only, and a link to copy only where Google signs in. */
export const asCommunityInvites = () => {
	const saved = { adminInvites: edition.adminInvites, useInviteLinkCopyable: edition.useInviteLinkCopyable }
	Object.assign(edition, {
		adminInvites: community.adminInvites,
		useInviteLinkCopyable: community.useInviteLinkCopyable,
	})
	onTestFinished(() => {
		Object.assign(edition, saved)
	})
}

/** Runs the rest of the test with Community's weekly recap: an empty library shows an empty week, never a sample. */
export const asCommunityRecap = () => {
	const saved = { recapSample: edition.recapSample }
	Object.assign(edition, { recapSample: community.recapSample })
	onTestFinished(() => {
		Object.assign(edition, saved)
	})
}
