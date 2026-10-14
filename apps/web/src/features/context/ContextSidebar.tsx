import { useLocation } from "react-router"

import { SidebarCount, SidebarLink } from "@/components/sidebar/SidebarLink"
import { IconCalendar } from "@/components/ui/icons"
import { SectionLabel } from "@/components/ui/Mono"
import { ageInDays, inWeek, RECAP_WEEKS, weekFromSearch, weekLabel } from "@/features/context/recap"
import { useRecapSource } from "@/features/context/useRecapSource"
import { paths } from "@/routes/paths"

const TAGS = ["This week", "Last week"]

/**
 * The sidebar's Context body: one row per week, newest first, each with the number of
 * artifacts that arrived in it. The selected week lives in the URL (`/context?week=2`), so the page and
 * this list agree and a week can be linked.
 */
export const ContextSidebar = () => {
	const location = useLocation()
	const { status, files, rowFiles, today } = useRecapSource()
	const onContext = location.pathname === paths.context
	const selected = onContext ? weekFromSearch(new URLSearchParams(location.search)) : null
	const counted = rowFiles ?? files

	return (
		<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "16px 12px 12px" }}>
			<SectionLabel variant="sidebar" style={{ margin: "4px 8px 6px 10px" }}>
				Weekly recap
			</SectionLabel>
			<nav aria-label="Weeks" className="flex flex-col" style={{ gap: 1 }}>
				{Array.from({ length: RECAP_WEEKS }, (_, week) => {
					const tag = TAGS[week]
					// No count until the library answers, so the sample never stands in for a loading workspace.
					const count =
						status === "ready" ? counted.filter((file) => inWeek(ageInDays(file.updated), week)).length : null
					return (
						<SidebarLink
							key={week}
							active={selected === week}
							to={paths.contextWeek(week)}
							icon={<IconCalendar size={16} className="flex-none text-muted" />}
							trailing={count === null ? null : <SidebarCount>{count}</SidebarCount>}
						>
							<span className="whitespace-nowrap">{weekLabel(today, week)}</span>
							{tag ? (
								<span
									className="inline-flex flex-none items-center bg-hover text-muted"
									style={{ height: 18, padding: "0 6px", fontSize: 11, fontWeight: 500, marginLeft: 2 }}
								>
									{tag}
								</span>
							) : null}
						</SidebarLink>
					)
				})}
			</nav>
			{status === "error" ? (
				<p role="alert" className="text-danger" style={{ padding: "8px 10px", fontSize: 13 }}>
					Could not load the weeks&apos; artifacts.
				</p>
			) : null}
		</div>
	)
}
