import { useId } from "react"

import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { CREATE_TEAM_HELP, useCreateTeamForm } from "@/features/workspace/useCreateTeamMutation"

export default function CreateTeamSheet() {
	const sheet = useSheet()
	const form = useCreateTeamForm((enter) => sheet.closeThen(() => void enter()))
	const nameId = useId()
	const errorId = useId()

	return (
		<Sheet title="Create team">
			<form
				className="flex flex-col"
				style={{ padding: "4px 16px 12px", gap: 16 }}
				onSubmit={(event) => {
					event.preventDefault()
					form.submit()
				}}
			>
				<div className="flex flex-col" style={{ gap: 6 }}>
					<label htmlFor={nameId} className="text-secondary" style={{ fontSize: 13, fontWeight: 500 }}>
						Team name
					</label>
					<input
						id={nameId}
						autoFocus
						autoComplete="organization"
						maxLength={200}
						aria-invalid={form.error !== null}
						aria-describedby={form.error === null ? undefined : errorId}
						value={form.name}
						onChange={(event) => form.setName(event.target.value)}
						placeholder="e.g. Acme"
						className="border border-line-strong bg-white outline-none focus:border-ink"
						// 16px keeps iOS Safari from zooming the page when the field takes focus.
						style={{ height: 44, padding: "0 12px", borderRadius: 6, fontSize: 16 }}
					/>
					<span className="text-muted-2" style={{ fontSize: 12 }}>
						{CREATE_TEAM_HELP}
					</span>
				</div>
				{form.error ? (
					<p id={errorId} role="alert" className="m-0 text-danger" style={{ fontSize: 13.5 }}>
						{form.error}
					</p>
				) : null}
				<button
					type="submit"
					disabled={!form.canSubmit}
					className={form.canSubmit ? "bg-ink text-white active:bg-primary-hover" : "bg-row-selected text-muted-2"}
					style={{ height: 46, borderRadius: 6, fontSize: 15, fontWeight: 500 }}
				>
					{form.pending ? "Creating…" : "Create team"}
				</button>
			</form>
		</Sheet>
	)
}
