import { useId } from "react"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { DELETE_ACCOUNT_LEAD } from "@/features/settings/deleteAccountCopy"
import { DeleteAccountForm } from "@/features/settings/DeleteAccountForm"
import { useDeleteAccountForm } from "@/features/settings/hooks/useDeleteAccountForm"

export const DeleteAccountDialog = ({ onClose }: { onClose: () => void }) => {
	const form = useDeleteAccountForm((leave) => leave())
	const formId = useId()
	const close = form.pending ? () => {} : onClose

	return (
		<Dialog
			title="Delete your account?"
			width={520}
			bodyGap={16}
			onClose={close}
			footer={
				<>
					<Button variant="outline" size={40} disabled={form.pending} onClick={close}>
						Cancel
					</Button>
					<Button type="submit" form={formId} variant="danger" size={40} disabled={!form.canSubmit}>
						{form.pending ? "Deleting…" : "Delete account"}
					</Button>
				</>
			}
		>
			<p className="m-0 text-secondary" style={{ fontSize: 15, lineHeight: 1.55 }}>
				{DELETE_ACCOUNT_LEAD}
			</p>
			<DeleteAccountForm
				form={form}
				formId={formId}
				autoFocus
				inputStyle={{ height: 44, padding: "0 14px", fontSize: 15 }}
			/>
		</Dialog>
	)
}
