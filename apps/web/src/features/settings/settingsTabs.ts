import { type WorkspaceKind } from "@exagram/api-client"

import type { EditionModule } from "@/edition/edition.port"

import { SETTINGS_TABS, type SettingsTab } from "@/routes/paths"

/** Tabs the frame always has; any other tab exists only when the edition supplies its page. */
const FRAME_TABS: readonly SettingsTab[] = ["general", "team", "audit", "notifications"]

/** The Team list, redaction and Audit belong to a Team, so a Personal Workspace leaves their tabs out. */
const TEAM_ONLY_TABS: readonly SettingsTab[] = ["team", "security", "audit"]

export const ACCOUNT_SETTINGS_TABS: readonly SettingsTab[] = ["notifications"]

/** Security holds only redaction, so it also goes while redaction is switched off. */
export const visibleSettingsTabs = (
	edition: Pick<EditionModule, "settingsPages">,
	{ redaction, kind }: { redaction: boolean; kind: WorkspaceKind },
): readonly SettingsTab[] =>
	SETTINGS_TABS.filter(
		(tab) =>
			(FRAME_TABS.includes(tab) || edition.settingsPages[tab] !== undefined) &&
			!(!redaction && tab === "security") &&
			!(kind === "personal" && TEAM_ONLY_TABS.includes(tab)),
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
