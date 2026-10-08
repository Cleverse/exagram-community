import { workspaceContract } from "@exagram/core/contract/workspace/contract"
import { implement } from "@orpc/server"

import { requireUser } from "../plugins/require-user.middleware"

import type { AuthContext, BaseContext } from "../plugins/context"
import type { InvitesUsecase } from "../usecase/workspace/invites.usecase"
import type { MembersUsecase } from "../usecase/workspace/members.usecase"
import type { ResetLinksUsecase } from "../usecase/workspace/reset-links.usecase"

export const createWorkspaceRouter = ({
	invitesUsecase,
	membersUsecase,
	resetLinksUsecase,
}: {
	invitesUsecase: InvitesUsecase
	membersUsecase: MembersUsecase
	resetLinksUsecase: ResetLinksUsecase
}) => {
	const os = implement(workspaceContract).$context<BaseContext>()
	const authed = os.$context<AuthContext>()

	return os.use(requireUser).router({
		createInvite: authed.createInvite.handler(async ({ context, input }) => ({
			result: await invitesUsecase.create(context.user, input.body),
		})),
		listInvites: authed.listInvites.handler(async ({ context }) => ({
			result: {
				items: await invitesUsecase.list(context.user),
				passwordReset: await resetLinksUsecase.availableTo(context.user),
			},
		})),
		renewInvite: authed.renewInvite.handler(async ({ context, input }) => ({
			result: await invitesUsecase.renew(context.user, input.params.id),
		})),
		revokeInvite: authed.revokeInvite.handler(async ({ context, input }) => ({
			result: await invitesUsecase.revoke(context.user, input.params.id),
		})),
		listMembers: authed.listMembers.handler(async ({ context }) => ({
			result: await membersUsecase.list(context.user),
		})),
		setMemberRole: authed.setMemberRole.handler(async ({ context, input }) => ({
			result: await membersUsecase.setRole(context.user, input.params.userId, input.body.role),
		})),
		removeMember: authed.removeMember.handler(async ({ context, input }) => ({
			result: await membersUsecase.remove(context.user, input.params.userId, input.body.transferTo),
		})),
		createResetLink: authed.createResetLink.handler(async ({ context, input }) => ({
			result: await resetLinksUsecase.createForMember(context.user, input.body.email),
		})),
	})
}
