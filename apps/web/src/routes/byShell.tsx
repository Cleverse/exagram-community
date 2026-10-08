import { type ComponentType, lazy, type LazyExoticComponent, type ReactNode, Suspense } from "react"

import { AppShell } from "@/components/AppShell"
import { useShell } from "@/components/mobile/shell"

type Loader = () => Promise<{ default: ComponentType<object> }>

/**
 * Every mobile screen, found by name: `src/features/<area>/<Name>.mobile.tsx` with a default export. A route
 * names its mobile screen as `<area>/<Name>`; until that file exists the route keeps its desktop screen, so a
 * screen lands by adding its file and nothing else.
 */
const MOBILE_SCREENS = import.meta.glob<{ default: ComponentType<object> }>("/src/features/**/*.mobile.tsx")

export const mobileScreenPath = (name: string) => `/src/features/${name}.mobile.tsx`

/** The loader for a mobile screen, or `null` while it has no file. `modules` is injectable for tests. */
export const resolveMobileScreen = (name: string, modules: Record<string, Loader> = MOBILE_SCREENS): Loader | null =>
	modules[mobileScreenPath(name)] ?? null

const lazyScreens = new Map<string, LazyExoticComponent<ComponentType<object>>>()

const lazyScreen = (name: string, load: Loader) => {
	let screen = lazyScreens.get(name)
	if (!screen) {
		screen = lazy(load)
		lazyScreens.set(name, screen)
	}
	return screen
}

/**
 * A route's element: its desktop screen, or on a phone the `<area>/<Name>.mobile.tsx` screen with the same
 * props. Mobile code loads only on a phone, so the desktop bundle never carries it.
 */
export function ByShell<P extends object>({
	desktop: Desktop,
	mobile,
	props,
	modules,
}: {
	desktop: ComponentType<P>
	mobile: string
	props?: P
	modules?: Record<string, Loader>
}): ReactNode {
	const shell = useShell()
	const load = shell === "mobile" ? resolveMobileScreen(mobile, modules) : null
	const screenProps = (props ?? {}) as P
	if (!load) return <Desktop {...screenProps} />
	const Mobile = lazyScreen(mobile, load) as unknown as ComponentType<P>
	return (
		<Suspense fallback={null}>
			<Mobile {...screenProps} />
		</Suspense>
	)
}

const MobileShell = lazy(() => import("@/components/mobile/MobileShell"))

/** The signed-in frame: the desktop sidebar shell, or the mobile top bar and drawers on a phone. */
export const AppFrame = () =>
	useShell() === "mobile" ? (
		<Suspense fallback={null}>
			<MobileShell />
		</Suspense>
	) : (
		<AppShell />
	)
