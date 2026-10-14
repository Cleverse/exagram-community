import { type Project, type VisibleArtifact } from "@exagram/api-client"
import { createContext, type ReactNode, useContext, useMemo, useState } from "react"

type DragState = {
	/** The file row being dragged (v3.4 `dragId`), or null when no row drag is on. */
	dragged: VisibleArtifact | null
	setDragged: (artifact: VisibleArtifact | null) => void
	/** The Project row being dragged to nest it under another Project, or null. */
	draggedProject: Project | null
	setDraggedProject: (project: Project | null) => void
}

const DragContext = createContext<DragState>({
	dragged: null,
	setDragged: () => {},
	draggedProject: null,
	setDraggedProject: () => {},
})

/** Holds which file or Project row is being dragged, so the shell, the sidebar and every folder can draw the drag's states. */
export const DragProvider = ({ children }: { children: ReactNode }) => {
	const [dragged, setDragged] = useState<VisibleArtifact | null>(null)
	const [draggedProject, setDraggedProject] = useState<Project | null>(null)
	const value = useMemo(() => ({ dragged, setDragged, draggedProject, setDraggedProject }), [dragged, draggedProject])
	return <DragContext.Provider value={value}>{children}</DragContext.Provider>
}

export const useDragState = () => useContext(DragContext)
