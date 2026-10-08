import { type FindingType } from "@exagram/api-client"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"

export const ConfirmPlaceholdersDialog = ({
	types,
	onConfirm,
	onCancel,
}: {
	types: FindingType[]
	onConfirm: () => void
	onCancel: () => void
}) => (
	<Dialog
		title="Confirm placeholders"
		ariaLabel="Confirm placeholders"
		onClose={onCancel}
		helper="This second step is required for a Connection-authored Revision."
		footer={
			<>
				<Button variant="outline" size={40} onClick={onCancel}>
					Cancel
				</Button>
				<Button variant="approve" size={40} onClick={onConfirm}>
					Approve anyway
				</Button>
			</>
		}
	>
		<div className="flex flex-col gap-4 text-[15px] leading-[1.6] text-secondary">
			<p className="m-0">This Revision contains values that will be replaced for a Connection. The placeholders are:</p>
			{types.length > 0 ? (
				<ul className="m-0 list-disc pl-6">
					{types.map((type) => (
						<li key={type}>
							<code>[{type}]</code>
						</li>
					))}
				</ul>
			) : (
				<p className="m-0">The placeholder list is out of date, but the API found sensitive values in this Revision.</p>
			)}
			<p className="m-0">
				If you approve, the placeholders will become the content in place of the real values. Approve only if that is
				intended.
			</p>
		</div>
	</Dialog>
)
