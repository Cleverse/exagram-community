import { type FormEvent, useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"

import { edition } from "@/edition/edition"
import { AuthCard, AuthField, authPrimaryClass } from "@/features/auth/AuthCard"
import { googleAuthError } from "@/features/auth/authErrors"
import { GoogleButton } from "@/features/auth/GoogleButton"
import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { useSignIn } from "@/features/auth/hooks/useSignIn"
import { joinWaitPath } from "@/features/join/joinWait"
import { paths } from "@/routes/paths"

const FILE_PATH = /^\/(artifacts|projects)\/[0-9a-f-]{36}$/

/** What `AuthGuard` remembered: `to` for password sign-in, `file` for Google (the query only tells us `?invited=1`). */
const readFrom = (state: unknown) => {
	const from = typeof state === "object" && state !== null && "from" in state ? state.from : undefined
	if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//") || from.includes("\\")) return null
	const [path = "", query = ""] = from.split("?", 2)
	const match = FILE_PATH.exec(path)
	return {
		to: from,
		file: match ? { path, kind: match[1] === "projects" ? "a project" : "a file" } : null,
		invited: new URLSearchParams(query).get("invited") === "1",
	}
}

export const SignInPage = () => {
	const navigate = useNavigate()
	const location = useLocation()
	const from = readFrom(location.state)
	const [searchParams] = useSearchParams()
	const providers = useAuthProviders()
	const signIn = useSignIn()
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [passwordOpen, setPasswordOpen] = useState(false)
	const errorMessage = googleAuthError(searchParams.get("error"), edition.copy.googleErrors)
	const displayError = signIn.isError ? signIn.error.message : errorMessage
	const googleEnabled = providers.data?.google === true
	const showPassword = !googleEnabled || passwordOpen || searchParams.get("error") === "account_exists"

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		signIn.mutate(
			{ email, password },
			{
				// Replace, so Back from where sign-in lands never returns to the form (mobile Activity has a Back).
				onSuccess: () => void navigate(from?.to ?? paths.library, { replace: true }),
				onError: (error) => {
					const wait = joinWaitPath(error)
					if (wait) void navigate(wait, { replace: true })
				},
			},
		)
	}
	if (providers.isPending) return <AuthCard title="Sign in to Exagram">Loading sign-in options…</AuthCard>

	return (
		<AuthCard title="Sign in to Exagram">
			{googleEnabled && from?.file && from.invited ? (
				<p className="mb-4 text-[14px] text-muted">
					You were invited to {from.file.kind} on Exagram. Sign in with Google using the address the invite was sent to.
				</p>
			) : null}
			{googleEnabled ? <GoogleButton {...(from?.file ? { returnTo: from.file.path } : {})} /> : null}
			{displayError ? (
				<p role="alert" className="mt-4 text-[14px] text-danger">
					{displayError}
				</p>
			) : null}
			{googleEnabled && !showPassword ? (
				<button
					className="mt-5 text-[14px] text-ink underline underline-offset-[3px] hover:text-link-hover"
					type="button"
					onClick={() => setPasswordOpen(true)}
				>
					Use email and password
				</button>
			) : null}
			{showPassword ? (
				<form className="mt-5 flex flex-col gap-5" onSubmit={onSubmit}>
					<AuthField
						id="signin-email"
						label="Email"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
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
				</form>
			) : null}
			{providers.data?.signUp === false ? null : (
				<p className="mt-5 text-[14px] text-muted">
					No account yet?{" "}
					<Link
						className="font-medium text-ink underline underline-offset-[3px] hover:text-link-hover"
						to={paths.signUp}
					>
						Create one
					</Link>
				</p>
			)}
		</AuthCard>
	)
}
