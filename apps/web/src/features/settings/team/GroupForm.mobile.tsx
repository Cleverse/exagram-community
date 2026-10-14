import { type AdminGroup } from "@exagram/api-client"
import { useId } from "react"

import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { Avatar } from "@/components/ui/Avatar"
import { Checkbox } from "@/components/ui/Checkbox"
import { buttonStyle, inkButtonClass } from "@/features/artifact/sheets/sheetData"
import { useGroupForm } from "@/features/settings/team/hooks/useGroupForm"
import { sheetFieldClass, sheetFieldStyle } from "@/features/settings/team/sheets/sheetField"
import { FieldLabel, FormError } from "@/features/settings/team/sheets/teamSheetParts"
import { GROUP_MODAL_INTRO, groupPickHint } from "@/features/settings/team/teamCopy"
import { type TeamMember } from "@/features/settings/team/teamModel"
import { initialsOf } from "@/utils/initials"

const NAME_MAX = 100

export const GroupForm = ({
	group,
	members,
	youId,
}: {
	group: AdminGroup | undefined
	members: readonly TeamMember[]
	youId: string | undefined
}) => {
	const sheet = useSheet()
	const form = useGroupForm(group, members, sheet.close)
	const nameId = useId()

	return (
		<Sheet title={group ? "Edit group" : "New group"}>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					form.submit()
				}}
			>
				<div className="flex flex-col" style={{ padding: "0 16px", gap: 6 }}>
					<p className="m-0 text-muted" style={{ fontSize: 14, marginBottom: 8 }}>
						{GROUP_MODAL_INTRO}
					</p>
					<FieldLabel htmlFor={nameId}>Name</FieldLabel>
					<input
						id={nameId}
						maxLength={NAME_MAX}
						placeholder="e.g. Design team"
						className={sheetFieldClass}
						style={sheetFieldStyle}
						value={form.name}
						onChange={(event) => form.rename(event.target.value)}
					/>
				</div>
				<div className="flex items-baseline" style={{ gap: 10, padding: "18px 16px 4px" }}>
					<div style={{ fontSize: 14, fontWeight: 600 }}>Members</div>
					<div className="text-muted" style={{ fontSize: 14 }}>
						{groupPickHint(form.picked.size)}
					</div>
				</div>
				<ul aria-label="Members" className="m-0 list-none p-0">
					{members.map((member) => (
						<li key={member.id} className="border-b border-row-line last:border-b-0">
							<label
								className="flex items-center active:bg-hover"
								style={{ gap: 12, minHeight: 56, padding: "8px 16px" }}
							>
								<Checkbox checked={form.picked.has(member.id)} onChange={(on) => form.toggle(member.id, on)} />
								<Avatar
									initials={initialsOf(member.name, member.email)}
									size={36}
									background="var(--color-subtle)"
									color="var(--color-ink)"
									className="flex-none"
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate" style={{ fontSize: 15, fontWeight: 500 }}>
										{member.id === youId ? `${member.name} (you)` : member.name}
									</span>
									<span className="block truncate text-muted" style={{ fontSize: 13 }}>
										{member.email}
									</span>
								</span>
							</label>
						</li>
					))}
				</ul>
				{group ? (
					<button
						type="button"
						onClick={() => sheet.push("groupDelete", { groupId: group.id })}
						className="w-full border-t border-row-line text-left text-danger active:bg-danger-bg"
						style={{ minHeight: 52, padding: "0 16px", fontSize: 15 }}
					>
						Delete group
					</button>
				) : null}
				<div className="sticky bottom-0 border-t border-row-line bg-white" style={{ padding: "10px 16px" }}>
					{form.error ? (
						<div style={{ marginBottom: 8 }}>
							<FormError>{form.error.message}</FormError>
						</div>
					) : null}
					<button
						type="submit"
						disabled={!form.ready || form.saving}
						className={`${inkButtonClass} w-full`}
						style={{ ...buttonStyle, height: 46 }}
					>
						{group ? "Save changes" : "Create group"}
					</button>
				</div>
			</form>
		</Sheet>
	)
}
