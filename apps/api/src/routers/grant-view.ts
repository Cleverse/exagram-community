import type { GrantView } from "@exagram/core/contract/grants/type"
import type { Grant } from "@exagram/core/entity/grant"

/** The wire shape: `grantee`, plus the flat fields that clients shipped before Groups decode. */
export const grantView = ({ grantee, ...grant }: Grant): GrantView => ({
	...grant,
	grantee,
	granteeId: grantee.id,
	granteeEmail: grantee.kind === "person" ? grantee.email : "",
	granteeName: grantee.name,
	granteePending: grantee.kind === "person" && grantee.pending,
})
