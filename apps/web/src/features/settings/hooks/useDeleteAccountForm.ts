import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router"

import { apiClient } from "@/config/apiClient"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSessionBoundary } from "@/features/auth/hooks/useSignIn"
import { paths } from "@/routes/paths"

/** Only gates the button; the server decides whether the confirmation is the account's address. */
export const confirmsEmail = (typed: string, email: string) =>
	email !== "" && typed.trim().toLowerCase() === email.trim().toLowerCase()

/**
 * Deleting one's own account, for the desktop dialog and the phone drawer alike. Success leaves the way sign-out
 * does, dropping what the session cached, but goes to sign-in itself: the guard would carry the Settings address
 * there as the place to return to, and that account is gone. `settle` gets that step and decides when to run it: a
 * dialog runs it at once, a drawer closes first so its history entry goes before the navigation replaces the screen.
 */
export const useDeleteAccountForm = (settle: (leave: () => void) => void) => {
	const me = useMe()
	const navigate = useNavigate()
	const crossed = useSessionBoundary()
	const [typed, setTyped] = useState("")
	const email = me.data?.email ?? ""

	const remove = useMutation({
		mutationFn: (confirmEmail: string) => apiClient.auth.deleteAccount({ confirmEmail }),
		onSuccess: () =>
			settle(() => {
				void navigate(paths.signIn, { replace: true })
				crossed()
			}),
	})
	const canSubmit = confirmsEmail(typed, email) && !remove.isPending && !remove.isSuccess

	return {
		email,
		typed,
		setTyped,
		inTeam: me.data?.workspaces.some((workspace) => workspace.kind === "team") ?? false,
		canSubmit,
		pending: remove.isPending,
		error: remove.isError ? remove.error.message : null,
		submit: () => {
			if (canSubmit) remove.mutate(typed.trim())
		},
	}
}

export type DeleteAccountFormState = ReturnType<typeof useDeleteAccountForm>
