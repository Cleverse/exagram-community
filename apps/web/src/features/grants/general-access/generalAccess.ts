import { type GeneralAccess, type VisibleArtifact, type WorkspaceKind } from "@exagram/api-client"

import { IconGlobe, IconLock, IconPeople } from "@/components/ui/icons"
import { edition } from "@/edition/edition"

type Workspace = Pick<VisibleArtifact, "workspaceName" | "orgDomain">
type Scope = Workspace & Pick<VisibleArtifact, "generalAccess">
/** Only the Owner is told the password, so a reader with `anyoneSettings: null` is never told it is off. */
type Reach = Scope & Pick<VisibleArtifact, "anyoneSettings">

/** One General Access choice, with the copy and glyph every surface draws it with. */
export type GeneralAccessOption = {
	value: GeneralAccess
	Icon: typeof IconLock
	/** The choice's name: the menu row, the trigger, and what a non-Owner reads. */
	label: (workspace: Workspace) => string
	/** What the choice lets in, under the trigger. */
	description: (reach: Reach) => string
	/** The toast after Copy link, saying who the link opens for. */
	copied: (reach: Reach) => string
	/** The toast after the Owner picks it. */
	chosen: (workspace: Workspace) => string
	/** File info's "Shared with" when the file is open beyond its Grants; null means list the grantees. */
	details: (workspace: Workspace) => string | null
}

/**
 * The `org` choice's sentences name the Workspace, so the edition supplies them. An edition that does not offer `org`
 * still supplies words for an Artifact that holds it.
 */
export type OrgAccessCopy = Pick<GeneralAccessOption, "label" | "description" | "copied" | "chosen" | "details"> & {
	/** Under the trigger while the choice waits for an Allowed Domain. */
	needsDomain: (workspaceName: string) => string
}

const GENERAL_ACCESS: Record<GeneralAccess, GeneralAccessOption> = {
	restricted: {
		value: "restricted",
		Icon: IconLock,
		label: () => "Only people invited",
		description: () => "Only invited people can open it",
		copied: () => "Link copied — only invited people can open it.",
		chosen: () => "Only invited people can open it now.",
		details: () => null,
	},
	org: {
		value: "org",
		Icon: IconPeople,
		label: (workspace) => edition.copy.generalAccessOrg.label(workspace),
		description: (reach) => edition.copy.generalAccessOrg.description(reach),
		copied: (reach) => edition.copy.generalAccessOrg.copied(reach),
		chosen: (workspace) => edition.copy.generalAccessOrg.chosen(workspace),
		details: (workspace) => edition.copy.generalAccessOrg.details(workspace),
	},
	anyone: {
		value: "anyone",
		Icon: IconGlobe,
		label: () => "Anyone with the link",
		description: ({ anyoneSettings }) =>
			anyoneSettings === null
				? "Anyone with the link can view"
				: anyoneSettings.passwordOn
					? "Anyone with the link and password can view"
					: "Anyone on the internet with the link can view",
		copied: ({ anyoneSettings }) =>
			anyoneSettings === null
				? "Link copied"
				: anyoneSettings.passwordOn
					? "Link copied. Send the password separately."
					: "Link copied — anyone with it can open.",
		chosen: () => "Anyone with the link can now view.",
		details: () => "Anyone with the link",
	},
}

const GENERAL_ACCESS_BY_KIND: Record<WorkspaceKind, readonly GeneralAccess[]> = {
	team: ["restricted", "org", "anyone"],
	personal: ["restricted", "anyone"],
}

/** The choices the Owner is offered; `offerOrg` is the edition's `generalAccessOrg`. */
export const generalAccessOptionsFor = (kind: WorkspaceKind, offerOrg: boolean): GeneralAccessOption[] =>
	GENERAL_ACCESS_BY_KIND[kind].filter((value) => offerOrg || value !== "org").map((value) => GENERAL_ACCESS[value])

export const needsAllowedDomain = (
	kind: WorkspaceKind,
	artifact: Pick<Scope, "orgDomain" | "generalAccess">,
	offerOrg: boolean,
) => offerOrg && kind === "team" && !artifact.orgDomain && artifact.generalAccess === "restricted"

export const generalAccessOption = (artifact: Pick<Scope, "generalAccess">): GeneralAccessOption =>
	GENERAL_ACCESS[artifact.generalAccess]

export const generalAccessLabel = (artifact: Scope) => generalAccessOption(artifact).label(artifact)

export const generalAccessDescription = (artifact: Reach) => generalAccessOption(artifact).description(artifact)

export const generalAccessDetails = (artifact: Scope) => generalAccessOption(artifact).details(artifact)

export const generalAccessCopied = (artifact: Reach) => generalAccessOption(artifact).copied(artifact)

export const generalAccessChosen = (generalAccess: GeneralAccess, workspace: Workspace) =>
	GENERAL_ACCESS[generalAccess].chosen(workspace)
