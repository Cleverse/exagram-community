import { useState } from "react"
import { Navigate, useParams } from "react-router"

import { NotFound } from "@/components/NotFound"
import { Button } from "@/components/ui/Button"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { Switch } from "@/components/ui/Switch"
import { edition } from "@/edition/edition"
import { AuditPage } from "@/features/audit/AuditPage"
import { useAppleLink } from "@/features/auth/hooks/useAppleLink"
import { useGoogleLink } from "@/features/auth/hooks/useGoogleLink"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSignOut } from "@/features/auth/hooks/useSignIn"
import { macTabs } from "@/features/notifications/macBridge"
import { DELETE_ACCOUNT_SECTION } from "@/features/settings/deleteAccountCopy"
import { DeleteAccountDialog } from "@/features/settings/DeleteAccountDialog"
import {
	useNotificationPreferences,
	useNotificationSwitches,
	useSetNotificationPreferences,
} from "@/features/settings/hooks/useNotificationPreferences"
import { usePasswordResetAvailable } from "@/features/settings/hooks/useResetLinks"
import { Card, Field, SectionTitle } from "@/features/settings/settingsParts"
import { isSettingsTab, SETTINGS_TAB_LABEL, visibleSettingsTabs } from "@/features/settings/settingsTabs"
import { TeamPage } from "@/features/settings/team/TeamPage"
import { WorkspaceResetLinks } from "@/features/settings/WorkspaceResetLinks"
import { useCreateTeamEntry } from "@/features/workspace/CreateTeamEntry"
import { useCanCreateTeam } from "@/features/workspace/useCreateTeamMutation"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths, type SettingsTab } from "@/routes/paths"

const SUBLINE: Record<SettingsTab, string> = {
	general: edition.copy.generalSubline,
	team: "A team shares a Workspace with the people you invite. You can belong to one team at a time.",
	notifications:
		"Notifications appear in the Exagram apps for Mac and iPhone. They name the file or folder and who acted, never what it says.",
	security:
		"Your raw content is never readable by Exagram, and only what your policy approved reaches the AI provider you chose. Below is what runs before anything leaves.",
	audit:
		"Every request is recorded, whoever made it: who, what it asked for, and which revision it received. Content never appears here.",
}

const NoTeamSettings = () => {
	const entry = useCreateTeamEntry()
	return (
		<>
			<Card>
				<div className="flex items-start gap-5 px-6 py-[22px]">
					<div className="min-w-0 flex-1">
						<div className="text-[17px] font-semibold">You don't have a team yet</div>
						<div className="mt-1 text-[15px] leading-[1.55] text-muted">
							Create one to invite people into a Workspace you share. Your Personal Workspace stays yours.
						</div>
					</div>
					<Button size={40} onClick={entry.open}>
						Create team
					</Button>
				</div>
			</Card>
			{entry.dialog}
		</>
	)
}

const GeneralSettings = () => {
	const me = useMe()
	const passwordReset = usePasswordResetAvailable(me.data?.isAdmin === true)
	const team = useWorkspaceKind() === "team"
	const google = useGoogleLink()
	const apple = useAppleLink()
	const signOut = useSignOut()
	const [deleting, setDeleting] = useState(false)
	const workspaceShown = edition.WorkspaceSection !== null
	const resetShown = me.data?.isAdmin === true && passwordReset && team
	const notificationEmailShown =
		me.data?.isAdmin === true && team && edition.WorkspaceNotificationEmailSettings !== null
	const macShown = edition.MacAppSettings !== null && macTabs()
	// A section's top margin separates it from one above it; the first section on the page starts flush.
	const gap = (above: boolean) => (above ? "mt-11" : undefined)

	return (
		<>
			{edition.WorkspaceSection ? <edition.WorkspaceSection variant="desktop" /> : null}

			{resetShown ? (
				<>
					<div className={gap(workspaceShown)}>
						<SectionTitle>Reset a password</SectionTitle>
					</div>
					<WorkspaceResetLinks />
				</>
			) : null}

			{notificationEmailShown && edition.WorkspaceNotificationEmailSettings ? (
				<edition.WorkspaceNotificationEmailSettings variant="desktop" />
			) : null}

			{macShown && edition.MacAppSettings ? (
				<>
					<div className={gap(workspaceShown || resetShown || notificationEmailShown)}>
						<SectionTitle>Mac app</SectionTitle>
					</div>
					<Card>
						<edition.MacAppSettings />
					</Card>
				</>
			) : null}

			<div className={gap(workspaceShown || resetShown || notificationEmailShown || macShown)}>
				<SectionTitle>Account</SectionTitle>
			</div>
			<Card>
				<Field label="Name">
					<span className="truncate">{me.data?.name}</span>
				</Field>
				<Field label="Email">
					<span className="truncate">{me.data?.email}</span>
				</Field>
				{google.shown ? <Field label="Google">{me.data?.googleLinked ? "Connected" : "Not connected"}</Field> : null}
				{apple.shown ? <Field label="Apple">{apple.linked ? "Connected" : "Not connected"}</Field> : null}
			</Card>
			<div className="mt-6 flex items-center" style={{ gap: 10 }}>
				{google.available ? (
					<a
						href={google.href}
						className="press flex items-center rounded-(--radius) bg-primary text-white hover:bg-primary-hover"
						style={{ height: 36, padding: "0 16px", fontSize: 14, fontWeight: 600 }}
					>
						Connect Google
					</a>
				) : null}
				{apple.available ? (
					<a
						href={apple.href}
						className="press flex items-center rounded-(--radius) bg-primary text-white hover:bg-primary-hover"
						style={{ height: 36, padding: "0 16px", fontSize: 14, fontWeight: 600 }}
					>
						Connect Apple
					</a>
				) : null}
				<Button variant="outline" size={36} onClick={() => signOut.mutate()}>
					Sign out
				</Button>
			</div>

			<div className="mt-11">
				<SectionTitle>Delete account</SectionTitle>
			</div>
			<Card>
				<div className="flex items-center gap-5 px-6 py-[22px]">
					<div className="min-w-0 flex-1 text-[15px] leading-[1.55] text-muted">{DELETE_ACCOUNT_SECTION}</div>
					<Button variant="danger" size={40} onClick={() => setDeleting(true)}>
						Delete account
					</Button>
				</div>
			</Card>
			{deleting ? <DeleteAccountDialog onClose={() => setDeleting(false)} /> : null}
		</>
	)
}

/**
 * The member's own Notification Preferences, one switch per kind, then Notification Email; each saves as it moves.
 * Every member has this tab.
 */
const NotificationSettings = () => (
	<>
		<section aria-labelledby="notify-me-when">
			<SectionTitle id="notify-me-when">Notify me when</SectionTitle>
			<AppSwitches />
		</section>
		{edition.NotificationEmailSettings ? <edition.NotificationEmailSettings variant="desktop" /> : null}
	</>
)

/** The four app switches. */
const AppSwitches = () => {
	const preferences = useNotificationPreferences()
	const update = useSetNotificationPreferences()
	const switches = useNotificationSwitches()

	if (preferences.isPending) {
		return (
			<SkeletonStatus label="Loading notification settings…">
				<Skeleton height={300} />
			</SkeletonStatus>
		)
	}
	if (preferences.isError) {
		return (
			<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
				{preferences.error.message}
			</p>
		)
	}
	const current = preferences.data

	return (
		<Card>
			{switches.map(({ field, label, hint }) => (
				<div key={field} className="flex items-start gap-5 border-b border-line-pale px-6 py-[22px] last:border-b-0">
					<div className="min-w-0 flex-1">
						<div className="text-[17px] font-semibold">{label}</div>
						<div className="mt-1 text-[15px] leading-[1.55] text-muted">{hint}</div>
					</div>
					<Switch
						checked={current[field]}
						label={label}
						onChange={(next) => update.mutate({ ...current, [field]: next })}
					/>
				</div>
			))}
		</Card>
	)
}

/**
 * Settings (`/settings/:tab`), the content beside `SettingsSidebar`: a centred column up to 1250px, each
 * tab's H1 and muted subline, then the tab. General holds the Workspace and the account, Notifications the
 * member's Notification Preferences, Security the
 * Workspace's redaction, Audit the Ledger.
 */
export const SettingsPage = () => {
	const { tab } = useParams()
	const capability = edition.useRedactionCapability()
	const kind = useWorkspaceKind()
	const teamless = useCanCreateTeam()
	if (!isSettingsTab(tab)) return <NotFound />
	if (kind === undefined) return null
	// Security waits for the answer: redirecting while it loads would bounce an admin off a tab that is on.
	if (
		tab === "security" &&
		capability === "loading" &&
		visibleSettingsTabs(edition, { redaction: true, kind }).includes(tab)
	)
		return null
	if (
		!visibleSettingsTabs(edition, { redaction: capability === "enabled", kind, canCreateTeam: teamless }).includes(tab)
	)
		return <Navigate to={paths.settings("general")} replace />
	if (tab === "team" && !teamless) return <TeamPage />
	const Page = edition.settingsPages[tab]?.desktop

	return (
		<div data-screen-label={SETTINGS_TAB_LABEL[tab]} style={{ minHeight: "100vh" }}>
			<div style={{ maxWidth: 1250, margin: "0 auto", padding: "56px 48px 96px" }}>
				<h1 className="font-display m-0" style={{ fontWeight: 700, fontSize: 32, letterSpacing: "-.02em" }}>
					{SETTINGS_TAB_LABEL[tab]}
				</h1>
				<p className="mt-2 mb-0 max-w-[760px] text-pretty text-muted" style={{ fontSize: 15, lineHeight: 1.55 }}>
					{SUBLINE[tab]}
				</p>
				<div style={{ marginTop: 40 }}>
					{tab === "general" ? (
						<GeneralSettings />
					) : tab === "team" ? (
						<NoTeamSettings />
					) : tab === "notifications" ? (
						<NotificationSettings />
					) : Page ? (
						<Page />
					) : (
						<AuditPage />
					)}
				</div>
			</div>
		</div>
	)
}
