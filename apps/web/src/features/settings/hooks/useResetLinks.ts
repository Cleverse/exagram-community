import { type IssuedResetLink, isApiError } from "@exagram/api-client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"

import { useToast } from "@/components/Toast"
import { apiClient } from "@/config/apiClient"
import { invitesQuery } from "@/features/settings/hooks/useInvites"

/** Whether this install lets an Admin create Reset Links; read off the Admin-only Invites list. */
export const usePasswordResetAvailable = (isAdmin: boolean) =>
	useQuery({ ...invitesQuery(), select: (data) => data.passwordReset, enabled: isAdmin }).data === true

/** The server refuses every case alike (a 404); this names the ones an Admin can act on. */
export const RESET_LINK_REFUSED =
	"No Member with that email can get a reset link here. Admins, people who sign in only with Google, and people with files, shares or Connections in their Personal Workspace can't; an Admin resets theirs on the server."

/**
 * An Admin's "Reset a password" on General, for desktop and mobile alike: an email makes a Reset Link, shown and
 * copied once, which the Admin sends themselves. A new one for the same person replaces the old.
 */
export const useResetLinks = () => {
	const toast = useToast()
	const [email, setEmail] = useState("")
	const [issued, setIssued] = useState<(IssuedResetLink & { email: string }) | null>(null)

	const copy = (url: string) =>
		void navigator.clipboard.writeText(url).then(
			() => toast("Reset link copied"),
			() => toast("Could not copy — select the link and copy it"),
		)

	const create = useMutation({
		mutationFn: (input: { email: string }) => apiClient.workspace.createResetLink(input),
		onSuccess: (next, input) => {
			setEmail("")
			setIssued({ ...next, email: input.email })
			copy(next.url)
		},
	})

	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (email.trim()) create.mutate({ email: email.trim() })
	}

	const error = create.error
	const errorMessage = error ? (isApiError(error) && error.status === 404 ? RESET_LINK_REFUSED : error.message) : null

	return { email, setEmail, issued, create, submit, copy, errorMessage }
}
