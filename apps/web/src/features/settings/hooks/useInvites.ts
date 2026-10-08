import { type IssuedInvite, isApiError, type Timestamp, type WorkspaceInvite } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { QueryKeys } from "@/config/queryKeys"
import { edition } from "@/edition/edition"
import { useInvalidate } from "@/utils/react-query"

export type InviteRole = WorkspaceInvite["role"]

export const INVITE_ROLE_LABEL: Record<InviteRole, string> = { member: "Member", admin: "Admin" }

/** "Expires 12 Oct", or "Expired" once its Join Link has stopped working. */
export const inviteExpiry = (invite: { expiresAt: Timestamp }, now = new Date()) => {
	const expiresAt = new Date(invite.expiresAt)
	return expiresAt.getTime() <= now.getTime()
		? "Expired"
		: `Expires ${expiresAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
}

/** The Admin's Invites list; it also says whether this install lets them create Reset Links. */
export const invitesQuery = () => ({
	queryKey: QueryKeys.workspace.invites(),
	queryFn: () => apiClient.workspace.listInvites(),
})

/** Only an Admin lists Invites or chooses a role; anyone else invites as a Member. */
export const useInvites = (admin: boolean) => {
	const invalidate = useInvalidate()
	const toast = useToast()
	const [email, setEmail] = useState("")
	const [role, setRole] = useState<InviteRole>("member")
	const [issued, setIssued] = useState<(IssuedInvite & { url: string }) | null>(null)
	const list = useQuery({ ...invitesQuery(), select: (data) => data.items, enabled: admin })

	const copy = (url: string) =>
		void navigator.clipboard.writeText(url).then(
			() => toast("Invite link copied"),
			() => toast("Could not copy — select the link and copy it"),
		)

	const onIssued = (next: IssuedInvite, sentToast: string) => {
		invalidate([QueryKeys.workspace.invites(), QueryKeys.workspace.seats()])
		const { url } = next
		if (next.emailQueued || url === null) {
			setIssued(null)
			toast(sentToast)
			return
		}
		setIssued({ ...next, url })
		copy(url)
	}

	const create = useMutation({
		mutationFn: (input: { email: string; role: InviteRole }) => apiClient.workspace.createInvite(input),
		onSuccess: (next) => {
			setEmail("")
			onIssued(next, `Invite sent to ${next.invite.email} as ${INVITE_ROLE_LABEL[next.invite.role]}.`)
		},
	})
	const renew = useMutation({
		mutationFn: (inviteId: string) => apiClient.workspace.renewInvite({ inviteId }),
		onSuccess: (next) => onIssued(next, `Invite re-sent to ${next.invite.email}.`),
	})
	const revoke = useMutation({
		mutationFn: (inviteId: string) => apiClient.workspace.revokeInvite({ inviteId }),
		onSuccess: ({ id }) => {
			if (issued?.invite.id === id) setIssued(null)
			invalidate([QueryKeys.workspace.invites(), QueryKeys.workspace.seats()])
		},
	})

	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (email.trim()) create.mutate({ email: email.trim(), role: admin ? role : "member" })
	}

	const createRefused = isApiError(create.error) && create.error.status === 404
	const errorMessage = createRefused
		? edition.copy.inviteRefused
		: (create.error ?? renew.error ?? revoke.error)?.message
	return { email, setEmail, role, setRole, issued, list, create, renew, revoke, submit, copy, errorMessage }
}
