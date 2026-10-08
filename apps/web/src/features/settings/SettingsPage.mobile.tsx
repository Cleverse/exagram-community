import { useState } from "react"
import { Link, Navigate, useParams } from "react-router"

import { MobileScreen, PushHeader } from "@/components/mobile/primitives"
import { NotFound } from "@/components/NotFound"
import { IconCopy } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { edition } from "@/edition/edition"
import { ACTION } from "@/features/audit/actionStyles"
import { type AuditRow, isRedactionSwitchRow } from "@/features/audit/auditModel"
import { useAuditRows } from "@/features/audit/hooks/useAuditRows"
import { useGoogleLink } from "@/features/auth/hooks/useGoogleLink"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSignOut } from "@/features/auth/hooks/useSignIn"
import { INVITE_ROLE_LABEL, inviteExpiry, type InviteRole, useInvites } from "@/features/settings/hooks/useInvites"
import {
	useNotificationPreferences,
	useNotificationSwitches,
	useSetNotificationPreferences,
} from "@/features/settings/hooks/useNotificationPreferences"
import { usePasswordResetAvailable, useResetLinks } from "@/features/settings/hooks/useResetLinks"
import {
	MobileCard as Card,
	MobileField as Field,
	MobileLabel as Label,
	mobileInputClass,
	MobileSwitchRow as SwitchRow,
} from "@/features/settings/settingsParts"
import { isSettingsTab, SETTINGS_TAB_LABEL, visibleSettingsTabs } from "@/features/settings/settingsTabs"
import { useMembers } from "@/features/settings/team/hooks/useMembers"
import { ROLE_LABEL, sortTeam, teamSummary } from "@/features/settings/team/teamModel"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths, type SettingsTab } from "@/routes/paths"

const TeamTab = () => {
	const members = useMembers()
	const youId = useMe().data?.id
	return (
		<>
			<Label first>{members.data ? teamSummary(members.data.items, null) : "Members"}</Label>
			{members.isPending ? (
				<SkeletonStatus label="Loading members…">
					<Skeleton height={180} radius={10} />
				</SkeletonStatus>
			) : members.isError ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
					{members.error.message}
				</p>
			) : (
				<Card>
					{sortTeam(members.data.items, youId).map((member) => (
						<Field key={member.id} label={member.workspaceOwner ? "Owner" : ROLE_LABEL[member.role]}>
							{member.name}
						</Field>
					))}
				</Card>
			)}
			{members.data?.view === "admin" ? <InvitesSection /> : null}
		</>
	)
}

const InvitesSection = () => {
	const invites = useInvites(true)
	const joining = edition.useTeamJoining()
	const emailed = joining.emailed
	const rows = invites.list.data ?? []
	return (
		<>
			<Label>Invites</Label>
			<form className="flex flex-col" style={{ gap: 10 }} onSubmit={invites.submit}>
				<label htmlFor="invite-email-mobile" className="sr-only">
					Email
				</label>
				<input
					id="invite-email-mobile"
					type="email"
					placeholder="name@example.com"
					className={mobileInputClass}
					style={{ height: 44, fontSize: 15 }}
					value={invites.email}
					onChange={(event) => invites.setEmail(event.target.value)}
					required
				/>
				{edition.adminInvites ? (
					<>
						<label htmlFor="invite-role-mobile" className="sr-only">
							Role
						</label>
						<select
							id="invite-role-mobile"
							className={mobileInputClass}
							style={{ height: 44, fontSize: 15 }}
							value={invites.role}
							onChange={(event) => invites.setRole(event.target.value as InviteRole)}
						>
							<option value="member">Member</option>
							<option value="admin">Admin</option>
						</select>
					</>
				) : null}
				<button
					type="submit"
					disabled={!joining.ready || invites.create.isPending || !invites.email.trim()}
					className="bg-ink text-white active:bg-primary-hover disabled:opacity-60"
					style={{ height: 44, borderRadius: 6, fontSize: 14.5, fontWeight: 500 }}
				>
					{emailed ? "Send invite" : "Create invite link"}
				</button>
			</form>
			{joining.error ? (
				<p role="alert" className="text-danger" style={{ fontSize: 14, margin: "10px 0 0" }}>
					{joining.error.message}
				</p>
			) : null}
			{invites.errorMessage ? (
				<p role="alert" className="text-danger" style={{ fontSize: 14, margin: "10px 0 0" }}>
					{invites.errorMessage}
				</p>
			) : null}
			{invites.issued ? (
				<div style={{ marginTop: 12 }}>
					<Card>
						<Field
							label={`Invite link for ${invites.issued.invite.email}, shown only now`}
							trailing={
								<button
									type="button"
									aria-label="Copy invite link"
									onClick={() => invites.issued && invites.copy(invites.issued.url)}
									className="grid flex-none place-items-center text-secondary active:bg-hover"
									style={{ width: 44, height: 44 }}
								>
									<IconCopy size={16} />
								</button>
							}
						>
							<span className="font-mono text-secondary" style={{ fontSize: 13 }}>
								{invites.issued.url}
							</span>
						</Field>
					</Card>
				</div>
			) : null}
			<div style={{ marginTop: 12 }}>
				{invites.list.isError ? (
					<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
						{invites.list.error.message}
					</p>
				) : invites.list.isPending ? (
					<p className="m-0 text-muted" style={{ fontSize: 14 }}>
						Loading invites…
					</p>
				) : rows.length === 0 ? (
					<p className="m-0 text-muted" style={{ fontSize: 14 }}>
						No pending invites.
					</p>
				) : (
					<Card>
						{rows.map((invite) => (
							<div
								key={invite.id}
								className="border-b border-row-line last:border-b-0"
								style={{ padding: "10px 14px" }}
							>
								<div className="truncate" style={{ fontSize: 15 }}>
									{invite.email}
								</div>
								<div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
									{`${INVITE_ROLE_LABEL[invite.role]} · ${inviteExpiry(invite)}`}
								</div>
								<div className="flex" style={{ gap: 8, marginTop: 8 }}>
									<button
										type="button"
										disabled={invites.renew.isPending}
										onClick={() => invites.renew.mutate(invite.id)}
										aria-label={`${emailed ? "Resend invite to" : "Copy new link for"} ${invite.email}`}
										className="border border-line-strong text-ink active:bg-hover disabled:opacity-60"
										style={{ height: 40, padding: "0 14px", fontSize: 14, fontWeight: 500 }}
									>
										{emailed ? "Resend" : "Copy new link"}
									</button>
									<button
										type="button"
										disabled={invites.revoke.isPending}
										onClick={() => invites.revoke.mutate(invite.id)}
										aria-label={`Revoke invite for ${invite.email}`}
										className="text-muted active:bg-hover disabled:opacity-60"
										style={{ height: 40, padding: "0 14px", fontSize: 14, fontWeight: 500 }}
									>
										Revoke
									</button>
								</div>
							</div>
						))}
					</Card>
				)}
			</div>
		</>
	)
}

/** Desktop's "Reset a password" (`WorkspaceResetLinks.tsx`) in one column: the form, then the reset link just made. */
const ResetLinkSection = () => {
	const resets = useResetLinks()
	return (
		<>
			<Label>Reset a password</Label>
			<form className="flex flex-col" style={{ gap: 10 }} onSubmit={resets.submit}>
				<label htmlFor="reset-email-mobile" className="sr-only">
					Member's email
				</label>
				<input
					id="reset-email-mobile"
					type="email"
					placeholder="name@example.com"
					className={mobileInputClass}
					style={{ height: 44, fontSize: 15 }}
					value={resets.email}
					onChange={(event) => resets.setEmail(event.target.value)}
					required
				/>
				<button
					type="submit"
					disabled={resets.create.isPending || !resets.email.trim()}
					className="bg-ink text-white active:bg-primary-hover disabled:opacity-60"
					style={{ height: 44, borderRadius: 6, fontSize: 14.5, fontWeight: 500 }}
				>
					Create reset link
				</button>
			</form>
			{resets.errorMessage ? (
				<p role="alert" className="text-danger" style={{ fontSize: 14, margin: "10px 0 0" }}>
					{resets.errorMessage}
				</p>
			) : null}
			{resets.issued ? (
				<div style={{ marginTop: 12 }}>
					<Card>
						<Field
							label={`Reset link for ${resets.issued.email}, shown only now; works once, for 1 hour`}
							trailing={
								<button
									type="button"
									aria-label="Copy reset link"
									onClick={() => resets.issued && resets.copy(resets.issued.url)}
									className="grid flex-none place-items-center text-secondary active:bg-hover"
									style={{ width: 44, height: 44 }}
								>
									<IconCopy size={16} />
								</button>
							}
						>
							<span className="font-mono text-secondary" style={{ fontSize: 13 }}>
								{resets.issued.url}
							</span>
						</Field>
					</Card>
				</div>
			) : null}
		</>
	)
}

const GeneralTab = () => {
	const me = useMe()
	const passwordReset = usePasswordResetAvailable(me.data?.isAdmin === true)
	const personal = useWorkspaceKind() === "personal"
	const google = useGoogleLink()
	const signOut = useSignOut()

	return (
		<>
			{edition.WorkspaceSection ? <edition.WorkspaceSection variant="mobile" /> : null}

			{me.data?.isAdmin && passwordReset && !personal ? <ResetLinkSection /> : null}
			{me.data?.isAdmin && !personal && edition.WorkspaceNotificationEmailSettings ? (
				<edition.WorkspaceNotificationEmailSettings variant="mobile" />
			) : null}

			<Label>Account</Label>
			<Card>
				<Field label="Name">{me.data?.name}</Field>
				<Field label="Email">{me.data?.email}</Field>
				<Field label="Google">{me.data?.googleLinked ? "Connected" : "Not connected"}</Field>
			</Card>

			<div className="flex flex-col" style={{ gap: 10, marginTop: 20 }}>
				{google.available ? (
					<a
						href={google.href}
						className="grid place-items-center bg-ink text-white hover:text-white active:bg-primary-hover"
						style={{ height: 44, borderRadius: 6, fontSize: 14.5, fontWeight: 500, textDecoration: "none" }}
					>
						Connect Google
					</a>
				) : null}
				<button
					type="button"
					onClick={() => signOut.mutate()}
					disabled={signOut.isPending}
					className="border border-line-strong text-ink active:bg-hover disabled:opacity-60"
					style={{ height: 44, fontSize: 14.5, fontWeight: 500 }}
				>
					Sign out
				</button>
			</div>
		</>
	)
}

/**
 * Desktop's Notifications tab in one column: the intro, one switch row per kind, then Notification Email. Every member
 * has it; each control saves as it moves.
 */
const NotificationsTab = () => (
	<>
		<p className="m-0 text-pretty text-body" style={{ fontSize: 15, lineHeight: 1.55 }}>
			Notifications appear in the Exagram apps for Mac and iPhone. They name the file or folder and who acted, never
			what it says.
		</p>
		<section aria-label="Notify me when">
			<Label>Notify me when</Label>
			<AppSwitches />
		</section>
		{edition.NotificationEmailSettings ? <edition.NotificationEmailSettings variant="mobile" /> : null}
	</>
)

const AppSwitches = () => {
	const preferences = useNotificationPreferences()
	const update = useSetNotificationPreferences()
	const switches = useNotificationSwitches()

	return preferences.isPending ? (
		<SkeletonStatus label="Loading notification settings…" className="flex flex-col" style={{ gap: 10 }}>
			<Skeleton height={64} radius={10} />
			<Skeleton height={64} radius={10} />
		</SkeletonStatus>
	) : preferences.isError ? (
		<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
			{preferences.error.message}
		</p>
	) : (
		<div className="flex flex-col" style={{ gap: 10 }}>
			{switches.map(({ field, label, hint }) => (
				<SwitchRow
					key={field}
					on={preferences.data[field]}
					label={label}
					hint={hint}
					onToggle={() => update.mutate({ ...preferences.data, [field]: !preferences.data[field] })}
				/>
			))}
		</div>
	)
}

/** `formatAuditTime`'s "Today 14:22" / "Fri 15:40" / "12 Sep 14:22", split into its day and its clock. */
const splitAuditTime = (time: string) => {
	const at = time.lastIndexOf(" ")
	return at < 0 ? { day: time, clock: "" } : { day: time.slice(0, at), clock: time.slice(at + 1) }
}

/** Rows in order, broken into runs of one day each (W:L529–530). */
const byDay = (rows: AuditRow[]) => {
	const groups: { day: string; rows: AuditRow[] }[] = []
	for (const row of rows) {
		const { day } = splitAuditTime(row.time)
		const last = groups.at(-1)
		if (last?.day === day) last.rows.push(row)
		else groups.push({ day, rows: [row] })
	}
	return groups
}

/** How many requests show before "Show more", and how many each tap adds. */
const AUDIT_STEP = 30

/**
 * One request (W:L531–541): the action pill, the client and the time, then what it touched and who asked.
 * The design's "N spans redacted" line is left out: the API ledgers no redaction counts.
 */
const AuditLine = ({ row }: { row: AuditRow }) => {
	const tone = ACTION[row.action]
	return (
		<li className="flex flex-col" style={{ padding: "10px 0", gap: 5 }}>
			<div className="flex items-center" style={{ gap: 8, fontSize: 12 }}>
				<span
					className="font-mono"
					style={{ fontWeight: 500, padding: "2px 6px", borderRadius: 4, background: tone.bg, color: tone.fg }}
				>
					{row.action}
				</span>
				<span className="truncate text-secondary" style={{ fontWeight: 500 }}>
					{row.client}
				</span>
				<span className="flex-1" />
				<span className="font-mono flex-none text-muted-2">{splitAuditTime(row.time).clock}</span>
			</div>
			<div className="text-body" style={{ fontSize: 14, lineHeight: 1.45 }}>
				{row.doc}
			</div>
			<div className="truncate text-muted-2" style={{ fontSize: 12 }}>
				{row.user}
			</div>
		</li>
	)
}

/** Audit (W:L527–543): the Ledger's last 90 days as desktop reads it (`useAuditRows`), grouped by day. */
const AuditTab = () => {
	const audit = useAuditRows()
	const redactionOn = edition.useRedactionCapability() === "enabled"
	const state =
		audit.status === "ready" && !redactionOn
			? { ...audit, rows: audit.rows.filter((row) => !isRedactionSwitchRow(row)) }
			: audit
	const [shown, setShown] = useState(AUDIT_STEP)

	return (
		<>
			<p className="m-0 text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
				Every request a connected client makes. Kept for 90 days.
			</p>
			{state.status === "loading" ? (
				<SkeletonStatus label="Loading the audit log…" className="flex flex-col" style={{ gap: 14, marginTop: 18 }}>
					{[0, 1, 2].map((index) => (
						<span key={index} className="flex flex-col" style={{ gap: 6 }}>
							<Skeleton width="45%" height={12} />
							<Skeleton width="80%" height={14} />
						</span>
					))}
				</SkeletonStatus>
			) : state.status === "forbidden" ? (
				<p className="text-muted" style={{ fontSize: 14, marginTop: 18 }}>
					Only workspace admins can read the audit log.
				</p>
			) : state.status === "error" ? (
				<div role="alert" style={{ marginTop: 18 }}>
					<p className="m-0 text-danger" style={{ fontSize: 14 }}>
						{state.message}
					</p>
					<button
						type="button"
						onClick={state.retry}
						className="border border-line-strong text-ink active:bg-hover"
						style={{ marginTop: 10, height: 40, padding: "0 14px", fontSize: 14, fontWeight: 500 }}
					>
						Retry
					</button>
				</div>
			) : state.rows.length === 0 ? (
				<p className="text-muted" style={{ fontSize: 14, marginTop: 18 }}>
					No client requests in the last 90 days.
				</p>
			) : (
				<>
					{byDay(state.rows.slice(0, shown)).map((group) => (
						<section key={group.day} aria-label={group.day}>
							<h3 className="m-0 text-muted-2" style={{ padding: "14px 0 4px", fontSize: 13, fontWeight: 500 }}>
								{group.day}
							</h3>
							<ul className="m-0 list-none p-0">
								{group.rows.map((row) => (
									<AuditLine key={row.id} row={row} />
								))}
							</ul>
						</section>
					))}
					{state.rows.length > shown ? (
						<button
							type="button"
							onClick={() => setShown((current) => current + AUDIT_STEP)}
							className="w-full border border-line-strong text-ink active:bg-hover"
							style={{ marginTop: 12, height: 44, fontSize: 14, fontWeight: 500 }}
						>
							Show more
						</button>
					) : null}
				</>
			)}
		</>
	)
}

/**
 * The tab strip (W:L486–490): 40px, 14/500, the current tab ink with a 2px ink underline. Each is a link to
 * its `/settings/<tab>` address that replaces the entry, so Back leaves Settings rather than stepping tabs.
 */
const Tabs = ({ current, tabs }: { current: SettingsTab; tabs: readonly SettingsTab[] }) => (
	<nav
		aria-label="Settings"
		className="flex flex-none overflow-x-auto border-b border-row-line"
		style={{ gap: 18, padding: "0 16px", marginTop: 14 }}
	>
		{tabs.map((tab) => {
			const on = tab === current
			return (
				<Link
					key={tab}
					to={paths.settings(tab)}
					replace
					aria-current={on ? "page" : undefined}
					className={on ? "text-ink hover:text-ink" : "text-muted hover:text-muted"}
					style={{
						height: 40,
						lineHeight: "40px",
						fontSize: 14,
						fontWeight: 500,
						whiteSpace: "nowrap",
						flex: "none",
						textDecoration: "none",
						boxShadow: on ? "inset 0 -2px 0 var(--color-ink)" : "none",
					}}
				>
					{SETTINGS_TAB_LABEL[tab]}
				</Link>
			)
		})}
	</nav>
)

/**
 * Settings (`/settings/:tab`, W:L478–554), pushed from the Account drawer: "Back to Exagram", the title and
 * Workspace, then desktop's tabs, each on the same hooks as desktop.
 */
export default function SettingsPageMobile() {
	const { tab } = useParams()
	const me = useMe()
	const capability = edition.useRedactionCapability()
	const kind = useWorkspaceKind()
	const line = edition.accountLine(kind, me.data?.workspaceName)
	if (!isSettingsTab(tab)) return <NotFound />
	// Security waits for the answer: redirecting while it loads would bounce an admin off a tab that is on.
	if (
		tab === "security" &&
		capability === "loading" &&
		visibleSettingsTabs(edition, { redaction: true, kind }).includes(tab)
	)
		return null
	const tabs = visibleSettingsTabs(edition, { redaction: capability === "enabled", kind })
	if (!tabs.includes(tab)) return <Navigate to={paths.settings("general")} replace />
	const Page = edition.settingsPages[tab]?.mobile

	return (
		<MobileScreen
			push
			label={SETTINGS_TAB_LABEL[tab]}
			header={
				<>
					<PushHeader to={paths.library} backLabel="Back to Exagram" />
					<div className="flex-none" style={{ padding: "18px 16px 0" }}>
						<h1 className="m-0" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.012em" }}>
							Settings
						</h1>
						{line ? (
							<div className="truncate text-muted" style={{ fontSize: 13, marginTop: 2 }}>
								{line}
							</div>
						) : null}
					</div>
					{tabs.length > 1 ? <Tabs current={tab} tabs={tabs} /> : null}
				</>
			}
			bodyStyle={{ padding: "14px 16px 40px" }}
		>
			{tab === "general" ? (
				<GeneralTab />
			) : tab === "team" ? (
				<TeamTab />
			) : tab === "notifications" ? (
				<NotificationsTab />
			) : Page ? (
				<Page />
			) : (
				<AuditTab />
			)}
		</MobileScreen>
	)
}
