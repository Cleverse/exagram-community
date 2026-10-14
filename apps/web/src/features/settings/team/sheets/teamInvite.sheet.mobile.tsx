import { useId } from "react"

import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { edition } from "@/edition/edition"
import { buttonStyle, inkButtonClass, outlineButtonClass } from "@/features/artifact/sheets/sheetData"
import { type InviteRole, useInvites } from "@/features/settings/hooks/useInvites"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { InviteLink } from "@/features/settings/team/InviteLink.mobile"
import { sheetFieldClass, sheetFieldStyle } from "@/features/settings/team/sheets/sheetField"
import { FieldLabel, FormError } from "@/features/settings/team/sheets/teamSheetParts"
import { isInviteEmail } from "@/features/settings/team/teamModel"

export default function TeamInviteSheet() {
	const sheet = useSheet()
	const admin = useMembers().data?.view === "admin"
	const joining = edition.useTeamJoining()
	const invites = useInvites(admin)
	const emailId = useId()
	const roleId = useId()
	const emailed = joining.emailed

	if (invites.issued) {
		return (
			<Sheet title="Invite member">
				<div className="flex flex-col" style={{ padding: "4px 16px 12px", gap: 14 }}>
					<InviteLink issued={invites.issued} onCopy={invites.copy} />
					<button type="button" onClick={sheet.close} className={inkButtonClass} style={buttonStyle}>
						Done
					</button>
				</div>
			</Sheet>
		)
	}

	return (
		<Sheet title="Invite member">
			<form
				className="flex flex-col"
				style={{ padding: "4px 16px 12px", gap: 16 }}
				onSubmit={(event) =>
					invites.submit(event, {
						onSuccess: (next) => {
							if (next.emailQueued || next.url === null) sheet.close()
						},
					})
				}
			>
				<div className="flex flex-col" style={{ gap: 6 }}>
					<FieldLabel htmlFor={emailId}>Email</FieldLabel>
					<input
						id={emailId}
						type="email"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						placeholder={`name@${joining.domain ?? "example.com"}`}
						className={sheetFieldClass}
						style={sheetFieldStyle}
						value={invites.email}
						onChange={(event) => invites.setEmail(event.target.value)}
					/>
				</div>
				{admin && edition.adminInvites ? (
					<div className="flex flex-col" style={{ gap: 6 }}>
						<FieldLabel htmlFor={roleId}>Role</FieldLabel>
						<select
							id={roleId}
							className={sheetFieldClass}
							style={sheetFieldStyle}
							value={invites.role}
							onChange={(event) => invites.setRole(event.target.value as InviteRole)}
						>
							<option value="member">Member</option>
							<option value="admin">Admin</option>
						</select>
					</div>
				) : null}
				{joining.error ? <FormError>{joining.error.message}</FormError> : null}
				{invites.errorMessage ? <FormError>{invites.errorMessage}</FormError> : null}
				<div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
					<button type="button" onClick={sheet.close} className={outlineButtonClass} style={buttonStyle}>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!joining.ready || invites.create.isPending || !isInviteEmail(invites.email)}
						className={inkButtonClass}
						style={buttonStyle}
					>
						{emailed ? "Send invite" : "Create invite link"}
					</button>
				</div>
			</form>
		</Sheet>
	)
}
