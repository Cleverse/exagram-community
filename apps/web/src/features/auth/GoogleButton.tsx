import { API_ORIGIN } from "@/config/env"

export type GoogleButtonProps = {
	workspaceName?: string
	/** A Join Link's token; the Invite names the Workspace, so it goes alone. */
	inviteToken?: string
	domainLinkId?: string
	choice?: { join: string } | "create"
	/** A file path to land on after sign-in; the API drops anything that is not `/artifacts/{id}` or `/projects/{id}`. */
	returnTo?: string
	disabled?: boolean
	disabledReason?: string
	label?: string
}

const googleStartUrl = ({ workspaceName, inviteToken, domainLinkId, choice, returnTo }: GoogleButtonProps) => {
	const url = new URL("/v1/auth/google/start", API_ORIGIN)
	const params = new URLSearchParams()
	if (inviteToken || domainLinkId || choice) {
		if (inviteToken) params.set("inviteToken", inviteToken)
		else if (domainLinkId) params.set("domainLinkId", domainLinkId)
		else if (choice === "create") params.set("choice", "create")
		else if (choice) {
			params.set("choice", "join")
			params.set("workspaceId", choice.join)
		}
		url.search = params.toString()
		return url.toString()
	}
	if (workspaceName?.trim()) params.set("workspaceName", workspaceName)
	if (returnTo) params.set("returnTo", returnTo)
	url.search = params.toString()
	return url.toString()
}

export const GoogleButton = ({
	disabled = false,
	disabledReason,
	label = "Continue with Google",
	...props
}: GoogleButtonProps) => (
	<div>
		{disabled ? (
			<div
				className="flex h-11 w-full items-center justify-center bg-primary text-[15px] font-semibold text-white opacity-50"
				aria-disabled="true"
			>
				{label}
			</div>
		) : (
			<a
				href={googleStartUrl(props)}
				className="flex h-11 w-full items-center justify-center bg-primary text-[15px] font-semibold text-white hover:bg-primary-hover"
			>
				{label}
			</a>
		)}
		{disabledReason ? <p className="mt-2 text-center text-[13px] text-muted">{disabledReason}</p> : null}
	</div>
)
