import { Navigate, useParams } from "react-router"

import { NotFound } from "@/components/NotFound"
import { Button } from "@/components/ui/Button"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { Switch } from "@/components/ui/Switch"
import { edition } from "@/edition/edition"
import { AuditPage } from "@/features/audit/AuditPage"
import { useGoogleLink } from "@/features/auth/hooks/useGoogleLink"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSignOut } from "@/features/auth/hooks/useSignIn"
import { macTabs } from "@/features/notifications/macBridge"
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
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths, type SettingsTab } from "@/routes/paths"

const SUBLINE: Record<Exclude<SettingsTab, "team">, string> = {
	general: edition.copy.generalSubline,
	notifications:
		"Notifications appear in the Exagram apps for Mac and iPhone. They name the file or folder and who acted, never what it says.",
	security:
		"Your raw content is never readable by Exagram, and only what your policy approved reaches the AI provider you chose. Below is what runs before anything leaves.",
	audit:
		"Every request a connected client makes is recorded: which client, what it asked for, and which revision it received. Content never appears here.",
}

const GeneralSettings = () => {
	const me = useMe()
	const passwordReset = usePasswordResetAvailable(me.data?.isAdmin === true)
	const personal = useWorkspaceKind() === "personal"
	const google = useGoogleLink()
	const signOut = useSignOut()

	return (
		<>
			{edition.WorkspaceSection ? <edition.WorkspaceSection variant="desktop" /> : null}

			{me.data?.isAdmin && passwordReset && !personal ? (
				<>
					<div className="mt-11">
						<SectionTitle>Reset a password</SectionTitle>
					</div>
					<WorkspaceResetLinks />
				</>
			) : null}

			{me.data?.isAdmin && !personal && edition.WorkspaceNotificationEmailSettings ? (
				<edition.WorkspaceNotificationEmailSettings variant="desktop" />
			) : null}

			{edition.MacAppSettings && macTabs() ? (
				<>
					<div className="mt-11">
						<SectionTitle>Mac app</SectionTitle>
					</div>
					<Card>
						<edition.MacAppSettings />
					</Card>
				</>
			) : null}

			<div className="mt-11">
				<SectionTitle>Account</SectionTitle>
			</div>
			<Card>
				<Field label="Name">
					<span className="truncate">{me.data?.name}</span>
				</Field>
				<Field label="Email">
					<span className="truncate">{me.data?.email}</span>
				</Field>
				<Field label="Google">{me.data?.googleLinked ? "Connected" : "Not connected"}</Field>
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
				<Button variant="outline" size={36} onClick={() => signOut.mutate()}>
					Sign out
				</Button>
			</div>
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

/** The four app switches (ADR 0036). */
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
	if (!isSettingsTab(tab)) return <NotFound />
	// Security waits for the answer: redirecting while it loads would bounce an admin off a tab that is on.
	if (
		tab === "security" &&
		capability === "loading" &&
		visibleSettingsTabs(edition, { redaction: true, kind }).includes(tab)
	)
		return null
	if (!visibleSettingsTabs(edition, { redaction: capability === "enabled", kind }).includes(tab))
		return <Navigate to={paths.settings("general")} replace />
	if (tab === "team") return <TeamPage />
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
