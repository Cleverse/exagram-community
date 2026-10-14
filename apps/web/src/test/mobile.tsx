import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderResult } from "@testing-library/react"
import { type ReactNode } from "react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { vi } from "vitest"

import { type SheetLoader } from "@/components/mobile/sheet/registry"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { SheetProvider } from "@/components/mobile/sheet/SheetProvider"
import { SHEET_KINDS, type SheetKind } from "@/components/mobile/sheet/types"
import { MOBILE_QUERY } from "@/components/mobile/shell"
import { ToastProvider } from "@/components/Toast"
import { QueryKeys } from "@/config/queryKeys"
import { LibraryActionsProvider } from "@/features/library/LibraryActions"
import { sessionIn } from "@/test/workspaces"

type Listener = (event: { matches: boolean }) => void

/**
 * Stands in for `window.matchMedia` at a given width: the mobile breakpoint answers from `width`, reduced
 * motion from `reducedMotion` (on by default, so drawers close at once in tests). `resize` moves the width and
 * tells listeners, as crossing the breakpoint would.
 */
export const mockViewport = (width: number, { reducedMotion = true }: { reducedMotion?: boolean } = {}) => {
	let current = width
	const listeners = new Set<Listener>()
	const matches = (query: string) => {
		if (query === MOBILE_QUERY) return current <= 767
		if (query.includes("prefers-reduced-motion")) return reducedMotion
		return false
	}
	const matchMedia = vi.fn((query: string) => ({
		get matches() {
			return matches(query)
		},
		media: query,
		onchange: null,
		addEventListener: (_: string, listener: Listener) => listeners.add(listener),
		removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
		addListener: (listener: Listener) => listeners.add(listener),
		removeListener: (listener: Listener) => listeners.delete(listener),
		dispatchEvent: () => true,
	}))
	Object.defineProperty(window, "matchMedia", { value: matchMedia, configurable: true, writable: true })
	Object.defineProperty(window, "innerWidth", { value: width, configurable: true })
	return {
		resize: (next: number) => {
			current = next
			Object.defineProperty(window, "innerWidth", { value: next, configurable: true })
			for (const listener of listeners) listener({ matches: next <= 767 })
		},
	}
}

type SheetModule = Awaited<ReturnType<SheetLoader>>

/** Drawer modules each loader has already produced in this test file, keyed by the loader. */
const loadedModules = new WeakMap<SheetLoader, SheetModule>()

/**
 * A loader for a module already in hand. It answers with a thenable that calls back at once, so `lazy` renders
 * the drawer on the first pass instead of suspending: once a Suspense fallback shows, React 19 holds the
 * reveal for 300ms (`FALLBACK_THROTTLE_MS`), and every drawer a test opened would wait that out.
 */
export const loadedSheet = (module: SheetModule): SheetLoader => {
	const load = (() => ({ then: (resolve: (value: SheetModule) => unknown) => resolve(module) })) as SheetLoader
	loadedModules.set(load, module)
	return load
}

/** `load`, answering at once (see `loadedSheet`) from the second call on. */
const remembered =
	(load: SheetLoader): SheetLoader =>
	() => {
		const module = loadedModules.get(load)
		if (module) return loadedSheet(module)()
		return load().then((loaded) => {
			loadedModules.set(load, loaded)
			return loaded
		})
	}

/** Loads a drawer module ahead of opening it, so the open doesn't suspend (see `loadedSheet`). */
export const preloadSheet = async (load: SheetLoader) => {
	if (!loadedModules.has(load)) loadedModules.set(load, await load())
}

export const isSheetLoaded = (load: SheetLoader) => loadedModules.has(load)

/**
 * Drawers that only report what they were opened with: the title is the kind, the body the params as JSON
 * (`data-testid="sheet-params"`). A screen's test checks which drawer it opens without loading the real one.
 */
export const recordingSheets = (): Map<SheetKind, SheetLoader> =>
	new Map(
		SHEET_KINDS.map((kind) => [
			kind,
			loadedSheet({
				default: (({ params }: { params: unknown }) => (
					<Sheet title={kind}>
						<pre data-testid="sheet-params">{JSON.stringify(params)}</pre>
					</Sheet>
				)) as never,
			}),
		]),
	)

/** Prints the current address, for asserting where a tap navigated. */
export const Where = () => {
	const location = useLocation()
	return <div data-testid="where">{`${location.pathname}${location.search}`}</div>
}

export const ME = {
	id: "u1",
	name: "Ada Lovelace",
	email: "ada@example.com",
	...sessionIn("team", "w1"),
}

export const PERSONAL_ID = "00000000-0000-4000-8000-0000000000a2"

export const ME_WITH_PERSONAL = {
	...ME,
	workspaces: [{ id: PERSONAL_ID, kind: "personal" as const, name: "Ada", role: "admin" as const }, ...ME.workspaces],
}

export const testQueryClient = (seed?: (client: QueryClient) => void) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	client.setQueryData(QueryKeys.auth.me(), ME)
	client.setQueryData(QueryKeys.artifacts.list({ scope: "all" }), [])
	client.setQueryData(QueryKeys.projects.list(), [])
	client.setQueryData(QueryKeys.approvals.pending(), [])
	client.setQueryData(QueryKeys.accessRequests.list(), [])
	seed?.(client)
	return client
}

/**
 * Renders a mobile screen the way the shell hosts it: a 390px viewport, query data seeded (me, and empty
 * artifacts, projects and approvals unless `seed` sets them), toasts, Upload/New folder actions and the
 * bottom drawer with `recordingSheets()` unless `sheets` is given. `path` is the route pattern, `at` the
 * address it starts on; `<Where />` is rendered beside the screen.
 */
export const renderMobile = (
	ui: ReactNode,
	{
		path = "/",
		at = path,
		seed,
		sheets = recordingSheets(),
		width = 390,
		reducedMotion = true,
		client = testQueryClient(seed),
	}: {
		path?: string
		at?: string
		seed?: (client: QueryClient) => void
		sheets?: Map<SheetKind, SheetLoader>
		width?: number
		reducedMotion?: boolean
		client?: QueryClient
	} = {},
): RenderResult & { client: QueryClient; viewport: ReturnType<typeof mockViewport> } => {
	const viewport = mockViewport(width, { reducedMotion })
	const drawers = new Map([...sheets].map(([kind, load]) => [kind, remembered(load)]))
	const result = render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<MemoryRouter initialEntries={[at]}>
					<LibraryActionsProvider>
						<SheetProvider sheets={drawers}>
							<Routes>
								<Route
									path={path}
									element={
										<>
											{ui}
											<Where />
										</>
									}
								/>
								<Route path="*" element={<Where />} />
							</Routes>
						</SheetProvider>
					</LibraryActionsProvider>
				</MemoryRouter>
			</ToastProvider>
		</QueryClientProvider>,
	)
	return { ...result, client, viewport }
}
