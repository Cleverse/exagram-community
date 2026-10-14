import {
	type Access,
	type Grant,
	type Grantee,
	type GrantRole,
	type PublishPolicy,
	type VisibleArtifact,
	type WorkspaceKind,
} from "@exagram/api-client"

import { edition } from "@/edition/edition"
import { useRevisions } from "@/features/artifact/hooks/useRevisions"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSetGeneralAccess } from "@/features/grants/general-access/useSetGeneralAccess"
import {
	type InviteInput,
	useDefaultShareRole,
	useGrantMutations,
	useGrants,
	useArtifactAccess,
	useProjectAccess,
	useProjectGrantMutations,
	useProjectGrants,
} from "@/features/grants/hooks/useGrants"
import { useAnyoneSettings } from "@/features/grants/useAnyoneSettings"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useProjects } from "@/features/library/hooks/useProjects"
import { useSetProjectLinkPreview } from "@/features/project/hooks/useProjectMutations"
import { useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"

/**
 * What Share knows and does, apart from how it is drawn: the desktop Share dialog and the mobile Share and
 * Role drawers read the same grants, hand out the same roles and copy the same link.
 */

const ROLE_LABEL: Record<GrantRole, string> = { view: "Viewer", collaborate: "Collaborator", edit: "Editor" }

export const roleLabel = (role: GrantRole) => ROLE_LABEL[role]

const ROLE_HELP: Record<GrantRole, string> = {
	view: "Can open and read only.",
	collaborate: "Can read and upload new revisions, which wait for approval.",
	edit: "Can edit in place and, when the folder allows it, approve pending uploads.",
}

export const roleHelp = (kind: WorkspaceKind, role: GrantRole) =>
	kind === "personal" && role === "edit" ? "Can edit in place." : ROLE_HELP[role]

const SHARE_ROLES = {
	team: ["view", "collaborate", "edit"],
	personal: ["view", "edit"],
} as const satisfies Record<WorkspaceKind, readonly GrantRole[]>

export const rolesFor = (kind: WorkspaceKind): readonly GrantRole[] => SHARE_ROLES[kind]

export const newPersonCopy = (kind: WorkspaceKind, workspaceName: string) =>
	kind === "personal"
		? {
				badge: "By email",
				heading: "Share by email",
				row: "Send them the link after sharing",
			}
		: {
				badge: edition.copy.newTo(workspaceName),
				heading: edition.copy.notInYet(workspaceName),
				row: edition.copy.notInYetSendLink(workspaceName),
			}

const PLACEHOLDER = {
	team: { dialog: "Search people or enter an email", sheet: "Name or email" },
	personal: { dialog: "Enter an email address", sheet: "Email address" },
} as const satisfies Record<WorkspaceKind, Record<"dialog" | "sheet", string>>

export const invitePlaceholder = (kind: WorkspaceKind, surface: "dialog" | "sheet", chips: number): string =>
	chips > 0 ? (surface === "dialog" ? "Add more" : "") : PLACEHOLDER[kind][surface]

export const emptyChecklistNote = (kind: WorkspaceKind, typed: string): string =>
	kind === "personal"
		? "Type an email address to share with someone."
		: typed
			? `No one matches “${typed}”. Type their full email to invite someone new.`
			: "Everyone already has access."

const RANK = SHARE_ROLES.team

export const rolesUpTo = (ceiling: GrantRole | null, kind: WorkspaceKind): GrantRole[] =>
	ceiling === null ? [] : rolesFor(kind).filter((role) => RANK.indexOf(role) <= RANK.indexOf(ceiling))

/** Viewer until the Team's default is known, so a share never starts wider than the Team set. */
export const startingRole = (
	kind: WorkspaceKind,
	teamDefault: GrantRole | undefined,
	options: readonly GrantRole[],
): GrantRole => {
	const wanted = kind === "team" && teamDefault !== undefined ? teamDefault : "view"
	const strongest = (a: GrantRole, b: GrantRole) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b)
	return options.filter((role) => RANK.indexOf(role) <= RANK.indexOf(wanted)).reduce(strongest, "view")
}

export const shownRole = (kind: WorkspaceKind, role: GrantRole): GrantRole =>
	kind === "personal" && role === "collaborate" ? "edit" : role

const ACCESS_LINE: Record<Exclude<Access, "owner">, string> = {
	edit: "You can view, download and edit this.",
	collaborate: "You can view, download and propose changes to this.",
	view: "You can view and download this.",
}

export const noInviteNote = (
	access: Exclude<Access, "owner"> | null,
	standing: { kind: WorkspaceKind; member: boolean },
	canDownload = true,
): string => {
	const ask =
		standing.member && standing.kind === "team"
			? "Ask a Collaborator or the Owner to invite someone."
			: "Ask the Owner to invite someone."
	if (access === null) return `You can't add people here. ${ask}`
	return `${access === "view" && !canDownload ? "You can view this." : ACCESS_LINE[access]} ${ask}`
}

/** The strongest role this access may hand out: an Owner or Editor up to Editor, a Collaborator up to Collaborator. */
export const ceilingFor = (access: Access | null): GrantRole | null =>
	access === "owner" || access === "edit" ? "edit" : access === "collaborate" ? "collaborate" : null

/** The role choices a Workspace of this kind offers, for a select. */
export const roleOptions = (kind: WorkspaceKind) =>
	rolesFor(kind).map((role) => ({ value: role, label: roleLabel(role) }))

export const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0])
		.join("")
		.toUpperCase() || "?"

type GroupGrant = Grant & { grantee: Extract<Grantee, { kind: "group" }> }

export const isGroupGrant = (grant: Grant): grant is GroupGrant => grant.grantee.kind === "group"

export const splitGrants = (rows: Grant[]) => {
	const people = rows.filter((grant) => !isGroupGrant(grant))
	return {
		groups: rows.filter(isGroupGrant),
		members: people.filter((grant) => !grant.granteePending),
		invited: people.filter((grant) => grant.granteePending),
	}
}

/** An Invited row's line under the email: they get in by signing in, and the sharer sends the link. */
export const INVITED_META = "Not opened yet"

export const peopleCountLabel = (count: number) => (count === 1 ? "1 person" : `${count} people`)

const groupCountLabel = (count: number) => (count === 1 ? "1 group" : `${count} groups`)

export const whoLabel = (people: number, groups: number) =>
	[people > 0 ? peopleCountLabel(people) : null, groups > 0 ? groupCountLabel(groups) : null]
		.filter((part) => part !== null)
		.join(" and ")

export const groupLine = (memberCount: number, role?: GrantRole) =>
	[
		"Group",
		memberCount === 1 ? "1 member" : `${memberCount} members`,
		...(role === undefined ? [] : [roleLabel(role)]),
	].join(" · ")

/** Copies a Share link. An Artifact passes `copiedMessage` to say who the link opens for (`generalAccessCopied`). */
export const copyShareLink = (url: string, toast: (message: string) => void, copiedMessage = "Link copied") =>
	navigator.clipboard.writeText(url).then(
		() => toast(copiedMessage),
		() => toast("Could not copy — select the URL and copy it"),
	)

/** Sharing one Artifact: who has access, what the caller may change, and the file's publishing. */
export const useArtifactShareModel = (artifact: VisibleArtifact) => {
	const me = useMe()
	const access = useArtifactAccess(artifact.id)
	const isOwner = access.data === "owner"
	const ceiling = ceilingFor(access.data ?? null)
	const grants = useGrants(artifact.id, ceiling !== null)
	const revisions = useRevisions(artifact.id, isOwner)
	const projects = useProjects()
	const mutations = useGrantMutations(artifact.id)
	const workspace = useWorkspaceOf(artifact.workspaceId)
	const anyone = useAnyoneSettings(artifact)
	// Held here, not in the section, so a change in flight keeps its toast and error across share steps.
	const generalAccess = useSetGeneralAccess(artifact.id)
	const defaultRole = useDefaultShareRole(artifact.workspaceId)

	const rows = grants.data ?? []
	const { groups, members, invited } = splitGrants(rows)
	// A Viewer never asks for the grant list; the names already on the Artifact are what they may see.
	const viewerNames = ceiling === null ? artifact.sharedWithNames : []
	const direct =
		ceiling === null
			? { people: viewerNames.length, groups: 0 }
			: { people: members.length + invited.length, groups: groups.length }
	const guests = direct.people + direct.groups
	const note =
		guests === 0
			? "No direct invites on this file. Access through a shared folder may also apply."
			: `${whoLabel(direct.people, direct.groups)} ${guests === 1 ? "has" : "have"} direct access to this file.`
	const seqOf = new Map((revisions.data ?? []).map((revision) => [revision.id, revision.seq]))
	// Pins are the Owner's business: the server strips them for everyone else, and so does the meta.
	const metaOf = (grant: Grant) => {
		// Only people who have signed in reach this list; the Invited section has its own line (INVITED_META).
		const who = grant.granteeEmail
		if (!isOwner) return who
		if (grant.pinnedRevisionId === null) return `${who} · Latest`
		const seq = seqOf.get(grant.pinnedRevisionId)
		return `${who} · ${seq === undefined ? "Pinned" : `Pinned v${seq}`}`
	}
	const projectPolicy: PublishPolicy =
		artifact.publishPolicy === null
			? artifact.effectivePublishPolicy
			: ((projects.data ?? []).find((project) => project.id === artifact.projectId)?.publishPolicy ?? "auto")

	// The Owner's pin select in the Invite view starts at what the Default Pin would give.
	const defaultPinnedRevisionId = isOwner
		? artifact.defaultPin === "current"
			? (artifact.visibleRevisionId ?? null)
			: null
		: undefined

	return {
		me,
		isOwner,
		ceiling,
		workspace,
		noInvite: artifact.access === "owner" ? null : noInviteNote(artifact.access, workspace, artifact.canDownload),
		accessPending: access.isPending,
		grants,
		revisions,
		mutations,
		/** The Owner's Link settings for Anyone with the link; null for everyone else. */
		anyone,
		generalAccess,
		rows,
		groups,
		members,
		invited,
		defaultPinnedRevisionId,
		defaultRole,
		/** For `useInvitePicker`: one Grant, resolving to what the server made. */
		create: (input: Parameters<typeof mutations.invite.mutateAsync>[0]) => mutations.invite.mutateAsync(input),
		viewerNames,
		note,
		metaOf,
		projectPolicy,
		url: `${window.location.origin}/artifacts/${artifact.id}`,
	}
}

/** Sharing a Project: the server says what the caller may do, so nothing reads as Owner until it has. */
export const useProjectShareModel = (projectId: string) => {
	const me = useMe()
	const access = useProjectAccess(projectId)
	const ceiling = ceilingFor(access.data ?? null)
	const grants = useProjectGrants(projectId, ceiling !== null)
	const mutations = useProjectGrantMutations(projectId)
	const artifacts = useArtifacts({ scope: "all", projectId })
	const projects = useProjects()
	const setLinkPreview = useSetProjectLinkPreview()
	const project = (projects.data ?? []).find((candidate) => candidate.id === projectId)
	const workspace = useWorkspaceOf(project?.workspaceId)
	const defaultRole = useDefaultShareRole(project?.workspaceId)

	const rows = grants.data ?? []
	const { groups, members, invited } = splitGrants(rows)

	return {
		me,
		access,
		ceiling,
		workspace,
		noInvite: access.data === "owner" ? null : noInviteNote(access.data ?? null, workspace),
		grants,
		mutations,
		rows,
		groups,
		members,
		invited,
		defaultRole,
		// A Project Grant carries no pin, so whatever pin the picker holds is left behind.
		create: (input: InviteInput) =>
			mutations.invite.mutateAsync(
				"groupId" in input
					? { groupId: input.groupId, role: input.role }
					: { granteeEmail: input.granteeEmail, role: input.role },
			),
		fileCount: artifacts.data?.length ?? 0,
		isOwner: access.data === "owner",
		project,
		setLinkPreview,
		url: `${window.location.origin}/projects/${projectId}`,
	}
}
