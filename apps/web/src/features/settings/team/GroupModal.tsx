import { type AdminGroup } from "@exagram/api-client"
import { type KeyboardEvent, useId } from "react"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { Checkbox } from "@/components/ui/Checkbox"
import { useGroupForm } from "@/features/settings/team/hooks/useGroupForm"
import { GROUP_MODAL_INTRO, groupPickHint } from "@/features/settings/team/teamCopy"
import { type TeamMember } from "@/features/settings/team/teamModel"
import { initialsOf } from "@/utils/initials"

const NAME_MAX = 100

export const GroupModal = ({
	group,
	members,
	youId,
	onClose,
}: {
	group?: AdminGroup
	members: readonly TeamMember[]
	youId: string | undefined
	onClose: () => void
}) => {
	const form = useGroupForm(group, members, onClose)
	const nameId = useId()
	const editing = group !== undefined

	const submitOnEnter = (event: KeyboardEvent) => {
		if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return
		event.preventDefault()
		form.submit()
	}

	return (
		<Dialog
			title={editing ? "Edit group" : "New group"}
			titleSize={22}
			onClose={onClose}
			width={520}
			bodyGap={0}
			bodyPadding="20px 24px 0"
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Cancel
					</Button>
					<Button size={40} disabled={!form.ready || form.saving} onClick={form.submit}>
						{editing ? "Save changes" : "Create group"}
					</Button>
				</>
			}
		>
			<div onKeyDown={submitOnEnter}>
				<p className="m-0 text-muted" style={{ fontSize: 14 }}>
					{GROUP_MODAL_INTRO}
				</p>
				<label htmlFor={nameId} className="block" style={{ fontSize: 14, fontWeight: 600, margin: "18px 0 8px" }}>
					Name
				</label>
				<input
					id={nameId}
					autoFocus
					maxLength={NAME_MAX}
					placeholder="e.g. Design team"
					value={form.name}
					onChange={(event) => {
						form.rename(event.target.value)
					}}
					className="w-full rounded-(--radius) border border-line-strong bg-white outline-0 focus:border-ink"
					style={{ height: 44, padding: "0 14px", fontSize: 15 }}
				/>
				{form.error ? (
					<p role="alert" className="m-0 text-danger" style={{ fontSize: 14, marginTop: 8 }}>
						{form.error.message}
					</p>
				) : null}
				<div className="flex items-baseline" style={{ gap: 10, marginTop: 20 }}>
					<div style={{ fontSize: 14, fontWeight: 600 }}>Members</div>
					<div className="text-muted" style={{ fontSize: 14 }}>
						{groupPickHint(form.picked.size)}
					</div>
				</div>
				<ul
					aria-label="Members"
					className="m-0 list-none overflow-y-auto rounded-(--radius) border border-line bg-white p-0"
					style={{ marginTop: 8, marginBottom: 20, maxHeight: 320 }}
				>
					{members.map((member) => (
						<li key={member.id} className="border-b border-row-line last:border-b-0">
							<label
								className="flex cursor-pointer items-center hover:bg-[#fbfbfd]"
								style={{ gap: 12, padding: "10px 14px" }}
							>
								<Checkbox checked={form.picked.has(member.id)} onChange={(on) => form.toggle(member.id, on)} />
								<span
									aria-hidden
									className="grid flex-none place-items-center bg-subtle font-mono text-ink"
									style={{ width: 32, height: 32, borderRadius: "var(--radius)", fontSize: 11, fontWeight: 500 }}
								>
									{initialsOf(member.name, member.email)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate" style={{ fontSize: 15, fontWeight: 500 }}>
										{member.id === youId ? `${member.name} (you)` : member.name}
									</span>
									<span className="block truncate text-muted" style={{ fontSize: 14 }}>
										{member.email}
									</span>
								</span>
							</label>
						</li>
					))}
				</ul>
			</div>
		</Dialog>
	)
}
