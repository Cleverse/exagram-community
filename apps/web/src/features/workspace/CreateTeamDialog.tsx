import { type InputHTMLAttributes, useEffect, useId, useRef } from "react"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { CREATE_TEAM_HELP, useCreateTeamForm } from "@/features/workspace/useCreateTeamMutation"

/**
 * A child of the Dialog, so its focus effect runs before the Dialog's own and after a menu that opened this dialog
 * has handed focus back to its trigger; `autoFocus` runs before both and loses to them.
 */
const TeamNameInput = (props: InputHTMLAttributes<HTMLInputElement>) => {
	const ref = useRef<HTMLInputElement>(null)
	useEffect(() => ref.current?.focus(), [])
	return <input ref={ref} {...props} />
}

export const CreateTeamDialog = ({ onClose }: { onClose: () => void }) => {
	const form = useCreateTeamForm((enter) => void enter().then(onClose))
	const formId = useId()
	const nameId = useId()
	const errorId = useId()
	const close = form.pending ? () => {} : onClose

	return (
		<Dialog
			title="Create team"
			width={480}
			onClose={close}
			helper={CREATE_TEAM_HELP}
			footer={
				<>
					<Button variant="outline" size={40} disabled={form.pending} onClick={close}>
						Cancel
					</Button>
					<Button type="submit" form={formId} size={40} disabled={!form.canSubmit}>
						{form.pending ? "Creating…" : "Create team"}
					</Button>
				</>
			}
		>
			<form
				id={formId}
				onSubmit={(event) => {
					event.preventDefault()
					form.submit()
				}}
			>
				<label htmlFor={nameId} className="block" style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
					Team name
				</label>
				<TeamNameInput
					id={nameId}
					autoComplete="organization"
					maxLength={200}
					aria-invalid={form.error !== null}
					aria-describedby={form.error === null ? undefined : errorId}
					value={form.name}
					onChange={(event) => form.setName(event.target.value)}
					placeholder="e.g. Acme"
					className="w-full border border-line-soft bg-white outline-0 focus:border-ink"
					style={{ height: 44, padding: "0 14px", fontSize: 15 }}
				/>
				{form.error ? (
					<p
						id={errorId}
						role="alert"
						className="text-danger"
						style={{ fontSize: 13.5, marginTop: 12, marginBottom: 0 }}
					>
						{form.error}
					</p>
				) : null}
			</form>
		</Dialog>
	)
}
