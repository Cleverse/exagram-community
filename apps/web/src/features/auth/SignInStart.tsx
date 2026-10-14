import { type FormEvent, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { edition } from "@/edition/edition"
import { AppleButton } from "@/features/auth/AppleButton"
import { AuthCard, AuthField, authPrimaryClass } from "@/features/auth/AuthCard"
import { googleAuthError } from "@/features/auth/authErrors"
import { GoogleButton } from "@/features/auth/GoogleButton"
import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { useSignIn } from "@/features/auth/hooks/useSignIn"
import { type SignInFrom } from "@/features/auth/signInFrom"
import { useJoinWaitRedirect } from "@/features/join/joinWait"
import { paths } from "@/routes/paths"

const linkClass = "font-medium text-ink underline underline-offset-[3px] hover:text-link-hover"

/**
 * The sign-in card's first step: the social buttons, then either email sign-in (an emailed code, where the edition
 * has it) or the password form. Without mail there is no code to send, so the password form stands alone; with it,
 * the password form is one click away, and an `account_exists` bounce from Google opens it.
 */
export const SignInStart = ({
	email,
	onEmailChange,
	from,
	onSent,
	onSignedIn,
}: {
	email: string
	onEmailChange: (email: string) => void
	from: SignInFrom | null
	onSent: () => void
	onSignedIn: () => void
}) => {
	const [searchParams] = useSearchParams()
	const providers = useAuthProviders().data
	const signIn = useSignIn()
	const send = edition.useEmailSignInSend()
	const EmailSignIn = edition.emailSignIn
	const DesktopAppLink = edition.DesktopAppLink
	const ServerFooter = edition.ServerFooter
	const redirectIfWaiting = useJoinWaitRedirect()
	const [password, setPassword] = useState("")
	const [method, setMethod] = useState<"code" | "password">(
		searchParams.get("error") === "account_exists" ? "password" : "code",
	)

	const google = providers?.google === true
	const apple = providers?.apple === true
	const emailCode = providers?.emailCode === true && send !== null && EmailSignIn !== null
	const passwordForm = !emailCode || method === "password"
	const returnTo = from?.file?.path
	// With buttons or an emailed code first, the card needs no heading; a lone password form gets one.
	const passwordOnly = edition.followsProviders && providers !== undefined && !google && !apple && !emailCode

	const formError = signIn.isError ? signIn.error.message : send?.isError ? send.error.message : undefined
	const redirectError =
		formError === undefined ? googleAuthError(searchParams.get("error"), edition.copy.googleErrors) : undefined

	const switchTo = (next: "code" | "password") => {
		signIn.reset()
		send?.reset()
		setMethod(next)
	}

	const onPasswordSubmit = (event: FormEvent) => {
		event.preventDefault()
		signIn.mutate({ email, password }, { onSuccess: onSignedIn, onError: redirectIfWaiting })
	}

	const onEmailSubmit = (event: FormEvent) => {
		event.preventDefault()
		send?.mutate(returnTo ? { email, returnTo } : { email }, { onSuccess: onSent })
	}

	return (
		<AuthCard
			title="Sign in to Exagram"
			hideTitle={!passwordOnly}
			below={DesktopAppLink ? <DesktopAppLink /> : undefined}
		>
			{(google || apple || emailCode) && from?.file && from.invited ? (
				<p className="mb-4 text-[14px] text-muted">
					{`You were invited to ${from.file.kind} on Exagram. Sign in with the address the invite was sent to.`}
				</p>
			) : null}
			{google || apple ? (
				<div className="flex flex-col gap-3">
					{google ? <GoogleButton {...(returnTo ? { returnTo } : {})} /> : null}
					{apple ? <AppleButton {...(returnTo ? { returnTo } : {})} /> : null}
				</div>
			) : null}
			{redirectError ? (
				<p role="alert" className="mt-4 text-[14px] text-danger">
					{redirectError}
				</p>
			) : null}
			{google || apple ? (
				<div className="my-5 flex items-center gap-3">
					<div aria-hidden className="h-px flex-1 bg-line" />
					<span className="mono-label">OR</span>
					<div aria-hidden className="h-px flex-1 bg-line" />
				</div>
			) : null}
			{passwordForm ? (
				<form className="flex flex-col gap-4" onSubmit={onPasswordSubmit}>
					<AuthField
						id="signin-email"
						label="Email"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(event) => onEmailChange(event.target.value)}
						required
					/>
					<AuthField
						id="signin-password"
						label="Password"
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
					<button className={authPrimaryClass} type="submit" disabled={signIn.isPending}>
						{signIn.isPending ? "Signing in…" : "Sign in"}
					</button>
					{edition.copy.forgotPassword ? (
						<p className="m-0 text-center text-[14px] text-muted">{edition.copy.forgotPassword}</p>
					) : null}
				</form>
			) : EmailSignIn !== null && send !== null ? (
				<EmailSignIn.StartForm
					email={email}
					onEmailChange={onEmailChange}
					pending={send.isPending}
					onSubmit={onEmailSubmit}
				/>
			) : null}
			{formError ? (
				<p role="alert" className="mt-4 text-[14px] text-danger">
					{formError}
				</p>
			) : null}
			{emailCode && EmailSignIn !== null ? (
				<EmailSignIn.MethodSwitch toCode={passwordForm} onSwitch={() => switchTo(passwordForm ? "code" : "password")} />
			) : null}
			{providers?.signUp === false ? null : (
				<p className="mt-6 text-center text-[14px] text-muted">
					No account yet?{" "}
					<Link className={linkClass} to={paths.signUp}>
						Create one
					</Link>
				</p>
			)}
			{ServerFooter ? <ServerFooter /> : null}
		</AuthCard>
	)
}
