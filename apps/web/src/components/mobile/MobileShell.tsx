import { useCallback, useEffect, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router"

import { NAV_CLOSE_MS, NavDrawer } from "@/components/mobile/NavDrawer"
import { HeaderIconButton } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { listen as listenForLayerBack } from "@/components/mobile/sheet/history"
import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { SheetProvider } from "@/components/mobile/sheet/SheetProvider"
import { type SheetKind } from "@/components/mobile/sheet/types"
import { BrandMark } from "@/components/ui/BrandMark"
import { IconMenu, IconSearch } from "@/components/ui/icons"
import { InboxBell } from "@/features/activity/InboxBell"
import { useMe } from "@/features/auth/hooks/useMe"
import { useGoogleNotice } from "@/features/auth/useGoogleNotice"
import { LibraryActionsProvider } from "@/features/library/LibraryActions"
import { paths, previewIdOf } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"

/**
 * The screens that sit under the top bar (README "Tab bar": Artifacts, Chat, Recap). Every other screen is
 * pushed and draws its own `PushHeader`.
 */
export const ROOT_TITLES: Record<string, string> = {
	[paths.library]: "Artifacts",
	[paths.sharedWithMe]: "Artifacts",
	[paths.mine]: "Artifacts",
	[paths.projects]: "Projects",
	[paths.context]: "Weekly recap",
}

const reducedMotion = () =>
	typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** The 56px top bar on a root screen (W:L56–67): menu, logo, title, bell, search, account. */
const TopBar = ({ title, onMenu }: { title: string; onMenu: () => void }) => {
	const sheet = useSheet()
	const me = useMe()
	return (
		<header
			className="flex flex-none items-center border-b border-row-line bg-white"
			style={{ gap: 2, height: 56, padding: "0 8px" }}
		>
			<HeaderIconButton label="Menu" onClick={onMenu}>
				<IconMenu size={21} />
			</HeaderIconButton>
			<div style={{ margin: "0 8px 0 2px" }}>
				<BrandMark cell={4} />
			</div>
			<h1 className="m-0 min-w-0 flex-1 truncate" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.012em" }}>
				{title}
			</h1>
			<InboxBell />
			<HeaderIconButton label="Search" onClick={() => sheet.open("search", {})}>
				<IconSearch size={20} />
			</HeaderIconButton>
			<button
				type="button"
				aria-label="Account"
				onClick={() => sheet.open("account", {})}
				className="grid flex-none place-items-center"
				style={{ width: 44, height: 44 }}
			>
				<span
					className="grid place-items-center bg-accent text-white"
					style={{ width: 30, height: 30, borderRadius: "50%", fontSize: 11.5, fontWeight: 600 }}
				>
					{initialsOf(me.data?.name, me.data?.email)}
				</span>
			</button>
		</header>
	)
}

const Frame = () => {
	const location = useLocation()
	const navigate = useNavigate()
	const sheet = useSheet()
	const [nav, setNav] = useState<"closed" | "open" | "closing">("closed")
	const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useGoogleNotice()

	// Listen for Back from the start, so a drawer entry left by a reload is cleaned up before the first Back.
	useEffect(() => listenForLayerBack(), [])

	// A phone has no room for a preview beside a list, so `?preview=` opens the file's own page.
	const previewId = previewIdOf(location.search)
	useEffect(() => {
		if (previewId !== null) void navigate(paths.artifact(previewId), { replace: true })
	}, [previewId, navigate])

	const closeNav = useCallback(() => {
		if (navTimer.current !== null) clearTimeout(navTimer.current)
		if (reducedMotion()) {
			setNav("closed")
			return
		}
		setNav("closing")
		navTimer.current = setTimeout(() => setNav("closed"), NAV_CLOSE_MS)
	}, [])

	// Picking a place in the drawer navigates; the drawer then steps out of the way.
	const pathname = location.pathname
	const lastPathname = useRef(pathname)
	useEffect(() => {
		if (lastPathname.current === pathname) return
		lastPathname.current = pathname
		if (navTimer.current !== null) clearTimeout(navTimer.current)
		setNav("closed")
	}, [pathname])

	useEffect(
		() => () => {
			if (navTimer.current !== null) clearTimeout(navTimer.current)
		},
		[],
	)

	const title = ROOT_TITLES[pathname]

	return (
		// Pinned to the whole viewport. With `viewport-fit=cover` that runs under iOS 26 Safari's floating toolbar,
		// so content reaches the bottom of the screen; the status bar's inset is kept clear at the top, and each
		// screen keeps its last row clear of the toolbar (MobileScreen). Older iOS reports no insets here.
		<div
			className="fixed inset-0 flex flex-col overflow-hidden bg-white"
			style={{ paddingTop: "env(safe-area-inset-top)" }}
		>
			{title ? <TopBar title={title} onMenu={() => setNav("open")} /> : null}
			<main className="relative min-h-0 flex-1 overflow-y-auto">
				<Outlet />
			</main>
			{nav === "closed" ? null : (
				<NavDrawer
					closing={nav === "closing"}
					onClose={closeNav}
					onAccount={() => {
						setNav("closed")
						sheet.open("account", {})
					}}
				/>
			)}
		</div>
	)
}

/**
 * The phone's frame (`docs/design/exagram-mobile/Exagram Mobile Web.dc.html`): a top bar on root screens, the
 * hamburger's nav drawer, and the one bottom drawer. Upload and New project come from the same provider as on
 * desktop, so a file uploaded here lands where the desktop would put it.
 */
export default function MobileShell({ sheets }: { sheets?: Map<SheetKind, SheetLoader> }) {
	return (
		<LibraryActionsProvider>
			<SheetProvider sheets={sheets}>
				<Frame />
			</SheetProvider>
		</LibraryActionsProvider>
	)
}
