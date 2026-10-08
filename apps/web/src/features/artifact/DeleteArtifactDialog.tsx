import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"

/** "Delete this file…": a soft delete, but recovery currently needs engineering access, so this confirms first. */
export const DeleteArtifactDialog = ({
	title,
	onConfirm,
	onClose,
}: {
	title: string
	onConfirm: () => void
	onClose: () => void
}) => (
	<Dialog
		title="Delete this file"
		onClose={onClose}
		width={480}
		bodyGap={12}
		footer={
			<>
				<Button variant="outline" size={40} onClick={onClose}>
					Cancel
				</Button>
				<Button variant="danger" size={40} onClick={onConfirm}>
					Delete
				</Button>
			</>
		}
	>
		<div className="truncate" style={{ fontSize: 14, color: "var(--color-muted)" }}>
			{title}
		</div>
		<p style={{ fontSize: 14, color: "var(--color-ink)" }}>
			The bytes are kept, but recovery currently needs engineering access.
		</p>
	</Dialog>
)
