import clsx from "clsx"
import { type MouseEvent, type ReactNode, useEffect, useRef } from "react"
import { Link, useLocation } from "react-router"

import { trapTab } from "@/components/mobile/focusTrap"
import { SectionLabel } from "@/components/mobile/primitives"
import { FolderGlyph } from "@/components/mobile/rows"
import { useBackCloses } from "@/components/mobile/sheet/history"
import { BrandMark } from "@/components/ui/BrandMark"
import { IconRecap } from "@/components/ui/icons"
import { IconActivity, IconChevronUp, IconClose, IconGrid, IconPin } from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { useInboxCount } from "@/features/activity/inboxCount"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { usePinned } from "@/features/library/hooks/usePinned"
import { useProjects } from "@/features/library/hooks/useProjects"
import { rootProjects, summarizeProjects } from "@/features/library/projectSummary"
import { useWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { paths, projectIdOf } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"

export const NAV_CLOSE_MS = 220

const LIBRARY_ROOTS: string[] = [paths.library, paths.sharedWithMe, paths.mine]

const NavItem = ({
	to,
	icon,
	label,
	active,
	badge,
	onClick,
}: {
	to: string
	icon: ReactNode
	label: string
	active: boolean
	badge?: number
	onClick: (event: MouseEvent<HTMLAnchorElement>) => void
}) => (
	<Link
		to={to}
		onClick={onClick}
		aria-current={active ? "page" : undefined}
		className={clsx("flex w-full items-center text-ink hover:text-ink", active ? "bg-nav-selected" : "active:bg-hover")}
		style={{ gap: 12, height: 44, padding: "0 10px", borderRadius: 6, fontSize: 15, fontWeight: active ? 600 : 450 }}
	>
		<span className="grid flex-none place-items-center text-secondary" style={{ width: 18, height: 18 }}>
			{icon}
		</span>
		<span className="flex-1">{label}</span>
		{badge ? (
			<span
				className="font-mono text-pending-fg"
				style={{
					fontSize: 11,
					fontWeight: 600,
					background: "rgba(217,134,11,.35)",
					padding: "2px 7px",
					borderRadius: 6,
				}}
			>
				{badge}
			</span>
		) : null}
	</Link>
)

/**
 * The hamburger's 300px drawer from the left (W:L563–613): the web variant's only navigation, standing in for
 * a tab bar. Activity, All artifacts and Weekly recap, then PINNED and PROJECTS, and the account at the foot.
 * Chat joins the list when Chat ships.
 */
export const NavDrawer = ({
	closing,
	onClose,
	onAccount,
}: {
	closing: boolean
	onClose: () => void
	onAccount: () => void
}) => {
	const location = useLocation()
	const me = useMe()
	const projects = useProjects()
	const everything = useArtifacts({ scope: "all" })
	const pinned = usePinned()
	const inbox = useInboxCount()
	const closeRef = useRef<HTMLButtonElement>(null)
	const asideRef = useRef<HTMLElement>(null)

	// Browser and Android Back close the menu rather than leave the screen under it.
	useBackCloses(!closing, onClose)

	useEffect(() => {
		closeRef.current?.focus()
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose()
			else if (event.key === "Tab" && asideRef.current) trapTab(asideRef.current, event)
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [onClose])

	const artifacts = everything.data ?? []
	const all = projects.data ?? []
	const roots = rootProjects(all)
	const { countFor } = summarizeProjects(all, artifacts, me.data?.id)
	const pinnedArtifacts = artifacts.filter((artifact) => pinned.isPinned(artifact.id))
	const activeProjectId = projectIdOf(location.pathname)
	const organization = me.data?.workspaceName ?? ""
	const line = edition.accountLine(useWorkspaceKind(), organization)
	// A tap on the screen already showing just closes the menu. Following the link would replace the menu's
	// history entry (a same-path Link replaces) and leave the menu open over a dead Back step.
	const stayOrGo = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
		if (to.split("?")[0] !== location.pathname) return
		event.preventDefault()
		onClose()
	}

	return (
		<>
			<div
				aria-hidden
				data-testid="nav-scrim"
				onClick={onClose}
				className="fixed inset-0"
				style={{
					zIndex: 84,
					background: "var(--color-scrim)",
					animation: closing ? `m-fade-out ${NAV_CLOSE_MS}ms forwards` : "m-fade-in 240ms",
				}}
			/>
			<aside
				ref={asideRef}
				role="dialog"
				aria-modal="true"
				aria-label="Navigation"
				className="fixed flex flex-col bg-sidebar"
				style={{
					left: 0,
					top: 0,
					bottom: 0,
					width: 300,
					maxWidth: "85vw",
					zIndex: 85,
					boxShadow: "12px 0 40px rgba(23,25,35,.18)",
					paddingTop: "env(safe-area-inset-top)",
					animation: closing
						? `m-nav-out ${NAV_CLOSE_MS}ms cubic-bezier(.4,0,1,1) forwards`
						: "m-nav-in 280ms var(--ease-arrive)",
				}}
			>
				<div className="flex-none" style={{ padding: "18px 20px 12px" }}>
					<div className="flex items-center" style={{ gap: 10 }}>
						<BrandMark />
						<div className="flex-1" style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-.012em" }}>
							Exagram
						</div>
						<button
							ref={closeRef}
							type="button"
							aria-label="Close menu"
							onClick={onClose}
							className="grid place-items-center text-secondary active:bg-hover"
							style={{ width: 40, height: 40, marginRight: -8 }}
						>
							<IconClose size={18} />
						</button>
					</div>
					{line ? (
						<div className="truncate text-muted" style={{ fontSize: 13, marginTop: 2 }}>
							{line}
						</div>
					) : null}
				</div>

				<nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "4px 12px 12px" }}>
					<NavItem
						to={paths.activity}
						onClick={stayOrGo(paths.activity)}
						icon={<IconActivity size={17} />}
						label="Activity"
						active={location.pathname === paths.activity}
						badge={inbox}
					/>
					<NavItem
						to={paths.library}
						onClick={stayOrGo(paths.library)}
						icon={<IconGrid size={17} />}
						label="All artifacts"
						active={LIBRARY_ROOTS.includes(location.pathname)}
					/>
					<NavItem
						to={paths.context}
						onClick={stayOrGo(paths.context)}
						icon={<IconRecap size={17} />}
						label="Weekly recap"
						active={location.pathname === paths.context}
					/>

					{pinnedArtifacts.length > 0 ? (
						<>
							<SectionLabel style={{ padding: 0, margin: "18px 10px 6px" }}>Pinned</SectionLabel>
							{pinnedArtifacts.map((artifact) => (
								<Link
									key={artifact.id}
									to={paths.artifact(artifact.id)}
									onClick={stayOrGo(paths.artifact(artifact.id))}
									className="flex w-full items-center text-body hover:text-body active:bg-hover"
									style={{ gap: 12, height: 40, padding: "0 10px", borderRadius: 6, fontSize: 14 }}
								>
									<IconPin size={15} fill="currentColor" className="flex-none text-ink" />
									<span className="min-w-0 flex-1 truncate">{artifact.title}</span>
								</Link>
							))}
						</>
					) : null}

					<SectionLabel style={{ padding: 0, margin: "18px 10px 6px" }}>
						<Link to={paths.projects} onClick={stayOrGo(paths.projects)} className="text-inherit hover:text-inherit">
							Projects
						</Link>
					</SectionLabel>
					{roots.map((project) => {
						const active = project.id === activeProjectId
						return (
							<Link
								key={project.id}
								to={paths.project(project.id)}
								onClick={stayOrGo(paths.project(project.id))}
								aria-current={active ? "page" : undefined}
								className={clsx(
									"flex w-full items-center text-ink hover:text-ink",
									active ? "bg-nav-selected" : "active:bg-hover",
								)}
								style={{
									gap: 12,
									height: 40,
									padding: "0 10px",
									borderRadius: 6,
									fontSize: 14,
									fontWeight: active ? 600 : 450,
								}}
							>
								<FolderGlyph size={17} />
								<span className="min-w-0 flex-1 truncate">{project.name}</span>
								<span className="font-mono text-muted-2" style={{ fontSize: 11.5 }}>
									{countFor(project.id)}
								</span>
							</Link>
						)
					})}
				</nav>

				<button
					type="button"
					onClick={onAccount}
					className="flex flex-none items-center border-t border-row-line text-left active:bg-hover"
					style={{
						gap: 10,
						padding: "12px 20px",
						paddingBottom: "max(16px, env(safe-area-inset-bottom))",
						borderRadius: 0,
					}}
				>
					<span
						className="grid flex-none place-items-center bg-accent text-white"
						style={{ width: 32, height: 32, borderRadius: "50%", fontSize: 12, fontWeight: 600 }}
					>
						{initialsOf(me.data?.name, me.data?.email)}
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate" style={{ fontSize: 14, fontWeight: 500 }}>
							{me.data?.name}
						</span>
						<span className="block truncate text-muted-2" style={{ fontSize: 12 }}>
							{organization}
						</span>
					</span>
					<IconChevronUp size={15} className="text-muted-2" />
				</button>
			</aside>
		</>
	)
}
