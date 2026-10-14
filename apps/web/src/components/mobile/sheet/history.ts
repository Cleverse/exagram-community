import { useEffect, useRef } from "react"
import { useLocation } from "react-router"

/**
 * Browser and Android Back close an open drawer instead of leaving the screen. Each open layer (the nav
 * drawer, the bottom drawer) owns one history entry pushed over the screen's; Back pops it and the layer
 * closes. Closing a layer any other way (×, the scrim, Escape, a drag) pops its entry, so the next Back leaves
 * the screen exactly as it would have with nothing open.
 *
 * The entry copies React Router's `history.state` (its `idx` and `key`) and adds a mark, so the router sees
 * the same location at the same index.
 */
const MARK = "mobileLayer"

type EntryState = { idx?: number; [MARK]?: string } | null

type Layer = {
	token: string
	onBack: () => void
	/** `waiting`: opened while an earlier entry's pop was still in flight; it pushes once that lands. */
	entry: "none" | "waiting" | "pushed"
}

const layers: Layer[] = []
const session = Date.now().toString(36)
let nextToken = 0
/** Pops this module asked for (closing a layer by ×) that must not close anything when they land. */
let expectedPops = 0
/** React Router's index of the entry last shown, to tell which way the person travelled. */
let lastIdx: number | undefined
let listening = false

/** Callbacks waiting for every layer to give its entry back (see `afterLayersClosed`). */
let settled: (() => void)[] = []

const currentState = () => window.history.state as EntryState

const isSettled = () => expectedPops === 0 && layers.every((layer) => layer.entry !== "pushed")

const flushSettled = () => {
	if (!isSettled()) return
	const run = settled
	settled = []
	for (const callback of run) callback()
}

/**
 * Runs `callback` once no layer holds a history entry. A drawer that leaves its screen with a `replace`
 * navigation (deleting the file being read) waits for this, so the replace lands on the screen's own entry
 * rather than the drawer's, and Back can't return to the deleted file.
 */
export const afterLayersClosed = (callback: () => void) => {
	settled.push(callback)
	flushSettled()
}

const pushEntry = (layer: Layer) => {
	window.history.pushState({ ...currentState(), [MARK]: layer.token }, "")
	layer.entry = "pushed"
}

const onPopState = () => {
	if (expectedPops > 0) {
		expectedPops -= 1
		if (expectedPops === 0) for (const layer of layers) if (layer.entry === "waiting") pushEntry(layer)
		lastIdx = currentState()?.idx
		flushSettled()
		return
	}
	const token = currentState()?.[MARK]
	const landedOn = layers.findIndex((layer) => layer.entry === "pushed" && layer.token === token)
	// Every layer above the entry Back landed on has lost its entry; close them top first.
	for (const layer of layers.slice(landedOn + 1).reverse()) {
		if (layer.entry !== "pushed") continue
		layer.entry = "none"
		layer.onBack()
	}
	if (token !== undefined && landedOn === -1) {
		// An entry left under the next screen by a drawer that navigated (Open, a project link). It shows the
		// same screen as the entry below it, so step over it the way the person was going.
		const idx = currentState()?.idx
		if (lastIdx !== undefined && idx !== undefined && lastIdx > idx) window.history.back()
		else window.history.forward()
		return
	}
	lastIdx = currentState()?.idx
}

export const listen = () => {
	if (listening) return
	listening = true
	// A reload on a drawer's entry shows the screen with no drawer, so that entry is the screen's now.
	const state = currentState()
	if (state?.[MARK] !== undefined) {
		const screenState = { ...state }
		delete screenState[MARK]
		window.history.replaceState(screenState, "")
	}
	window.addEventListener("popstate", onPopState)
}

const openLayer = (onBack: () => void): Layer => {
	listen()
	const layer: Layer = { token: `${session}-${nextToken++}`, onBack, entry: "none" }
	layers.push(layer)
	if (expectedPops > 0) layer.entry = "waiting"
	else pushEntry(layer)
	return layer
}

const closeLayer = (layer: Layer) => {
	const index = layers.indexOf(layer)
	if (index === -1) return
	layers.splice(index, 1)
	// Only an entry still on top can be popped; one under a newer screen is stepped over when Back reaches it.
	if (layer.entry === "pushed" && currentState()?.[MARK] === layer.token) {
		expectedPops += 1
		window.history.back()
	}
	layer.entry = "none"
	flushSettled()
}

/**
 * While `open`, the layer holds a history entry and Back calls `onBack` (which closes it). When `open` turns
 * false, or the caller unmounts, the entry is given back.
 */
export const useBackCloses = (open: boolean, onBack: () => void) => {
	const location = useLocation()
	const onBackRef = useRef(onBack)
	useEffect(() => {
		onBackRef.current = onBack
	}, [onBack])

	useEffect(() => {
		lastIdx = currentState()?.idx
	}, [location.key])

	useEffect(() => {
		if (!open) return
		const layer = openLayer(() => onBackRef.current())
		return () => closeLayer(layer)
	}, [open])
}
