import { type FormEvent, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { edition } from "@/edition/edition"
import { AuthCard, AuthField, authPrimaryClass } from "@/features/auth/AuthCard"
import { googleAuthError, SIGN_UP_INVITE_ONLY } from "@/features/auth/authErrors"
import { GoogleButton } from "@/features/auth/GoogleButton"
import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSignUp } from "@/features/auth/hooks/useSignIn"
import { paths } from "@/routes/paths"

export const SignUpPage = () => {
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const providers = useAuthProviders()
	const me = useMe()
	const signUp = useSignUp()
	const [email, setEmail] = useState("")
	const [name, setName] = useState("")
	const [password, setPassword] = useState("")
	const errorMessage = googleAuthError(searchParams.get("error"), edition.copy.googleErrors)
	const displayError = signUp.isError ? signUp.error.message : errorMessage
	const googleEnabled = providers.data?.google === true

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		signUp.mutate(
			{ email, name, password },
			{
				// Replace, so Back from where sign-in lands never returns to the form (mobile Activity has a Back).
				onSuccess: () => void navigate(paths.library, { replace: true }),
			},
		)
	}
	if (providers.isPending) return <AuthCard title="Create an Exagram account">Loading sign-in options…</AuthCard>

	if (providers.isError)
		return (
			<AuthCard title="Create an Exagram account">
				<p role="alert" className="text-[14px] text-danger">
					Couldn't load sign-up options.
				</p>
				<button
					className="mt-3 text-[14px] text-ink underline underline-offset-[3px] hover:text-link-hover"
					type="button"
					onClick={() => void providers.refetch()}
				>
					Try again
				</button>
				<p className="mt-5 text-[14px] text-muted">
					Already have one?{" "}
					<Link
						className="font-medium text-ink underline underline-offset-[3px] hover:text-link-hover"
						to={paths.signIn}
					>
						Sign in
					</Link>
				</p>
			</AuthCard>
		)

	if (providers.data.signUp === false)
		return (
			<AuthCard title="Create an Exagram account">
				<p className="text-[14px] text-muted">{SIGN_UP_INVITE_ONLY}</p>
				<p className="mt-5 text-[14px] text-muted">
					Already have one?{" "}
					<Link
						className="font-medium text-ink underline underline-offset-[3px] hover:text-link-hover"
						to={paths.signIn}
					>
						Sign in
					</Link>
				</p>
			</AuthCard>
		)

	return (
		<AuthCard title="Create an Exagram account">
			{me.isSuccess ? (
				<p className="mb-4 text-[14px] text-muted">
					{`You're signed in as ${me.data.email}. Signing up here makes a new account and signs you in as it.`}
				</p>
			) : null}
			<p className="mb-4 text-[14px] text-muted">{edition.copy.signUpIntro}</p>
			{googleEnabled ? <GoogleButton /> : null}
			{displayError ? (
				<p role="alert" className="mt-4 text-[14px] text-danger">
					{displayError}
				</p>
			) : null}
			{!googleEnabled ? (
				<form className="mt-5 flex flex-col gap-5" onSubmit={onSubmit}>
					<AuthField
						id="signup-name"
						label="Name"
						autoComplete="name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						required
					/>
					<AuthField
						id="signup-email"
						label="Email"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
					/>
					<AuthField
						id="signup-password"
						label="Password"
						type="password"
						autoComplete="new-password"
						minLength={12}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
					<button className={authPrimaryClass} type="submit" disabled={signUp.isPending}>
						{signUp.isPending ? "Creating…" : "Create account"}
					</button>
				</form>
			) : null}
			<p className="mt-5 text-[14px] text-muted">
				Already have one?{" "}
				<Link className="font-medium text-ink underline underline-offset-[3px] hover:text-link-hover" to={paths.signIn}>
					Sign in
				</Link>
			</p>
		</AuthCard>
	)
}
