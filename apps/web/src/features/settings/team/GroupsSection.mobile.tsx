import { type Group } from "@exagram/api-client"

import { useSheet } from "@/components/mobile/sheet/context"
import { IconChevronRight, IconPeople, IconPlus } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { Card, SectionHead } from "@/features/settings/mobileParts"
import { useGroups } from "@/features/settings/team/hooks/useGroups"
import { GROUPS_INTRO, groupsEmpty } from "@/features/settings/team/teamCopy"
import { memberCountLabel } from "@/features/settings/team/teamModel"

const GroupRow = ({ group, admin }: { group: Group; admin: boolean }) => {
	const sheet = useSheet()
	const content = (
		<>
			<span
				aria-hidden
				className="grid flex-none place-items-center bg-subtle text-ink"
				style={{ width: 36, height: 36, borderRadius: "var(--radius)" }}
			>
				<IconPeople size={18} strokeWidth={1.8} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate" style={{ fontSize: 15, fontWeight: 500 }}>
					{group.name}
				</span>
				<span className="block truncate text-muted" style={{ fontSize: 13 }}>
					{memberCountLabel(group.memberCount)}
				</span>
			</span>
		</>
	)
	const rowStyle = { gap: 12, minHeight: 60, padding: "10px 14px" }
	return (
		<li className="border-b border-row-line last:border-b-0">
			{admin ? (
				<button
					type="button"
					aria-label={`Edit ${group.name}`}
					onClick={() => sheet.open("groupEdit", { groupId: group.id })}
					className="flex w-full items-center text-left active:bg-hover"
					style={rowStyle}
				>
					{content}
					<IconChevronRight size={15} className="flex-none text-path-slash" />
				</button>
			) : (
				<div className="flex items-center" style={rowStyle}>
					{content}
				</div>
			)}
		</li>
	)
}

export const GroupsSection = () => {
	const sheet = useSheet()
	const groups = useGroups()
	const list = groups.data
	const admin = list?.view === "admin"

	return (
		<section aria-label="Groups">
			<SectionHead
				count={list?.items.length}
				action={
					admin ? (
						<button
							type="button"
							onClick={() => sheet.open("groupNew", {})}
							className="flex items-center text-ink active:bg-hover"
							style={{ gap: 6, height: 44, padding: "0 10px", margin: "0 -10px 0 0", fontSize: 14, fontWeight: 600 }}
						>
							<IconPlus size={14} strokeWidth={2.4} />
							New group
						</button>
					) : undefined
				}
			>
				Groups
			</SectionHead>
			<p className="m-0 text-muted" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>
				{GROUPS_INTRO}
			</p>
			{groups.isPending ? (
				<SkeletonStatus label="Loading groups…">
					<Skeleton height={120} radius={10} />
				</SkeletonStatus>
			) : groups.isError ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 14 }}>
					{groups.error.message}
				</p>
			) : list && list.items.length === 0 ? (
				<p className="m-0 text-center text-muted" style={{ padding: "20px 0", fontSize: 14 }}>
					{groupsEmpty(admin)}
				</p>
			) : (
				<Card>
					<ul aria-label="Groups" className="m-0 list-none p-0">
						{(list?.items ?? []).map((group) => (
							<GroupRow key={group.id} group={group} admin={admin} />
						))}
					</ul>
				</Card>
			)}
		</section>
	)
}
