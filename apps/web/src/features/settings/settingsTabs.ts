import { type WorkspaceKind } from "@exagram/api-client"

import type { EditionModule } from "@/edition/edition.port"

import { SETTINGS_TABS, type SettingsTab } from "@/routes/paths"

/**
 * Tabs the frame draws itself; any other tab exists only when the edition supplies its page. Notifications shows only
 * where the edition has `notificationSettings`.
 */
const FRAME_TABS: readonly SettingsTab[] = ["general", "team", "audit", "notifications"]

/** The Team list, redaction and Audit belong to a Team, so a Personal Workspace leaves their tabs out. */
const TEAM_ONLY_TABS: readonly SettingsTab[] = ["team", "security", "audit"]

export const ACCOUNT_SETTINGS_TABS: readonly SettingsTab[] = ["notifications"]

const teamOnly = (tab: SettingsTab, canCreateTeam: boolean) =>
	TEAM_ONLY_TABS.includes(tab) && !(tab === "team" && canCreateTeam)

/** Security holds only redaction, so it also goes while redaction is switched off. */
export const visibleSettingsTabs = (
	edition: Pick<EditionModule, "settingsPages" | "notificationSettings">,
	{
		redaction,
		kind,
		canCreateTeam = false,
	}: { redaction: boolean; kind: WorkspaceKind | undefined; canCreateTeam?: boolean },
): readonly SettingsTab[] =>
	kind === undefined
		? []
		: SETTINGS_TABS.filter(
				(tab) =>
					(FRAME_TABS.includes(tab) || edition.settingsPages[tab] !== undefined) &&
					!(!edition.notificationSettings && tab === "notifications") &&
					!(!redaction && tab === "security") &&
					!(kind === "personal" && teamOnly(tab, canCreateTeam)),
			)

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
	general: "General",
	team: "Team",
	notifications: "Notifications",
	security: "Security",
	audit: "Audit",
}

export const isSettingsTab = (value: string | undefined): value is SettingsTab =>
	value !== undefined && (SETTINGS_TABS as readonly string[]).includes(value)

/** The tab a `/settings/<tab>` path names, or `null` for any other path (an unknown tab included). */
export const settingsTabOf = (pathname: string): SettingsTab | null => {
	const match = /^\/settings\/([^/]+)\/?$/.exec(pathname)
	const tab = match?.[1]
	return isSettingsTab(tab) ? tab : null
}
