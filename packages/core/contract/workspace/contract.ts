import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"

import {
	CreateInviteBodySchema,
	CreateResetLinkBodySchema,
	IssuedInviteSchema,
	IssuedResetLinkSchema,
	MemberListSchema,
	MemberSchema,
	RemoveMemberBodySchema,
	SetMemberRoleBodySchema,
	WorkspaceInvitesSchema,
} from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })

export const workspaceContract = oc.router({
	createInvite: base
		.route({ method: "POST", path: "/workspace/invites" })
		.input(z.object({ body: CreateInviteBodySchema }))
		.output(responseSchema(IssuedInviteSchema)),

	listInvites: base
		.route({ method: "GET", path: "/workspace/invites" })
		.input(z.object({}))
		.output(responseSchema(WorkspaceInvitesSchema)),

	renewInvite: base
		.route({ method: "POST", path: "/workspace/invites/{id}/renew" })
		.input(z.object({ params: z.object({ id: z.uuid() }) }))
		.output(responseSchema(IssuedInviteSchema)),

	revokeInvite: base
		.route({ method: "DELETE", path: "/workspace/invites/{id}" })
		.input(z.object({ params: z.object({ id: z.uuid() }) }))
		.output(responseSchema(z.object({ id: z.uuid() }))),

	listMembers: base
		.route({ method: "GET", path: "/workspace/members" })
		.input(z.object({}))
		.output(responseSchema(MemberListSchema)),

	setMemberRole: base
		.route({ method: "POST", path: "/workspace/members/{userId}/role" })
		.input(z.object({ params: z.object({ userId: z.uuid() }), body: SetMemberRoleBodySchema }))
		.output(responseSchema(MemberSchema)),

	removeMember: base
		.route({ method: "POST", path: "/workspace/members/{userId}/remove" })
		.input(z.object({ params: z.object({ userId: z.uuid() }), body: RemoveMemberBodySchema }))
		.output(responseSchema(z.object({ id: z.uuid() }))),

	createResetLink: base
		.route({ method: "POST", path: "/workspace/members/reset-link" })
		.input(z.object({ body: CreateResetLinkBodySchema }))
		.output(responseSchema(IssuedResetLinkSchema)),
})
