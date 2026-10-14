import { type PublishPolicy } from "@exagram/api-client"

/** The header chip wording for a Project's publish policy. */
const CHIP: Record<PublishPolicy, string> = {
	auto: "Publishes automatically",
	manual: "Manual approval only",
}

export const publishPolicyLabel = (policy: PublishPolicy): string => CHIP[policy]

/** The two choices as the settings dialog and the Share modal offer them. */
export const PUBLISH_POLICY_OPTIONS: { value: PublishPolicy; label: string; description: string }[] = [
	{
		value: "auto",
		label: "Publish automatically",
		description:
			"Owner and Editor uploads, including from their AI tools, go live right away; Collaborator uploads wait for approval.",
	},
	{
		value: "manual",
		label: "Manual approval only",
		description: "Every new version waits until the Owner publishes it.",
	},
]
