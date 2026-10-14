import { providerStartUrl } from "@/features/auth/providerStart"
import { AppleMark, SocialLink } from "@/features/auth/SocialLink"

export type AppleButtonProps = {
	choice?: { join: string } | "create"
	/** A file path to land on after sign-in, as for Google. */
	returnTo?: string
	label?: string
}

export const AppleButton = ({ label = "Continue with Apple", ...props }: AppleButtonProps) => (
	<SocialLink href={providerStartUrl("apple", props)} icon={<AppleMark />}>
		{label}
	</SocialLink>
)
