import { type FormEvent, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"

import { edition } from "@/edition/edition"
import { AuthCard, AuthField, authPrimaryClass } from "@/features/auth/AuthCard"
import { googleAuthError } from "@/features/auth/authErrors"
import { GoogleButton } from "@/features/auth/GoogleButton"
import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { useInvitePreview } from "@/features/auth/hooks/useInvitePreview"
import { useSignUp } from "@/features/auth/hooks/useSignIn"
import { PreviewFailure } from "@/features/auth/PreviewFailure"
import { joinWaitPath } from "@/features/join/joinWait"
import { paths } from "@/routes/paths"

const SignInLink = () => (
	<p className="mt-5 text-[14px] text-muted">
		Already have an account?{" "}
		<Link className="font-medium text-ink underline underline-offset-[3px] hover:text-link-hover" to={paths.signIn}>
			Sign in
		</Link>
	</p>
)

/**
 * Where a Join Link lands. Open even when the install's sign-up is closed: the Invite is the way in. The
 * email is the Invite's and cannot be changed; with Google on, Google must verify that same address.
 */
export const JoinPage = () => {
	const { token = "" } = useParams()
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const providers = useAuthProviders()
	const preview = useInvitePreview(token)
	const signUp = useSignUp()
	const [name, setName] = useState("")
	const [password, setPassword] = useState("")
	const errorMessage = googleAuthError(searchParams.get("error"), edition.copy.googleErrors)
	const displayError = signUp.isError ? signUp.error.message : errorMessage

	if (providers.isPending || preview.isPending) return <AuthCard title="Join Exagram">Loading your invite…</AuthCard>

	// Without the providers the page cannot tell Google from password, so it fails like a failed preview.
	if (preview.isError || providers.isError)
		return (
			<AuthCard title="Join Exagram">
				<PreviewFailure
					error={preview.error ?? providers.error ?? new Error("Something went wrong.")}
					dead="This invite is no longer valid. Ask your Admin for a new link."
					onRetry={() => {
						if (preview.isError) void preview.refetch()
						if (providers.isError) void providers.refetch()
					}}
				>
					<SignInLink />
				</PreviewFailure>
			</AuthCard>
		)

	const invite = preview.data
	const googleEnabled = providers.data?.google === true

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		signUp.mutate(
			{ email: invite.email, name, password, inviteToken: token },
			{
				onSuccess: () => void navigate(paths.library, { replace: true }),
				onError: (error) => {
					const wait = joinWaitPath(error)
					if (wait) void navigate(wait, { replace: true })
				},
			},
		)
	}

	return (
		<AuthCard title={edition.copy.joinTitle(invite.workspaceName)}>
			<p className="mb-4 text-[14px] text-muted">{edition.copy.joinLine(invite.workspaceName, invite.role)}</p>
			{googleEnabled ? (
				<>
					<GoogleButton inviteToken={token} />
					<p className="mt-3 text-[14px] text-muted">{`Continue with Google using ${invite.email}.`}</p>
				</>
			) : null}
			{displayError ? (
				<p role="alert" className="mt-4 text-[14px] text-danger">
					{displayError}
				</p>
			) : null}
			{!googleEnabled ? (
				<form className="mt-5 flex flex-col gap-5" onSubmit={onSubmit}>
					<AuthField id="join-email" label="Email" type="email" value={invite.email} readOnly aria-readonly="true" />
					<AuthField
						id="join-name"
						label="Name"
						autoComplete="name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						required
					/>
					<AuthField
						id="join-password"
						label="Password"
						type="password"
						autoComplete="new-password"
						minLength={12}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
					<button className={authPrimaryClass} type="submit" disabled={signUp.isPending}>
						{signUp.isPending ? "Joining…" : "Join"}
					</button>
				</form>
			) : null}
			<SignInLink />
		</AuthCard>
	)
}
