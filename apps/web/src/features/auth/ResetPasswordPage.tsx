import { type FormEvent, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"

import { edition } from "@/edition/edition"
import { AuthCard, AuthField, authPrimaryClass } from "@/features/auth/AuthCard"
import { useResetLinkPreview, useResetPassword } from "@/features/auth/hooks/useResetLink"
import { PreviewFailure } from "@/features/auth/PreviewFailure"
import { paths } from "@/routes/paths"

const SignInLink = () => (
	<p className="mt-5 text-[14px] text-muted">
		Remembered it?{" "}
		<Link className="font-medium text-ink underline underline-offset-[3px] hover:text-link-hover" to={paths.signIn}>
			Sign in
		</Link>
	</p>
)

/**
 * Where a Reset Link lands: a new password for the account it names, which ends every other
 * session of that account and signs in here. A wrong, expired or used link all read the same.
 */
export const ResetPasswordPage = () => {
	const { token = "" } = useParams()
	const navigate = useNavigate()
	const preview = useResetLinkPreview(token)
	const reset = useResetPassword()
	const [password, setPassword] = useState("")

	if (preview.isPending) return <AuthCard title="Reset your password">Checking your reset link…</AuthCard>

	if (preview.isError)
		return (
			<AuthCard title="Reset your password">
				<PreviewFailure
					error={preview.error}
					dead="This reset link is no longer valid. Ask your Admin for a new one."
					onRetry={() => void preview.refetch()}
				>
					<SignInLink />
				</PreviewFailure>
			</AuthCard>
		)

	const account = preview.data

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		reset.mutate({ token, password }, { onSuccess: () => void navigate(paths.library, { replace: true }) })
	}

	return (
		<AuthCard title="Reset your password">
			<p className="mb-4 text-[14px] text-muted">{edition.copy.resetLine(account.workspaceName)}</p>
			{reset.isError ? (
				<p role="alert" className="mt-4 text-[14px] text-danger">
					{reset.error.message}
				</p>
			) : null}
			<form className="mt-5 flex flex-col gap-5" onSubmit={onSubmit}>
				<AuthField id="reset-email" label="Email" type="email" value={account.email} readOnly aria-readonly="true" />
				<AuthField
					id="reset-password"
					label="New password"
					type="password"
					autoComplete="new-password"
					minLength={12}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					required
				/>
				<button className={authPrimaryClass} type="submit" disabled={reset.isPending}>
					{reset.isPending ? "Saving…" : "Set password"}
				</button>
			</form>
			<SignInLink />
		</AuthCard>
	)
}
