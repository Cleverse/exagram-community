import { type Grant } from "@exagram/api-client"

export const personGrant = (flat: Omit<Grant, "grantee">): Grant => ({
	...flat,
	grantee: {
		kind: "person",
		id: flat.granteeId,
		email: flat.granteeEmail,
		name: flat.granteeName,
		pending: flat.granteePending,
	},
})

export const groupGrant = (
	group: { id: string; name: string; memberCount: number },
	rest: Omit<Grant, "grantee" | "granteeId" | "granteeEmail" | "granteeName" | "granteePending">,
): Grant => ({
	...rest,
	grantee: { kind: "group", ...group },
	granteeId: group.id,
	granteeEmail: "",
	granteeName: group.name,
	granteePending: false,
})
