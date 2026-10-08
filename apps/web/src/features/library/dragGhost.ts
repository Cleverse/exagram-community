import { type VisibleArtifact } from "@exagram/api-client"

import { KIND_TAG } from "@/features/library/kinds"

const SVG = "http://www.w3.org/2000/svg"

/**
 * The drag ghost (v3.4 §2): a 30px `drag-chip` chip with white text — the kind, the file name (up to 220px)
 * and a `drag-badge` count — handed to `setDragImage`. The browser snapshots it at once, so it is built
 * off-screen and removed right after.
 */
export const setDragGhost = (event: { dataTransfer: DataTransfer }, artifact: VisibleArtifact, count = 1) => {
	if (typeof event.dataTransfer.setDragImage !== "function") return
	const chip = document.createElement("div")
	chip.setAttribute("aria-hidden", "true")
	chip.dataset.dragGhost = ""
	Object.assign(chip.style, {
		position: "fixed",
		top: "-1000px",
		left: "-1000px",
		display: "flex",
		alignItems: "center",
		gap: "8px",
		height: "30px",
		padding: "0 6px 0 10px",
		borderRadius: "6px",
		background: "var(--color-drag-chip)",
		color: "#fff",
		fontSize: "13px",
		fontWeight: "500",
		fontFamily: "inherit",
		whiteSpace: "nowrap",
		boxShadow: "0 6px 16px rgba(23,25,35,.18)",
	})

	// The type icon: the prototype's page glyph, in white.
	const kind = document.createElementNS(SVG, "svg")
	kind.setAttribute("width", "14")
	kind.setAttribute("height", "14")
	kind.setAttribute("viewBox", "0 0 24 24")
	kind.setAttribute("fill", "none")
	kind.setAttribute("stroke", "currentColor")
	kind.setAttribute("stroke-width", "1.8")
	kind.setAttribute("stroke-linejoin", "round")
	const page = document.createElementNS(SVG, "path")
	page.setAttribute("d", "M7,4 L14,4 L17,7 L17,20 L7,20 Z M14,4 L14,7 L17,7")
	kind.append(page)
	const label = `${KIND_TAG[artifact.kind]} ${artifact.title}`

	const name = document.createElement("span")
	name.textContent = artifact.title
	Object.assign(name.style, { maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" })

	const badge = document.createElement("span")
	badge.textContent = String(count)
	Object.assign(badge.style, {
		display: "grid",
		placeItems: "center",
		minWidth: "18px",
		height: "18px",
		padding: "0 5px",
		borderRadius: "9px",
		background: "var(--color-drag-badge)",
		fontSize: "11px",
		fontWeight: "600",
	})

	chip.title = label
	chip.append(kind, name, badge)
	document.body.append(chip)
	event.dataTransfer.setDragImage(chip, 14, 15)
	setTimeout(() => chip.remove(), 0)
}
