import { type VisibleArtifact } from "@exagram/api-client"

import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { useRevisions } from "@/features/artifact/hooks/useRevisions"
import { formatSheetDate } from "@/features/artifact/reading/format"
import { useProjectName, useSheetArtifact } from "@/features/artifact/sheets/sheetData"
import { SheetGone, SheetLoading } from "@/features/artifact/sheets/sheetParts"
import { useConnections } from "@/features/connections/hooks/useConnections"
import { generalAccessDetails } from "@/features/grants/general-access/generalAccess"
import { formatBytes } from "@/utils/format"

const DetailsList = ({ artifact }: { artifact: VisibleArtifact }) => {
	const projectName = useProjectName(artifact.projectId)
	const connections = useConnections()
	const clients = (connections.data ?? []).filter((connection) => connection.revokedAt === null)
	const rev = artifact.revisionSeq === null ? "—" : `v${artifact.revisionSeq}`
	// The size lives on the Revision, which only the Owner may list; anyone else sees no Size row.
	const isOwner = artifact.access === "owner"
	const revisions = useRevisions(artifact.id, isOwner)
	const visible = isOwner
		? (revisions.data ?? []).find((revision) => revision.id === artifact.visibleRevisionId)
		: undefined

	const rows: [string, string][] = [
		...(artifact.sourceFilename ? [["Original filename", artifact.sourceFilename] as [string, string]] : []),
		...(artifact.sourceDescription ? [["Description", artifact.sourceDescription] as [string, string]] : []),
		["Project", projectName ?? "No project"],
		["Owner", artifact.ownerName],
		[
			"Shared with",
			generalAccessDetails(artifact) ??
				(artifact.sharedWithNames.length > 0 ? artifact.sharedWithNames.join(", ") : "No one else"),
		],
		["Revision", `${rev} · current`],
		...(visible ? [["Size", formatBytes(visible.bytes)] as [string, string]] : []),
		["Updated", formatSheetDate(artifact.updatedAt)],
		["Clients", clients.length > 0 ? clients.map((connection) => connection.name).join(", ") : "None"],
	]

	return (
		<Sheet title="Details" sub={artifact.title}>
			<dl style={{ padding: "0 16px 12px" }}>
				{rows.map(([label, value]) => (
					<div key={label} className="flex items-baseline" style={{ gap: 16, padding: "11px 0" }}>
						<dt className="flex-none text-muted-2" style={{ width: 104, fontSize: 13 }}>
							{label}
						</dt>
						<dd className="min-w-0 flex-1 break-words" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
							{value}
						</dd>
					</div>
				))}
			</dl>
		</Sheet>
	)
}

/**
 * Details (W:L698–707): label/value rows, the same facts as desktop's File info: original filename and
 * description where the upload had them, Project, Owner, who it is shared with, revision, size (Owner only),
 * last update and the connected clients.
 */
const DetailsSheet = ({ params }: { params: SheetParams["details"] }) => {
	const { artifact, loading } = useSheetArtifact(params.artifactId)
	if (loading) return <SheetLoading title="Details" />
	if (!artifact) return <SheetGone />
	return <DetailsList artifact={artifact} />
}

export default DetailsSheet
