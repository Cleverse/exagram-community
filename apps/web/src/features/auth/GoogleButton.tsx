import { authOutlineDisabledClass } from "@/features/auth/AuthCard"
import { providerStartUrl, type ProviderStartProps } from "@/features/auth/providerStart"
import { GoogleMark, SocialLink } from "@/features/auth/SocialLink"

export type GoogleButtonProps = ProviderStartProps & {
	disabled?: boolean
	disabledReason?: string
	label?: string
}

export const GoogleButton = ({
	disabled = false,
	disabledReason,
	label = "Continue with Google",
	...props
}: GoogleButtonProps) => (
	<div>
		{disabled ? (
			<div className={authOutlineDisabledClass} aria-disabled="true">
				<GoogleMark />
				{label}
			</div>
		) : (
			<SocialLink href={providerStartUrl("google", props)} icon={<GoogleMark />}>
				{label}
			</SocialLink>
		)}
		{disabledReason ? <p className="mt-2 text-center text-[13px] text-muted">{disabledReason}</p> : null}
	</div>
)
