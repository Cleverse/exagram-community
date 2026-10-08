export type ZoomRange = { min: number; max: number; step: number }

/** The reading sheet's range: text stays legible at 80 and the sheet still fits at 200. */
const SHEET_ZOOM: ZoomRange = { min: 80, max: 200, step: 10 }

/** The library preview pane picks from a menu instead of stepping (prototype line 1948). */
export const PREVIEW_ZOOM_OPTIONS = [50, 75, 90, 100, 110, 125, 150, 175, 200] as const
export const PREVIEW_ZOOM: ZoomRange = { min: 50, max: 200, step: 10 }

export const DEFAULT_ZOOM = 110
export const DEFAULT_PREVIEW_ZOOM = 100

export const zoomIn = (value: number, range: ZoomRange = SHEET_ZOOM): number => Math.min(range.max, value + range.step)
export const zoomOut = (value: number, range: ZoomRange = SHEET_ZOOM): number => Math.max(range.min, value - range.step)
