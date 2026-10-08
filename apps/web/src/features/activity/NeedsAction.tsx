import { Link } from "react-router"

import { SectionLabel } from "@/components/ui/Mono"
import { type NeedsActionGroup } from "@/features/activity/needsActionGroups"
import { AwaitingApprovalBlock } from "@/features/approvals/AwaitingApprovalBlock"
import { publishPolicyLabel } from "@/features/project/publishPolicy"
import { paths } from "@/routes/paths"

/**
 * "Needs your action" (T:L1952–1969): the pending Revisions this reader approves, grouped by the top-level
 * Project their file sits in. Each group is headed by a 6px marigold square, the Project's name (a link to
 * it), the count and the Project's publish rule, and is a region named "<project> approvals"; a row in a
 * folder names it ("› Pricing").
 */
export const NeedsAction = ({ groups, wide }: { groups: NeedsActionGroup[]; wide: boolean }) => {
	if (groups.length === 0) return null
	const total = groups.reduce((sum, group) => sum + group.count, 0)

	return (
		<div>
			<div className="flex items-baseline" style={{ gap: 8, padding: "20px 8px 4px" }}>
				<SectionLabel as="h2" className="text-ink" style={{ margin: 0 }}>
					Needs your action
				</SectionLabel>
				<span className="font-mono text-muted" style={{ fontSize: 11 }}>
					{total}
				</span>
			</div>
			{groups.map((group) => {
				const name = group.project?.name ?? "No project"
				return (
					<section key={group.project?.id ?? "none"} aria-label={`${name} approvals`}>
						<div
							className="flex items-center overflow-hidden whitespace-nowrap text-muted"
							style={{ gap: 8, padding: "10px 8px 6px", fontSize: 12 }}
						>
							<span aria-hidden className="flex-none bg-marigold" style={{ width: 6, height: 6 }} />
							{group.project ? (
								<Link
									to={paths.project(group.project.id)}
									className="text-secondary hover:text-link-hover"
									style={{ fontWeight: 600 }}
								>
									{name}
								</Link>
							) : (
								<span className="text-secondary" style={{ fontWeight: 600 }}>
									{name}
								</span>
							)}
							<span className="truncate">
								{`· ${group.count} ${group.count === 1 ? "revision" : "revisions"}`}
								{group.project ? ` · ${publishPolicyLabel(group.project.publishPolicy)}` : null}
							</span>
						</div>
						<AwaitingApprovalBlock artifacts={group.artifacts} folders={group.folders} heading={false} wide={wide} />
					</section>
				)
			})}
		</div>
	)
}
