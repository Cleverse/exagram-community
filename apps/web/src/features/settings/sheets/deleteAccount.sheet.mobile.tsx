import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { ConfirmPanel } from "@/features/artifact/sheets/sheetParts"
import { DELETE_ACCOUNT_LEAD } from "@/features/settings/deleteAccountCopy"
import { DeleteAccountForm } from "@/features/settings/DeleteAccountForm"
import { useDeleteAccountForm } from "@/features/settings/hooks/useDeleteAccountForm"

export default function DeleteAccountSheet() {
	const sheet = useSheet()
	const form = useDeleteAccountForm(sheet.closeThen)

	return (
		<Sheet title="Delete your account?" wrapTitle>
			<ConfirmPanel
				message={DELETE_ACCOUNT_LEAD}
				confirmLabel="Delete account"
				busyLabel="Deleting…"
				busy={form.pending}
				confirmDisabled={!form.canSubmit}
				onCancel={sheet.back}
				onConfirm={form.submit}
			>
				<div style={{ marginTop: 14 }}>
					{/* 16px keeps iOS Safari from zooming the page when the field takes focus. */}
					<DeleteAccountForm form={form} inputStyle={{ height: 44, padding: "0 12px", fontSize: 16 }} />
				</div>
			</ConfirmPanel>
		</Sheet>
	)
}
