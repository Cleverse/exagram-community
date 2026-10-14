import { type AccessRequest, type GrantRole, type WorkspaceKind } from "@exagram/api-client"
import { useState } from "react"
import { Link } from "react-router"

import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { SectionLabel } from "@/components/ui/Mono"
import { useAccessRequestMutations, useAccessRequests } from "@/features/access-requests/hooks/useAccessRequests"
import { artifactLinkTarget } from "@/features/artifact/openArtifact"
import { RoleSelect } from "@/features/grants/ShareDialog"
import { roleLabel, rolesFor } from "@/features/grants/useShareModel"
import { useLoadedWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths } from "@/routes/paths"

/** A request grants Viewer unless the Owner picks more. */
export const DEFAULT_REQUEST_ROLE: GrantRole = "view"

const Row = ({
	request,
	kind,
	busy,
	mobile,
	onGrant,
	onDismiss,
}: {
	request: AccessRequest
	kind: WorkspaceKind
	busy: boolean
	mobile: boolean
	onGrant: (role: GrantRole) => void
	onDismiss: () => void
}) => {
	const [role, setRole] = useState<GrantRole>(DEFAULT_REQUEST_ROLE)
	return (
		<li
			className={mobile ? "flex flex-col" : "flex items-center"}
			style={
				mobile
					? { padding: "14px 0 12px", gap: 10 }
					: { gap: 12, minHeight: 52, padding: "8px 8px 8px 12px", borderBottom: "1px solid var(--color-row-line)" }
			}
		>
			<div className="min-w-0 flex-1">
				<div className="text-secondary-2" style={{ fontSize: 14, lineHeight: 1.4 }}>
					<span className="text-ink" style={{ fontWeight: 600 }}>
						{request.requesterName}
					</span>{" "}
					{`(${request.requesterEmail}) asked for access to `}
					<Link
						to={paths.artifact(request.artifactId)}
						target={artifactLinkTarget()}
						className="text-ink hover:text-link-hover"
						style={{ fontWeight: 500 }}
					>
						{request.artifactTitle}
					</Link>
				</div>
				{request.note ? (
					<blockquote
						className="m-0 text-muted"
						style={{ fontSize: 13, marginTop: 4, paddingLeft: 8, borderLeft: "2px solid var(--color-line-strong)" }}
					>
						{request.note}
					</blockquote>
				) : null}
			</div>
			<div className="flex flex-none items-center" style={{ gap: 6 }}>
				<RoleSelect
					label={`Role for ${request.requesterName}`}
					value={role}
					options={rolesFor(kind)}
					onChange={setRole}
					fontSize={mobile ? 14 : 13}
				/>
				<Button variant="quiet" size={30} disabled={busy} onClick={onDismiss}>
					Dismiss
				</Button>
				<Button variant="approve" size={30} disabled={busy} onClick={() => onGrant(role)}>
					Grant
				</Button>
			</div>
		</li>
	)
}

/** Presentation only, so the wording and the actions are testable without a server. */
export const AccessRequestsView = ({
	requests,
	kind,
	busy,
	mobile = false,
	onGrant,
	onDismiss,
}: {
	requests: AccessRequest[]
	kind: WorkspaceKind
	busy: boolean
	/** The phone's Activity draws it as an amber card, as its Needs your action. */
	mobile?: boolean
	onGrant: (request: AccessRequest, role: GrantRole) => void
	onDismiss: (request: AccessRequest) => void
}) => {
	if (requests.length === 0) return null
	const rows = (
		<ul className="m-0 list-none p-0">
			{requests.map((request) => (
				<Row
					key={request.id}
					request={request}
					kind={kind}
					busy={busy}
					mobile={mobile}
					onGrant={(role) => onGrant(request, role)}
					onDismiss={() => onDismiss(request)}
				/>
			))}
		</ul>
	)

	if (mobile)
		return (
			<section
				aria-label="Access requests"
				className="bg-pending-bg"
				style={{ margin: "6px 12px", borderRadius: 10, padding: "14px 14px 4px" }}
			>
				<div className="flex items-center text-pending-fg" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
					<span aria-hidden className="bg-pending" style={{ width: 7, height: 7, borderRadius: "50%" }} />
					<h2 className="m-0 flex-1" style={{ fontSize: 13, fontWeight: 600 }}>
						Access requests
					</h2>
					<span
						className="font-mono"
						style={{ fontSize: 11, background: "rgba(217,134,11,.35)", padding: "2px 7px", borderRadius: 6 }}
					>
						{requests.length}
					</span>
				</div>
				{rows}
			</section>
		)

	return (
		<section aria-label="Access requests">
			<div className="flex items-baseline" style={{ gap: 8, padding: "20px 8px 4px" }}>
				<SectionLabel as="h2" className="text-ink" style={{ margin: 0 }}>
					Access requests
				</SectionLabel>
				<span className="font-mono text-muted" style={{ fontSize: 11 }}>
					{requests.length}
				</span>
			</div>
			{rows}
		</section>
	)
}

/** Open requests on files the reader owns, each granted at the role the Owner picks or dismissed. */
export const AccessRequests = ({ mobile = false }: { mobile?: boolean }) => {
	const requests = useAccessRequests()
	const { grant, dismiss } = useAccessRequestMutations()
	const toast = useToast()
	const kind = useLoadedWorkspaceKind()

	return (
		<AccessRequestsView
			requests={requests.data ?? []}
			kind={kind}
			busy={grant.isPending || dismiss.isPending}
			mobile={mobile}
			onGrant={(request, role) =>
				grant.mutate(
					{ id: request.id, artifactId: request.artifactId, role },
					{
						onSuccess: () =>
							toast(`${request.requesterName} can now open ${request.artifactTitle} as ${roleLabel(role)}.`),
						onError: (error) => toast(error.message),
					},
				)
			}
			onDismiss={(request) => dismiss.mutate({ id: request.id }, { onError: (error) => toast(error.message) })}
		/>
	)
}
