import { type CSSProperties } from "react"

/** A drawer's text field: 16px so iOS Safari does not zoom the page when it takes focus. */
export const sheetFieldClass = "w-full border border-line-strong bg-white outline-none focus:border-ink"
export const sheetFieldStyle: CSSProperties = { height: 44, padding: "0 12px", borderRadius: 6, fontSize: 16 }
