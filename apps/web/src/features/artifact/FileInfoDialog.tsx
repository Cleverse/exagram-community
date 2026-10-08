import { type VisibleArtifact } from "@exagram/api-client"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { useConnections } from "@/features/connections/hooks/useConnections"
import { generalAccessDetails } from "@/features/grants/general-access/generalAccess"

const Field = ({ label, value }: { label: string; value: string }) => (
	<>
		<div style={{ color: "var(--color-muted)" }}>{label}</div>
		<div>{value}</div>
	</>
)

/** The reading view's "File info": the same five rows the preview pane shows in its popover. */
export const FileInfoDialog = ({
	artifact,
	projectName,
	onClose,
}: {
	artifact: VisibleArtifact
	projectName: string | null
	onClose: () => void
}) => {
	const connections = useConnections()
	const clients = (connections.data ?? []).filter((connection) => connection.revokedAt === null)
	const rev = artifact.revisionSeq === null ? "—" : `v${artifact.revisionSeq}`

	return (
		<Dialog
			title="File info"
			onClose={onClose}
			width={440}
			footer={
				<Button variant="primary" size={40} onClick={onClose}>
					Done
				</Button>
			}
		>
			<div className="grid" style={{ gridTemplateColumns: "auto 1fr", gap: "10px 16px", fontSize: 14 }}>
				{artifact.sourceFilename ? <Field label="Original filename" value={artifact.sourceFilename} /> : null}
				{artifact.sourceDescription ? <Field label="Description" value={artifact.sourceDescription} /> : null}
				<Field label="Project" value={projectName ?? "No project"} />
				<Field label="Owner" value={artifact.ownerName} />
				<Field
					label="Shared with"
					value={
						generalAccessDetails(artifact) ??
						(artifact.sharedWithNames.length > 0 ? `${artifact.sharedWithNames.length + 1} people` : "Only you")
					}
				/>
				<Field
					label="Clients"
					value={clients.length > 0 ? clients.map((connection) => connection.name).join(", ") : "None"}
				/>
				<Field label="Revision" value={`${rev} · current`} />
			</div>
		</Dialog>
	)
}
