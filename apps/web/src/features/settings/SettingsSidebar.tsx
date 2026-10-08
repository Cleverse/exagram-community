import clsx from "clsx"
import { Link } from "react-router"

import { SETTINGS_SIDEBAR_WIDTH } from "@/components/sidebar/sidebarWidth"
import { GapLine } from "@/components/ui/GapLine"
import { IconArrowLeft } from "@/components/ui/icons"
import { SectionLabel } from "@/components/ui/Mono"
import { edition } from "@/edition/edition"
import { ACCOUNT_SETTINGS_TABS, SETTINGS_TAB_LABEL, visibleSettingsTabs } from "@/features/settings/settingsTabs"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths, type SettingsTab } from "@/routes/paths"

/**
 * The sidebar Settings shows in place of the app's (plan V2, built to v3's values): 250px on `sidebar`
 * with the gapped right divider, "Back to Exagram" to the app route Settings was opened from, "Settings"
 * at 22px/700 over the Workspace line, then one 34px, 14px link per tab, the current one on
 * `nav-selected` at 500.
 */
export const SettingsSidebar = ({
	backTo,
	organization,
	current,
}: {
	backTo: string
	organization: string
	/** The tab on show; `null` on an address that names no tab. */
	current: SettingsTab | null
}) => {
	const kind = useWorkspaceKind()
	const line = edition.accountLine(kind, organization)
	const tabs = visibleSettingsTabs(edition, { redaction: edition.useRedactionCapability() === "enabled", kind })
	const workspaceTabs = tabs.filter((tab) => !ACCOUNT_SETTINGS_TABS.includes(tab))
	const accountTabs = tabs.filter((tab) => ACCOUNT_SETTINGS_TABS.includes(tab))
	return (
		<aside
			aria-label="Settings sidebar"
			className="relative flex flex-none flex-col bg-sidebar"
			style={{ width: SETTINGS_SIDEBAR_WIDTH }}
		>
			<GapLine side="right" />
			<div className="flex-none" style={{ padding: "22px 20px 0" }}>
				<Link
					to={backTo}
					className="inline-flex items-center text-secondary transition-colors duration-(--duration-row) ease-(--ease-arrive) hover:text-ink"
					style={{ gap: 8, fontSize: 14, fontWeight: 500 }}
				>
					<IconArrowLeft className="flex-none" />
					Back to Exagram
				</Link>
				<div
					className="font-display text-ink"
					style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-.012em", marginTop: 20 }}
				>
					Settings
				</div>
				{line ? (
					<div className="truncate text-muted" style={{ fontSize: 13, marginTop: 2 }}>
						{line}
					</div>
				) : null}
			</div>
			<nav aria-label="Settings" className="flex flex-col" style={{ gap: 2, padding: "18px 12px 0" }}>
				{workspaceTabs.map((tab) => (
					<TabLink key={tab} tab={tab} active={tab === current} />
				))}
				{accountTabs.length > 0 ? (
					<SectionLabel variant="sidebar" style={{ margin: "18px 8px 6px 10px" }}>
						Your account
					</SectionLabel>
				) : null}
				{accountTabs.map((tab) => (
					<TabLink key={tab} tab={tab} active={tab === current} />
				))}
			</nav>
		</aside>
	)
}

const TabLink = ({ tab, active }: { tab: SettingsTab; active: boolean }) => (
	<Link
		to={paths.settings(tab)}
		aria-current={active ? "page" : undefined}
		className={clsx(
			"flex items-center text-body transition-colors duration-(--duration-row) ease-(--ease-arrive)",
			active ? "bg-nav-selected" : "hover:bg-hover",
		)}
		style={{
			height: 34,
			padding: "0 10px",
			borderRadius: "var(--radius)",
			fontSize: 14,
			fontWeight: active ? 500 : 400,
		}}
	>
		{SETTINGS_TAB_LABEL[tab]}
	</Link>
)
