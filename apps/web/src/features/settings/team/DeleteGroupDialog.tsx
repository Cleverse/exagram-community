import { type Group } from "@exagram/api-client"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { useDeleteGroup } from "@/features/settings/team/hooks/useGroups"
import { DELETE_GROUP_BODY } from "@/features/settings/team/teamCopy"

export const DeleteGroupDialog = ({ group, onClose }: { group: Group; onClose: () => void }) => {
	const remove = useDeleteGroup()

	return (
		<Dialog
			title={`Delete ${group.name}?`}
			onClose={onClose}
			width={480}
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="danger"
						size={40}
						disabled={remove.isPending}
						onClick={() => remove.mutate({ id: group.id, name: group.name }, { onSuccess: onClose })}
					>
						Delete group
					</Button>
				</>
			}
		>
			<p className="m-0 text-secondary" style={{ fontSize: 15, lineHeight: 1.55 }}>
				{DELETE_GROUP_BODY}
			</p>
		</Dialog>
	)
}
