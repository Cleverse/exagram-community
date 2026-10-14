import { type Grant, type GrantRole, type WorkspaceKind } from "@exagram/api-client"
import clsx from "clsx"

import { SheetSeparator } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { useToast } from "@/components/Toast"
import { IconCheck } from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import {
	useGrantMutations,
	useGrants,
	useProjectGrantMutations,
	useProjectGrants,
} from "@/features/grants/hooks/useGrants"
import { copyInviteLink } from "@/features/grants/sheets/inviteLink"
import { groupLine, INVITED_META, roleHelp, roleLabel, rolesFor, shownRole } from "@/features/grants/useShareModel"

type RoleMutations = {
	setRole: ReturnType<typeof useGrantMutations>["setRole"]
	remove: ReturnType<typeof useGrantMutations>["remove"]
}

const actionStyle = { height: 48, padding: "0 10px", fontSize: 15 } as const

/**
 * One person's access: the three roles with what each may do, the current one checked, then
 * Remove access. A change saves at once and steps back to Share, which shows the new role. Someone invited who
 * has not signed in yet also gets Copy link, since Exagram emails no one, and removing them cancels
 * the invite.
 */
const RoleBody = ({
	grant,
	kind,
	mutations,
	url,
}: {
	grant: Grant
	kind: WorkspaceKind
	mutations: RoleMutations
	url: string
}) => {
	const sheet = useSheet()
	const toast = useToast()
	const invited = grant.granteePending
	const copyable = edition.useInviteLinkCopyable()
	const busy = mutations.setRole.isPending || mutations.remove.isPending
	const shown = shownRole(kind, grant.role)

	const pick = (role: GrantRole) => {
		if (busy) return
		if (role === shown) {
			sheet.back()
			return
		}
		mutations.setRole.mutate(
			{ grantId: grant.id, role },
			{
				onSuccess: () => {
					toast(`${grant.granteeName} is now ${roleLabel(role)}`)
					sheet.back()
				},
			},
		)
	}

	const remove = () => {
		if (busy) return
		mutations.remove.mutate(
			{ grantId: grant.id },
			{
				onSuccess: () => {
					toast(invited ? "Invite cancelled" : "Access removed")
					sheet.back()
				},
			},
		)
	}

	return (
		<Sheet
			title={grant.granteeName}
			sub={
				invited
					? INVITED_META
					: grant.grantee.kind === "group"
						? groupLine(grant.grantee.memberCount)
						: "Choose what they can do"
			}
		>
			<div role="radiogroup" aria-label={`Access for ${grant.granteeName}`} style={{ padding: "0 6px 8px" }}>
				{rolesFor(kind).map((role) => {
					const on = role === shown
					return (
						<button
							key={role}
							type="button"
							role="radio"
							aria-checked={on}
							disabled={busy}
							onClick={() => pick(role)}
							className={clsx(
								"flex w-full items-start text-left disabled:opacity-60",
								on ? "bg-row-selected" : "active:bg-hover",
							)}
							style={{ gap: 12, padding: "12px 10px" }}
						>
							<span className="flex-1">
								<span className="block" style={{ fontSize: 15, fontWeight: 500 }}>
									{roleLabel(role)}
								</span>
								<span className="block text-muted" style={{ fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>
									{roleHelp(kind, role)}
								</span>
							</span>
							{on ? <IconCheck size={17} className="flex-none text-ink" /> : null}
						</button>
					)
				})}
				<SheetSeparator />
				{invited && copyable ? (
					<button
						type="button"
						disabled={busy}
						onClick={() => void copyInviteLink(url, grant.granteeEmail, toast)}
						className="w-full text-left text-ink active:bg-hover disabled:opacity-60"
						style={actionStyle}
					>
						Copy link
					</button>
				) : null}
				<button
					type="button"
					disabled={busy}
					onClick={remove}
					className="w-full text-left text-danger active:bg-danger-bg disabled:opacity-60"
					style={actionStyle}
				>
					{invited ? "Cancel invite" : "Remove access"}
				</button>
			</div>
		</Sheet>
	)
}

const RoleOrNote = ({
	grants,
	granteeKey,
	kind,
	mutations,
	url,
}: {
	grants: { isPending: boolean; isError: boolean; data: Grant[] | undefined }
	granteeKey: string
	kind: WorkspaceKind
	mutations: RoleMutations
	/** What Copy link copies (with `?invited=1`) for someone invited who has not signed in yet. */
	url: string
}) => {
	if (grants.isPending) return <SheetLoading title="Access" />
	const grant = (grants.data ?? []).find((candidate) => candidate.id === granteeKey)
	if (!grant) {
		return (
			<Sheet title="Access">
				<SheetNote role={grants.isError ? "alert" : undefined}>
					{grants.isError ? "Could not load who has access." : "They no longer have access here."}
				</SheetNote>
			</Sheet>
		)
	}
	return <RoleBody grant={grant} kind={kind} mutations={mutations} url={url} />
}

const ArtifactRole = ({
	artifactId,
	granteeKey,
	kind,
}: {
	artifactId: string
	granteeKey: string
	kind: WorkspaceKind
}) => {
	const grants = useGrants(artifactId)
	const mutations = useGrantMutations(artifactId)
	return (
		<RoleOrNote
			grants={grants}
			granteeKey={granteeKey}
			kind={kind}
			mutations={mutations}
			url={`${window.location.origin}/artifacts/${artifactId}`}
		/>
	)
}

const ProjectRole = ({
	projectId,
	granteeKey,
	kind,
}: {
	projectId: string
	granteeKey: string
	kind: WorkspaceKind
}) => {
	const grants = useProjectGrants(projectId)
	const mutations = useProjectGrantMutations(projectId)
	return (
		<RoleOrNote
			grants={grants}
			granteeKey={granteeKey}
			kind={kind}
			mutations={mutations}
			url={`${window.location.origin}/projects/${projectId}`}
		/>
	)
}

/** Only the Owner reaches this drawer: Share offers a role button to no one else, as desktop offers no select. */
const RoleSheet = ({ params }: { params: SheetParams["role"] }) =>
	params.target.kind === "artifact" ? (
		<ArtifactRole artifactId={params.target.id} granteeKey={params.granteeKey} kind={params.kind} />
	) : (
		<ProjectRole projectId={params.target.id} granteeKey={params.granteeKey} kind={params.kind} />
	)

export default RoleSheet
