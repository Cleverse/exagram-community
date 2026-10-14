import { useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { edition } from "@/edition/edition"
import { AuthCard } from "@/features/auth/AuthCard"
import { useAuthProviders } from "@/features/auth/hooks/useAuthProviders"
import { readSignInFrom } from "@/features/auth/signInFrom"
import { SignInStart } from "@/features/auth/SignInStart"
import { paths } from "@/routes/paths"

export const SignInPage = () => {
	const navigate = useNavigate()
	const location = useLocation()
	const from = readSignInFrom(location.state)
	const providers = useAuthProviders()
	const [email, setEmail] = useState("")
	// "sent" once a sign-in email went out; the edition's steps take it from there.
	const [step, setStep] = useState<"start" | "sent">("start")

	// Replace, so Back from where sign-in lands never returns to the form (mobile Activity has a Back).
	const land = () => void navigate(from?.to ?? paths.library, { replace: true })

	if (providers.isPending)
		return (
			<AuthCard title="Sign in to Exagram" hideTitle>
				Loading sign-in options…
			</AuthCard>
		)

	const EmailSignIn = edition.emailSignIn
	if (step === "sent" && EmailSignIn !== null)
		return (
			<EmailSignIn.Steps email={email} returnTo={from?.file?.path} onSignedIn={land} onBack={() => setStep("start")} />
		)

	return (
		<SignInStart email={email} onEmailChange={setEmail} from={from} onSent={() => setStep("sent")} onSignedIn={land} />
	)
}
