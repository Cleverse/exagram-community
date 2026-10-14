import { type DragEvent, useEffect, useRef, useState } from "react"
import { Link, Outlet, useLocation } from "react-router"

import { AccountMenu } from "@/components/sidebar/AccountMenu"
import {
	RAIL_WIDTH,
	SETTINGS_SIDEBAR_WIDTH,
	SIDEBAR_WIDTH,
	SidebarWidthContext,
} from "@/components/sidebar/sidebarWidth"
import { BrandMark } from "@/components/ui/BrandMark"
import { IconButton } from "@/components/ui/IconButton"
import { IconSearch, IconSidebar, IconUpload } from "@/components/ui/icons"
import { UnderlineNav } from "@/components/ui/UnderlineNav"
import { InboxButton } from "@/features/activity/InboxButton"
import { useMe } from "@/features/auth/hooks/useMe"
import { useLinkNotice } from "@/features/auth/useLinkNotice"
import { ContextSidebar } from "@/features/context/ContextSidebar"
import { useDragState } from "@/features/library/dragState"
import { useProjects } from "@/features/library/hooks/useProjects"
import { LibraryActionsProvider } from "@/features/library/LibraryActions"
import { LibrarySidebar } from "@/features/library/LibrarySidebar"
import { useLibraryActions } from "@/features/library/useLibraryActions"
import { SettingsSidebar } from "@/features/settings/SettingsSidebar"
import { settingsTabOf } from "@/features/settings/settingsTabs"
import { WorkspaceSwitcher } from "@/features/workspace/WorkspaceSwitcher"
import { paths, projectIdOf } from "@/routes/paths"

type Section = "artifacts" | "context"

const SECTIONS: { value: Section; label: string; to: string }[] = [
	{ value: "artifacts", label: "Artifacts", to: paths.library },
	{ value: "context", label: "Context", to: paths.context },
]

/**
 * The section a path belongs to. Connections lights no section (the prototype's `navTabs`) but
 * keeps the Artifacts body beside it. Settings replaces the whole sidebar (`isSettingsPath`).
 */
const sectionOf = (pathname: string): Section | null => {
	if (pathname === paths.context) return "context"
	if (pathname === paths.connections) return null
	return "artifacts"
}

/** Settings has its own full-page shell: its sidebar stands in for the app's (plan V2). */
const isSettingsPath = (pathname: string) => pathname === "/settings" || pathname.startsWith("/settings/")

/** A file dragged in from the desktop, as opposed to an Artifact row dragged inside the app. */
const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files")

/**
 * The veil over the whole frame while a desktop file is dragged in, naming where a drop lands. It never takes
 * the pointer, so a Project row in the sidebar still highlights and catches its own drop.
 */
const DropOverlay = ({ target }: { target: string }) => (
	<div
		aria-hidden
		className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
		style={{
			background: "rgba(250, 251, 253, 0.82)",
			border: "2px dashed var(--color-ink)",
			animation: "fadeIn 140ms var(--ease-arrive)",
		}}
	>
		<div className="flex flex-col items-center text-center" style={{ gap: 10 }}>
			<IconUpload size={28} className="text-ink" />
			<div className="font-display text-ink" style={{ fontSize: 20, fontWeight: 700 }}>
				Drop to upload
			</div>
			<div className="text-muted" style={{ fontSize: 14 }}>
				{target}
			</div>
		</div>
	</div>
)

const COLLAPSED_KEY = "exagram.sidebarCollapsed"

const readCollapsed = () => {
	try {
		return window.localStorage.getItem(COLLAPSED_KEY) === "1"
	} catch {
		return false
	}
}

const writeCollapsed = (collapsed: boolean) => {
	try {
		if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, "1")
		else window.localStorage.removeItem(COLLAPSED_KEY)
	} catch {
		// Storage can be off (private mode, blocked site data); the sidebar then just forgets across reloads.
	}
}

const reducedMotion = () =>
	typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The app's frame: no top bar, a 240px sidebar and the main area beside it, edge to edge with a 1px `pane-line`
 * between them, both the viewport's height. The sidebar keeps its width while a preview pane is open; collapsing it
 * leaves the 56px rail, and that choice survives a reload.
 */
export const AppShell = () => (
	<LibraryActionsProvider>
		<ShellFrame />
	</LibraryActionsProvider>
)

const ShellFrame = () => {
	const me = useMe()
	const actions = useLibraryActions()
	const location = useLocation()
	const mainRef = useRef<HTMLElement>(null)
	const [collapsed, setCollapsed] = useState(readCollapsed)
	const draggingRow = useDragState().dragged !== null
	const projects = useProjects()
	// dragenter and dragleave fire for every child crossed, so the veil counts them rather than toggling.
	const dragDepth = useRef(0)
	const [dragging, setDragging] = useState(false)
	const routeProject = projects.data?.find((candidate) => candidate.id === projectIdOf(location.pathname))
	const dropTarget = routeProject
		? `Into ${routeProject.name} — or onto a folder in the sidebar`
		: "Into All artifacts — or onto a folder in the sidebar"
	const endDrag = () => {
		dragDepth.current = 0
		setDragging(false)
	}
	// Where "Back to Exagram" returns: the last app route before Settings opened, or All artifacts when the
	// session started in Settings.
	const [lastAppRoute, setLastAppRoute] = useState<string>(paths.library)
	const inSettings = isSettingsPath(location.pathname)
	const appRoute = `${location.pathname}${location.search}`
	if (!inSettings && appRoute !== lastAppRoute) setLastAppRoute(appRoute)

	useLinkNotice()

	// A new screen arrives with the prototype's page-in. A preview lives in the query string, so
	// opening or closing one keeps the path and does not count as a switch.
	const pageKey = location.pathname
	const lastPageKey = useRef(pageKey)
	useEffect(() => {
		if (lastPageKey.current === pageKey) return
		lastPageKey.current = pageKey
		const main = mainRef.current
		if (!main) return
		// A new screen starts at its top, not wherever the last one was scrolled to.
		main.scrollTop = 0
		if (typeof main.animate !== "function" || reducedMotion()) return
		main.animate(
			[
				{ opacity: 0, transform: "scale(.988)" },
				{ opacity: 1, transform: "none" },
			],
			{
				duration: 300,
				easing: "cubic-bezier(.22,.61,.36,1)",
			},
		)
	}, [pageKey])

	const setSidebarCollapsed = (next: boolean) => {
		setCollapsed(next)
		writeCollapsed(next)
	}

	const section = sectionOf(location.pathname)

	return (
		<SidebarWidthContext.Provider value={inSettings ? SETTINGS_SIDEBAR_WIDTH : collapsed ? RAIL_WIDTH : SIDEBAR_WIDTH}>
			{/* A file dropped anywhere — sidebar, rail or screen — uploads instead of the browser opening it. A
			    Project row in the sidebar catches its own drop first and uploads into that Project. */}
			<div
				className="relative flex overflow-hidden bg-white"
				style={{ height: "100vh" }}
				onDragEnter={(event) => {
					if (!carriesFiles(event)) return
					dragDepth.current += 1
					// An open dialog has its own drop zone (Upload); the veil would only cover it.
					if (!document.querySelector('[role="dialog"]')) setDragging(true)
				}}
				onDragLeave={(event) => {
					if (!carriesFiles(event)) return
					dragDepth.current = Math.max(0, dragDepth.current - 1)
					if (dragDepth.current === 0) setDragging(false)
				}}
				onDragOver={(event) => {
					if (carriesFiles(event)) event.preventDefault()
				}}
				onDrop={(event) => {
					endDrag()
					// A drop zone inside (the Upload dialog, a Project row) already took this one.
					if (event.defaultPrevented) return
					const files = Array.from(event.dataTransfer.files)
					if (files.length === 0) return
					event.preventDefault()
					actions.uploadFiles(files)
				}}
			>
				{dragging ? <DropOverlay target={dropTarget} /> : null}
				{inSettings ? (
					<SettingsSidebar
						backTo={lastAppRoute}
						organization={me.data?.workspaceName ?? ""}
						current={settingsTabOf(location.pathname)}
					/>
				) : collapsed ? (
					<aside
						aria-label="Collapsed sidebar"
						className="relative flex flex-none flex-col items-center border-r border-pane-line bg-sidebar"
						style={{ width: RAIL_WIDTH, padding: "20px 0 14px" }}
					>
						<IconButton
							size={36}
							title="Expand sidebar"
							aria-label="Expand sidebar"
							aria-expanded={false}
							onClick={() => setSidebarCollapsed(false)}
						>
							<IconSidebar size={16} />
						</IconButton>
						<IconButton
							size={36}
							title="Search"
							aria-label="Search"
							onClick={actions.openSearch}
							style={{ marginTop: 6 }}
						>
							<IconSearch size={16} />
						</IconButton>
						<div style={{ marginTop: 6 }}>
							<InboxButton size={36} />
						</div>
						<div className="flex-1" />
						<AccountMenu compact />
					</aside>
				) : (
					<aside
						aria-label="Library sidebar"
						className="relative flex flex-none flex-col border-r border-pane-line bg-sidebar"
						style={{ width: SIDEBAR_WIDTH }}
					>
						<div className="flex-none" style={{ padding: "22px 20px 0" }}>
							{/* Mark 18 + 8 + name 84 + 4 + three 28px buttons = 198 of the 200px inside: the name never truncates. */}
							<div className="flex items-center" style={{ gap: 4 }}>
								<Link to={paths.library} className="flex min-w-0 flex-1 items-center text-ink" style={{ gap: 8 }}>
									<BrandMark />
									<span
										className="font-sans whitespace-nowrap"
										style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-.012em" }}
									>
										Exagram
									</span>
								</Link>
								<div className="flex flex-none items-center">
									<IconButton size={28} title="Search" aria-label="Search" onClick={actions.openSearch}>
										<IconSearch size={16} />
									</IconButton>
									<InboxButton size={28} />
									<IconButton
										size={28}
										title="Collapse sidebar"
										aria-label="Collapse sidebar"
										aria-expanded
										onClick={() => setSidebarCollapsed(true)}
									>
										<IconSidebar size={16} />
									</IconButton>
								</div>
							</div>
							<WorkspaceSwitcher />
							<UnderlineNav
								ariaLabel="Sections"
								items={SECTIONS.map((item) => ({ to: item.to, label: item.label, active: item.value === section }))}
								style={{ marginTop: 16 }}
							/>
						</div>

						{section === "context" ? <ContextSidebar /> : <LibrarySidebar />}

						<div className="flex-none bg-pane-line" style={{ height: 1, margin: "0 20px" }} />
						<div className="flex-none" style={{ padding: "10px 12px 14px" }}>
							<AccountMenu />
						</div>
					</aside>
				)}

				<div className="relative flex min-w-0 flex-1">
					<main ref={mainRef} className="relative min-w-0 flex-1 overflow-y-auto" style={{ height: "100vh" }}>
						<Outlet />
					</main>
					{/* While a file row is dragged, a dashed border rings the whole content area. */}
					{draggingRow ? (
						<div
							aria-hidden
							className="pointer-events-none absolute"
							style={{ inset: 3, border: "2px dashed var(--color-drop)", borderRadius: 8, zIndex: 40 }}
						/>
					) : null}
				</div>
			</div>
		</SidebarWidthContext.Provider>
	)
}
