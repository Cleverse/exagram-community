import { type Project } from "@exagram/api-client"
import clsx from "clsx"
import { type KeyboardEvent, useEffect, useRef } from "react"
import { useNavigate } from "react-router"

import { IconGrid, IconProjectFolder } from "@/components/ui/icons"
import { menuPosition } from "@/components/ui/menuPosition"
import { type FolderRef } from "@/features/library/previewNav"
import { paths } from "@/routes/paths"

export type Crumb = { name: string; href: string; kind: "list" | "project"; depth: number; current: boolean }

/**
 * The path's levels from the root down (the prototype's `pv.crumbs`): the list at the root — All
 * artifacts, or Shared with me for a Project someone else owns — then each Project from the top one down to
 * the file's own. A file with no Project sits in the list it came from, which is the only level.
 */
export const crumbsFor = ({
	folder,
	projects,
	meId,
}: {
	folder: FolderRef
	projects: Project[]
	meId: string | null
}): Crumb[] => {
	if (folder.kind === "list") return [{ name: folder.name, href: folder.href, kind: "list", depth: 0, current: true }]

	const byId = new Map(projects.map((project) => [project.id, project]))
	const chain: { id: string; name: string }[] = []
	const seen = new Set<string>()
	let at: { id: string; name: string } | undefined = { id: folder.id, name: folder.name }
	while (at && !seen.has(at.id)) {
		seen.add(at.id)
		chain.unshift(at)
		const parentId: string | null = byId.get(at.id)?.parentProjectId ?? null
		const parent: Project | undefined = parentId === null ? undefined : byId.get(parentId)
		at = parent ? { id: parent.id, name: parent.name } : undefined
	}

	const top = byId.get(chain[0]?.id ?? "")
	const shared = top !== undefined && meId !== null && top.ownerId !== meId
	const root: Crumb = shared
		? { name: "Shared with me", href: paths.sharedWithMe, kind: "list", depth: 0, current: false }
		: { name: "All artifacts", href: paths.library, kind: "list", depth: 0, current: false }
	return [
		root,
		...chain.map(
			(project, index): Crumb => ({
				name: project.name,
				href: paths.project(project.id),
				kind: "project",
				depth: index + 1,
				current: index === chain.length - 1,
			}),
		),
	]
}

const WIDTH = 300

/**
 * The path dropdown under the folder crumb: the ancestors top-down, one indent step per level, the
 * current level highlighted. Picking a level leaves the preview for that page. Keyboard follows the menu
 * pattern — focus starts on the current level, ↑ ↓ Home End move, Escape closes (claimed, so the pane's
 * own Escape leaves it alone) and hands focus back to the crumb.
 */
export const PathMenu = ({ anchor, crumbs, onClose }: { anchor: DOMRect; crumbs: Crumb[]; onClose: () => void }) => {
	const navigate = useNavigate()
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
		const current = menuRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
		;(current ?? items?.[0])?.focus()
		return () => {
			if (opener?.isConnected) opener.focus()
		}
	}, [])

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return
			event.preventDefault()
			onClose()
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [onClose])

	const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
		const index = items.indexOf(document.activeElement as HTMLElement)
		const next =
			event.key === "ArrowDown"
				? (index + 1) % items.length
				: event.key === "ArrowUp"
					? (index - 1 + items.length) % items.length
					: event.key === "Home"
						? 0
						: event.key === "End"
							? items.length - 1
							: null
		if (next === null) return
		event.preventDefault()
		items[next]?.focus()
	}

	const position = menuPosition(anchor, "down", WIDTH, { width: window.innerWidth, height: window.innerHeight })

	return (
		<>
			<div aria-hidden className="fixed inset-0" style={{ zIndex: 30 }} onClick={onClose} />
			<div
				ref={menuRef}
				role="menu"
				aria-label="Folder path"
				onKeyDown={onMenuKeyDown}
				className="fixed flex flex-col overflow-auto bg-panel"
				style={{
					...position,
					zIndex: 31,
					minWidth: 200,
					maxWidth: WIDTH,
					gap: 2,
					padding: 6,
					border: "1px solid var(--color-line-faint)",
					borderRadius: 10,
					boxShadow: "0 12px 32px rgba(23,25,35,.14)",
					animation: "fadeUp 200ms var(--ease-arrive)",
				}}
			>
				{crumbs.map((crumb) => (
					<button
						key={crumb.href}
						type="button"
						role="menuitem"
						aria-current={crumb.current ? "page" : undefined}
						onClick={() => {
							onClose()
							void navigate(crumb.href)
						}}
						className={clsx(
							"flex w-full flex-none items-center text-left text-ink focus-visible:outline-none",
							crumb.current ? "bg-row-selected" : "hover:bg-row-hover focus-visible:bg-row-hover",
						)}
						style={{
							gap: 10,
							height: 34,
							padding: `0 10px 0 ${10 + crumb.depth * 12}px`,
							borderRadius: "var(--radius)",
							fontSize: 14,
							fontWeight: crumb.current ? 600 : 400,
						}}
					>
						{crumb.kind === "list" ? (
							<IconGrid size={15} className="flex-none text-secondary" />
						) : (
							<IconProjectFolder size={15} className="flex-none" />
						)}
						<span className="min-w-0 truncate">{crumb.name}</span>
					</button>
				))}
			</div>
		</>
	)
}
