import { type Project, type VisibleArtifact } from "@exagram/api-client"
import clsx from "clsx"
import { useState } from "react"

import { useToast } from "@/components/Toast"
import { IconChevronDown } from "@/components/ui/icons"
import { Menu, type MenuItem } from "@/components/ui/Menu"
import { locationLabel, locationOf } from "@/features/activity/location"
import { useMoveArtifact } from "@/features/project/hooks/useProjectMutations"

/**
 * The Activity table's Project › folder cell (T:L1988, menu T:L4219–4223). For the file's Owner it is a
 * 26px button opening every Project they own with its folders set in under it, the present place checked;
 * a choice moves the file with the existing move. Anyone else reads the place as plain text, since a file
 * only moves within its Owner's Projects. A loose file in a Project with folders reads "Unsorted" on the
 * amber Unsorted chip.
 *
 * `compact` is the narrow row's chip (v3 P:1675, with the preview pane open): 22px, 12px, a hairline border,
 * the same menu for the Owner and the same plain text for anyone else.
 */
export const MoveCell = ({
	artifact,
	projects,
	meId,
	compact = false,
}: {
	artifact: VisibleArtifact
	projects: Project[]
	meId: string | null
	compact?: boolean
}) => {
	const move = useMoveArtifact()
	const toast = useToast()
	const [anchor, setAnchor] = useState<DOMRect | null>(null)
	const location = locationOf(artifact.projectId, projects)
	const label = locationLabel(location)

	const content = (
		<>
			<span className="truncate">{location.project === null ? label : location.project.name}</span>
			{location.folder === null ? null : (
				<>
					<span className="flex-none text-muted">›</span>
					<span className="truncate">{location.folder}</span>
				</>
			)}
		</>
	)

	if (artifact.ownerId !== meId) {
		return (
			<span className="inline-flex max-w-full items-center text-muted" style={{ gap: 4, fontSize: compact ? 12 : 13 }}>
				{content}
			</span>
		)
	}

	const owned = projects.filter((project) => project.ownerId === meId)
	const roots = owned.filter((project) => project.parentProjectId === null)
	const items: MenuItem[] = roots.flatMap((root) => [
		{ label: root.name, checked: artifact.projectId === root.id, onSelect: () => moveTo(root) },
		...owned
			.filter((child) => child.parentProjectId === root.id)
			.map((child) => ({
				label: child.name,
				indent: true,
				checked: artifact.projectId === child.id,
				onSelect: () => moveTo(child),
			})),
	])
	// Out of every Project is a place too; the server takes `projectId: null`.
	items.push({
		label: "No project",
		checked: artifact.projectId === null,
		dividerAbove: true,
		onSelect: () => moveTo(null),
	})

	function moveTo(target: Project | null) {
		setAnchor(null)
		if ((target?.id ?? null) === artifact.projectId) return
		const parent =
			target === null || target.parentProjectId === null
				? null
				: projects.find((candidate) => candidate.id === target.parentProjectId)
		const where = target === null ? null : parent ? `${parent.name} › ${target.name}` : target.name
		move.mutate(
			{ artifactId: artifact.id, projectId: target?.id ?? null },
			{
				onSuccess: () =>
					toast(
						where === null
							? `Moved ${artifact.title} out of its project.`
							: `Moved ${artifact.title} to ${where}. Clients in that project read it from the next request.`,
					),
				onError: (error) => toast(`Couldn't move ${artifact.title}. ${error.message}`),
			},
		)
	}

	return (
		<>
			<button
				type="button"
				title="Move to another project or folder"
				aria-label={`Move ${artifact.title}, now in ${label}`}
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				disabled={move.isPending}
				onClick={(event) => {
					event.stopPropagation()
					setAnchor(event.currentTarget.getBoundingClientRect())
				}}
				className={clsx(
					"inline-flex max-w-full items-center whitespace-nowrap transition-colors duration-(--duration-press) ease-(--ease-arrive)",
					compact && "shadow-[inset_0_0_0_1px_var(--color-line)]",
					location.needsFolder ? "bg-unsorted-bg text-pending-fg" : "text-muted hover:bg-press",
				)}
				style={{ gap: 4, height: compact ? 22 : 26, padding: "0 6px", fontSize: compact ? 12 : 13 }}
			>
				{content}
				<IconChevronDown size={10} className="flex-none opacity-35" />
			</button>
			{anchor ? (
				<Menu anchor={anchor} ariaLabel={`Move ${artifact.title}`} onClose={() => setAnchor(null)} items={items} />
			) : null}
		</>
	)
}
